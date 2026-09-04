import type { AutocompleteSuggestion } from "./addressAutocomplete.js";
import { rememberPlaceGeometry, searchAddressAutocomplete } from "./addressAutocomplete.js";
import {
  GOOGLE_ADDRESS_VALIDATION_PROVIDER,
  isGoogleAddressValidationConfigured,
  validateQuickRouteAddress,
} from "./googleAddressValidation.js";
import type { GoogleValidationDecision, SuggestedCorrection } from "./googleAddressValidationAdapter.js";
import {
  evaluateAddressSuggestion,
  type SuggestionLike,
  type VerificationMethod,
  type VerificationStatus,
} from "./quickRouteVerify.js";
import { summarizeVerificationCounts } from "./batchAccounting.js";

export const BATCH_RESOLVE_CONCURRENCY = 4;
export const BATCH_RESOLVE_MAX_ADDRESSES = 80;
export const SERVICE_UNAVAILABLE_REASON = "Address service unavailable — try again.";

export interface BatchResolveInput {
  id: string;
  rawInput: string;
  searchInput?: string;
}

export interface BatchResolveCandidate {
  placeId: string;
  displayName: string;
  lat?: number;
  lng?: number;
  confidence: AutocompleteSuggestion["confidence"];
  rankReason: string;
  distanceMeters?: number;
  city?: string;
  state?: string;
  zip?: string;
  houseNumber?: string;
  street?: string;
}

export interface BatchSuggestedCorrection {
  explanation: string;
  changedComponents: string[];
  candidate: BatchResolveCandidate;
}

export interface BatchResolveResult {
  id: string;
  rawInput: string;
  normalizedInput: string;
  status: VerificationStatus;
  candidate?: BatchResolveCandidate;
  candidates?: BatchResolveCandidate[];
  reason?: string;
  verificationMethod?: VerificationMethod;
  verificationProvider?: string;
  suggestedCorrection?: BatchSuggestedCorrection;
}

export type AddressSearchFn = (opts: {
  q: string;
  limit?: number;
  serviceAreaOnly?: boolean;
  near?: { lat: number; lng: number };
}) => Promise<AutocompleteSuggestion[]>;

export type GoogleValidateFn = (input: string) => Promise<GoogleValidationDecision | null>;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function serializeCandidate(s: AutocompleteSuggestion | SuggestionLike): BatchResolveCandidate {
  return {
    placeId: s.placeId,
    displayName: s.displayName,
    lat: s.lat,
    lng: s.lng,
    confidence: s.confidence,
    rankReason: "rankReason" in s && typeof s.rankReason === "string" ? s.rankReason : "Suggested match",
    distanceMeters: "distanceMeters" in s ? s.distanceMeters : undefined,
    city: s.city,
    state: s.state,
    zip: s.zip,
    houseNumber: s.houseNumber,
    street: s.street,
  };
}

function serializeSuggestedCorrection(
  correction: SuggestedCorrection
): BatchSuggestedCorrection {
  return {
    explanation: correction.explanation,
    changedComponents: correction.changedComponents,
    candidate: serializeCandidate(correction.candidate),
  };
}

function seedGoogleGeometry(decision: GoogleValidationDecision): void {
  if (
    decision.candidate?.placeId &&
    decision.meta.geometryOk &&
    decision.meta.lat !== undefined &&
    decision.meta.lng !== undefined
  ) {
    rememberPlaceGeometry(decision.candidate.placeId, {
      lat: decision.meta.lat,
      lng: decision.meta.lng,
    });
  }
}

async function productionGoogleValidate(input: string): Promise<GoogleValidationDecision | null> {
  if (!isGoogleAddressValidationConfigured()) return null;
  return validateQuickRouteAddress(input);
}

function logBatchRow(result: BatchResolveResult, candidateCount: number): void {
  console.log("[geocode:batch]", {
    id: result.id,
    rawInput: result.rawInput,
    normalizedInput: result.normalizedInput,
    status: result.status,
    candidateCount,
    rejectionReason: result.reason ?? null,
  });
}

function localResultFromSuggestions(
  base: { id: string; rawInput: string; normalizedInput: string },
  matchInput: string,
  suggestions: AutocompleteSuggestion[]
): BatchResolveResult {
  if (!suggestions.length) {
    return {
      ...base,
      status: "unresolved",
      reason: "No confident match",
      candidates: [],
    };
  }

  const evaluated = suggestions.map((suggestion) => ({
    suggestion,
    evaluation: evaluateAddressSuggestion(matchInput, suggestion),
  }));
  const confirmable = evaluated.filter((e) => e.evaluation.canConfirm);

  if (evaluated[0].evaluation.verificationStatus === "verified") {
    return {
      ...base,
      status: "verified",
      candidate: serializeCandidate(evaluated[0].suggestion),
      candidates: confirmable.map((e) => serializeCandidate(e.suggestion)),
      verificationMethod: "provider",
    };
  }

  if (confirmable.length > 0) {
    return {
      ...base,
      status: "needs_review",
      candidate: serializeCandidate(confirmable[0].suggestion),
      candidates: confirmable.map((e) => serializeCandidate(e.suggestion)),
      reason: evaluated[0].evaluation.reasons[0] ?? "Needs confirmation",
    };
  }

  return {
    ...base,
    status: "unresolved",
    reason: evaluated[0].evaluation.reasons[0] ?? "No confident match",
    candidates: [],
  };
}

