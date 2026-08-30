import type { AutocompleteSuggestion } from "./addressAutocomplete.js";
import { searchAddressAutocomplete } from "./addressAutocomplete.js";
import { evaluateAddressSuggestion, type VerificationStatus } from "./quickRouteVerify.js";
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

export interface BatchResolveResult {
  id: string;
  rawInput: string;
  normalizedInput: string;
  status: VerificationStatus;
  candidate?: BatchResolveCandidate;
  candidates?: BatchResolveCandidate[];
  reason?: string;
}

export type AddressSearchFn = (opts: {
  q: string;
  limit?: number;
  serviceAreaOnly?: boolean;
  near?: { lat: number; lng: number };
}) => Promise<AutocompleteSuggestion[]>;

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

function serializeCandidate(s: AutocompleteSuggestion): BatchResolveCandidate {
  return {
    placeId: s.placeId,
    displayName: s.displayName,
    lat: s.lat,
    lng: s.lng,
    confidence: s.confidence,
    rankReason: s.rankReason,
    distanceMeters: s.distanceMeters,
    city: s.city,
    state: s.state,
    zip: s.zip,
    houseNumber: s.houseNumber,
    street: s.street,
  };
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

/**
 * Resolve a single address using the same Phase 1 evaluateAddressSuggestion
 * semantics as autocomplete. Never throws away the row.
 */
export async function resolveOneAddress(
  entry: BatchResolveInput,
  search: AddressSearchFn = searchAddressAutocomplete
): Promise<BatchResolveResult> {
  const rawInput = entry.rawInput;
  const normalizedInput = (entry.searchInput ?? entry.rawInput).replace(/\s+/g, " ").trim();
  const matchInput = normalizedInput || rawInput.trim();

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

  let suggestions: AutocompleteSuggestion[];
  try {
    suggestions = await search({
      q: matchInput,
      limit: 8,
      serviceAreaOnly: true,
    });
  } catch (err) {
    console.warn(
      "[geocode:batch] provider failure",
      entry.id,
      err instanceof Error ? err.message : err
    );
    const result: BatchResolveResult = {
      ...base,
      status: "unresolved",
      reason: SERVICE_UNAVAILABLE_REASON,
      candidates: [],
    };
    logBatchRow(result, 0);
    return result;
  }

  if (!suggestions.length) {
    const result: BatchResolveResult = {
      ...base,
      status: "unresolved",
      reason: "No confident match",
      candidates: [],
    };
    logBatchRow(result, 0);
    return result;
  }

  const evaluated = suggestions.map((suggestion) => ({
    suggestion,
    evaluation: evaluateAddressSuggestion(matchInput, suggestion),
  }));

  const confirmable = evaluated.filter((e) => e.evaluation.canConfirm);

  if (evaluated[0].evaluation.verificationStatus === "verified") {
    const result: BatchResolveResult = {
      ...base,
      status: "verified",
      candidate: serializeCandidate(evaluated[0].suggestion),
      candidates: confirmable.map((e) => serializeCandidate(e.suggestion)),
    };
    logBatchRow(result, suggestions.length);
    return result;
  }

  if (confirmable.length > 0) {
    const result: BatchResolveResult = {
      ...base,
      status: "needs_review",
      candidate: serializeCandidate(confirmable[0].suggestion),
      candidates: confirmable.map((e) => serializeCandidate(e.suggestion)),
      reason: evaluated[0].evaluation.reasons[0] ?? "Needs confirmation",
    };
    logBatchRow(result, suggestions.length);
    return result;
  }

  const result: BatchResolveResult = {
    ...base,
    status: "unresolved",
    reason: evaluated[0].evaluation.reasons[0] ?? "No confident match",
    candidates: [],
  };
  logBatchRow(result, suggestions.length);
  return result;
}

export async function resolveAddressBatch(
  entries: BatchResolveInput[],
  options?: {
    search?: AddressSearchFn;
    concurrency?: number;
  }
): Promise<{ results: BatchResolveResult[]; count: ReturnType<typeof summarizeVerificationCounts> }> {
  const search = options?.search ?? searchAddressAutocomplete;
  const concurrency = options?.concurrency ?? BATCH_RESOLVE_CONCURRENCY;

  const results = await mapPool(entries, concurrency, (entry) => resolveOneAddress(entry, search));

  const count = summarizeVerificationCounts(
    entries.length,
    results.map((r) => r.status)
  );

  if (!count.ok) {
    console.error("[geocode:batch] count invariant failed", count);
  }

  return { results, count };
}