function googleResult(
  base: { id: string; rawInput: string; normalizedInput: string },
  decision: GoogleValidationDecision
): BatchResolveResult {
  seedGoogleGeometry(decision);
  const candidate = decision.candidate ? serializeCandidate({
    ...decision.candidate,
    rankReason: "Google Address Validation",
  } as AutocompleteSuggestion) : undefined;

  if (decision.status === "verified" && candidate?.placeId) {
    return {
      ...base,
      status: "verified",
      candidate,
      candidates: [candidate],
      verificationMethod: "provider",
      verificationProvider: GOOGLE_ADDRESS_VALIDATION_PROVIDER,
    };
  }

  if (decision.status === "needs_review") {
    return {
      ...base,
      status: "needs_review",
      candidate,
      candidates: candidate?.placeId ? [candidate] : [],
      reason: decision.reason,
      suggestedCorrection: decision.suggestedCorrection
        ? serializeSuggestedCorrection(decision.suggestedCorrection)
        : undefined,
      verificationProvider: GOOGLE_ADDRESS_VALIDATION_PROVIDER,
    };
  }

  return {
    ...base,
    status: "unresolved",
    candidate,
    candidates: [],
    reason: decision.reason ?? "No confident match",
    verificationProvider: GOOGLE_ADDRESS_VALIDATION_PROVIDER,
  };
}

/**
 * Resolve a single address using the same Phase 1 evaluateAddressSuggestion
 * semantics as autocomplete. Local Photon/Nominatim/Places run first.
 * Google Address Validation is used when configured. Field capture prefers
 * Google first; autocomplete-style lookups still try local providers first.
 * Never throws away the row.
 */
export async function resolveOneAddress(
  entry: BatchResolveInput,
  search: AddressSearchFn = searchAddressAutocomplete,
  googleValidate?: GoogleValidateFn | null,
  options?: { preferGoogle?: boolean }
): Promise<BatchResolveResult> {
  const rawInput = entry.rawInput;
  const normalizedInput = (entry.searchInput ?? entry.rawInput).replace(/\s+/g, " ").trim();
  const matchInput = normalizedInput || rawInput.trim();
  const googleFn =
    googleValidate === undefined
      ? search === searchAddressAutocomplete
        ? productionGoogleValidate
        : null
      : googleValidate;
  const preferGoogle = options?.preferGoogle === true;

  const base = {
    id: entry.id,
    rawInput,
    normalizedInput: matchInput,
  };

  if (matchInput.length < 3) {
    const result: BatchResolveResult = {
      ...base,
      status: "unresolved",
      reason: "Address is too incomplete to resolve.",
      candidates: [],
    };
    logBatchRow(result, 0);
    return result;
  }

  if (preferGoogle && googleFn) {
    try {
      const decision = await googleFn(matchInput);
      if (decision) {
        const google = googleResult(base, decision);
        if (
          google.status === "verified" ||
          google.suggestedCorrection ||
          google.status === "needs_review"
        ) {
          logBatchRow(google, google.candidates?.length ?? 0);
          return google;
        }
      }
    } catch (err) {
      console.warn(
        "[geocode:google] provider failure",
        entry.id,
        err instanceof Error ? err.message : err
      );
    }
  }

  let local: BatchResolveResult | undefined;
  let localFailed = false;
  try {
    const suggestions = await search({
      q: matchInput,
      limit: 8,
      serviceAreaOnly: true,
    });
    local = localResultFromSuggestions(base, matchInput, suggestions);
  } catch (err) {
    localFailed = true;
    console.warn(
      "[geocode:batch] provider failure",
      entry.id,
      err instanceof Error ? err.message : err
    );
    local = {
      ...base,
      status: "unresolved",
      reason: SERVICE_UNAVAILABLE_REASON,
      candidates: [],
    };
  }

  if (local.status === "verified") {
    logBatchRow(local, local.candidates?.length ?? 0);
    return local;
  }

  if (googleFn) {
    try {
      const decision = await googleFn(matchInput);
      if (decision) {
        const google = googleResult(base, decision);
        if (google.status === "verified") {
          logBatchRow(google, 1);
          return google;
        }
        if (google.status === "needs_review" && google.suggestedCorrection) {
          logBatchRow(google, 1);
          return google;
        }
        if (local.status !== "needs_review" && google.status === "needs_review") {
          logBatchRow(google, 1);
          return google;
        }
      }
    } catch (err) {
      console.warn(
        "[geocode:google] provider failure",
        entry.id,
        err instanceof Error ? err.message : err
      );
      // Keep the local row. Do not drop it because Google is down.
    }
  }

  if (localFailed && local.status === "unresolved") {
    logBatchRow(local, 0);
    return local;
  }

  logBatchRow(local, local.candidates?.length ?? 0);
  return local;
}

export async function resolveAddressBatch(
  entries: BatchResolveInput[],
  options?: {
    search?: AddressSearchFn;
    concurrency?: number;
    googleValidate?: GoogleValidateFn | null;
    preferGoogle?: boolean;
  }
): Promise<{ results: BatchResolveResult[]; count: ReturnType<typeof summarizeVerificationCounts> }> {
  const search = options?.search ?? searchAddressAutocomplete;
  const concurrency = options?.concurrency ?? BATCH_RESOLVE_CONCURRENCY;
  const googleValidate =
    options && "googleValidate" in options
      ? options.googleValidate
      : options?.search
        ? null
        : undefined;
  const preferGoogle = options?.preferGoogle === true;

  const results = await mapPool(entries, concurrency, (entry) =>
    resolveOneAddress(entry, search, googleValidate, { preferGoogle })
  );

  const count = summarizeVerificationCounts(
    entries.length,
    results.map((r) => r.status)
  );

  if (!count.ok) {
    console.error("[geocode:batch] count invariant failed", count);
  }

  return { results, count };
}
