import type { AddressConfidence, AddressSuggestion } from "../components/AddressAutocomplete";
import {
  extractCityStateZip,
  extractHouseNumberFromStreetLine,
  hasUsableGeometry,
  houseNumbersMatch,
  isQuickRouteZip,
  isSouthBendLocality,
  parsePartialAddress,
  requestedStreetMatchesCandidate,
  streetPortion,
} from "./addressMatch";
import type { SegmentedAddress } from "./addressSegmenter";
import { parsePastedAddresses as segmentPastedAddresses } from "./addressSegmenter";

export type VerificationStatus = "unresolved" | "needs_review" | "verified";

export interface QuickRouteStop {
  id: string;
  rawInput: string;
  searchInput?: string;
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  confidence?: AddressConfidence;
  verificationStatus: VerificationStatus;
  reviewCandidates?: AddressSuggestion[];
  unresolvedReason?: string;
  duplicateKept?: boolean;
}

const STRONG_CONFIDENCE: ReadonlySet<AddressConfidence> = new Set([
  "verified_rooftop",
  "verified_parcel",
]);

export function newStop(address = ""): QuickRouteStop {
  return {
    id: crypto.randomUUID(),
    rawInput: address,
    searchInput: address,
    address,
    verificationStatus: "unresolved",
  };
}

export function newStopFromSegment(segment: SegmentedAddress, id?: string): QuickRouteStop {
  return {
    id: id ?? crypto.randomUUID(),
    rawInput: segment.rawInput,
    searchInput: segment.searchInput,
    address: segment.searchInput,
    verificationStatus: "unresolved",
  };
}

export function parsePastedAddresses(text: string): string[] {
  return segmentPastedAddresses(text);
}

export function matchInputFor(stop: Pick<QuickRouteStop, "rawInput" | "searchInput">): string {
  const search = stop.searchInput?.trim();
  if (search) return search;
  return stop.rawInput.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function migrateQuickRouteStop(raw: unknown): QuickRouteStop | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const address = typeof raw.address === "string" ? raw.address : "";
  const rawInput = typeof raw.rawInput === "string" ? raw.rawInput : address;
  const searchInput = typeof raw.searchInput === "string" ? raw.searchInput : undefined;
  const hasNewShape = "verificationStatus" in raw || "rawInput" in raw;

  if (!hasNewShape) {
    return {
      id: raw.id,
      rawInput: address,
      searchInput: address,
      address,
      verificationStatus: "unresolved",
    };
  }

  const status = raw.verificationStatus;
  const verificationStatus: VerificationStatus =
    status === "verified" || status === "needs_review" || status === "unresolved"
      ? status
      : "unresolved";

  const lat = typeof raw.lat === "number" ? raw.lat : undefined;
  const lng = typeof raw.lng === "number" ? raw.lng : undefined;
  const placeId = typeof raw.placeId === "string" ? raw.placeId : undefined;
  const confidence = isAddressConfidence(raw.confidence) ? raw.confidence : undefined;
  const duplicateKept = raw.duplicateKept === true;

  // Never keep a stop verified without usable coordinates.
  if (verificationStatus === "verified" && !hasUsableGeometry(lat, lng)) {
    return {
      id: raw.id,
      rawInput,
      searchInput,
      address,
      verificationStatus: "unresolved",
    };
  }

  if (verificationStatus === "verified") {
    return {
      id: raw.id,
      rawInput,
      searchInput,
      address,
      lat,
      lng,
      placeId,
      confidence,
      verificationStatus: "verified",
      duplicateKept,
    };
  }

  return {
    id: raw.id,
    rawInput,
    searchInput,
    address,
    verificationStatus,
    duplicateKept,
  };
}

function isAddressConfidence(value: unknown): value is AddressConfidence {
  return (
    value === "verified_rooftop" ||
    value === "verified_parcel" ||
    value === "interpolated" ||
    value === "street_matched_number_unverified" ||
    value === "street_only" ||
    value === "ambiguous"
  );
}

export function migrateSavedStops(raw: unknown): QuickRouteStop[] {
  if (!Array.isArray(raw)) return [newStop(), newStop()];
  const stops = raw.map(migrateQuickRouteStop).filter((s): s is QuickRouteStop => s !== null);
  return stops.length > 0 ? stops : [newStop(), newStop()];
}

export interface AddressEvaluation {
  verificationStatus: VerificationStatus;
  canConfirm: boolean;
}

export function evaluateAddressSuggestion(
  rawInput: string,
  suggestion: AddressSuggestion
): AddressEvaluation {
  const parsedInput = parsePartialAddress(rawInput);
  const streetLine = suggestion.street
    ? [suggestion.houseNumber, suggestion.street].filter(Boolean).join(" ")
    : streetPortion(suggestion.displayName);
  const fromDisplay = extractCityStateZip(suggestion.displayName);
  const city = suggestion.city ?? fromDisplay.city;
  const zip = suggestion.zip ?? fromDisplay.zip;
  const candidateHouse =
    suggestion.houseNumber ?? extractHouseNumberFromStreetLine(streetLine);

  const geometryOk = hasUsableGeometry(suggestion.lat, suggestion.lng);
  const houseOk = parsedInput.houseNumber
    ? houseNumbersMatch(parsedInput.houseNumber, candidateHouse)
    : false;
  const streetOk = requestedStreetMatchesCandidate(rawInput, streetLine);
  const cityOk = isSouthBendLocality(city);
  const zipOk = isQuickRouteZip(zip);
  const strong =
    suggestion.confidence !== undefined && STRONG_CONFIDENCE.has(suggestion.confidence);

  const canConfirm = Boolean(
    geometryOk && parsedInput.houseNumber && houseOk && streetOk && cityOk && zipOk
  );

  if (canConfirm && strong) {
    return { verificationStatus: "verified", canConfirm: true };
  }
  if (canConfirm || (geometryOk && streetOk)) {
    return { verificationStatus: "needs_review", canConfirm };
  }
  return { verificationStatus: "needs_review", canConfirm: false };
}

export function applyStopTextEdit(stop: QuickRouteStop, text: string): QuickRouteStop {
  if (stop.address === text) return stop;
  return {
    id: stop.id,
    rawInput: stop.rawInput && stop.rawInput !== stop.address ? stop.rawInput : text,
    searchInput: text,
    address: text,
    verificationStatus: "unresolved",
    unresolvedReason: undefined,
    reviewCandidates: undefined,
    lat: undefined,
    lng: undefined,
    placeId: undefined,
    confidence: undefined,
  };
}

export function applyStopSearchEdit(stop: QuickRouteStop, text: string): QuickRouteStop {
  if (stop.searchInput === text && stop.address === text) return stop;
  return {
    ...stop,
    searchInput: text,
    address: text,
    lat: undefined,
    lng: undefined,
    placeId: undefined,
    confidence: undefined,
    verificationStatus: "unresolved",
    unresolvedReason: undefined,
    reviewCandidates: undefined,
  };
}

export function applyStopSuggestion(
  stop: QuickRouteStop,
  suggestion: AddressSuggestion,
  rawInput: string,
  options?: { userConfirmed?: boolean; matchInput?: string }
): QuickRouteStop {
  const matchInput = options?.matchInput ?? rawInput;
  const evaluation = evaluateAddressSuggestion(matchInput, suggestion);
  let verificationStatus = evaluation.verificationStatus;
  if (options?.userConfirmed && evaluation.canConfirm) {
    verificationStatus = "verified";
  }

  const geometryOk = hasUsableGeometry(suggestion.lat, suggestion.lng);

  return {
    ...stop,
    rawInput,
    searchInput: stop.searchInput ?? matchInput,
    address: suggestion.displayName,
    lat: geometryOk ? suggestion.lat : undefined,
    lng: geometryOk ? suggestion.lng : undefined,
    placeId: suggestion.placeId,
    confidence: suggestion.confidence,
    verificationStatus,
    unresolvedReason: verificationStatus === "unresolved" ? undefined : stop.unresolvedReason,
    reviewCandidates:
      verificationStatus === "needs_review"
        ? validReviewCandidates(stop.reviewCandidates, suggestion)
        : undefined,
  };
}

export interface BatchEntryResult {
  id: string;
  rawInput: string;
  normalizedInput: string;
  status: VerificationStatus;
  candidate?: AddressSuggestion;
  candidates?: AddressSuggestion[];
  reason?: string;
}

/**
 * Apply a batch (or re-resolve) result onto an existing stop.
 * Preserves id and original rawInput. Re-runs Phase 1 evaluation so the
 * batch path cannot verify a candidate autocomplete would reject.
 */
export function applyResolvedBatchEntry(stop: QuickRouteStop, result: BatchEntryResult): QuickRouteStop {
  const rawInput = stop.rawInput || result.rawInput;
  const matchInput = result.normalizedInput || matchInputFor(stop);
  const confirmable = confirmableCandidates(result.candidates ?? [], matchInput);

  if (result.candidate) {
    const evaluation = evaluateAddressSuggestion(matchInput, result.candidate);
    let verificationStatus = evaluation.verificationStatus;
    if (result.status !== "verified" && verificationStatus === "verified") {
      verificationStatus = result.status;
    }
    if (result.status === "verified" && verificationStatus !== "verified") {
      verificationStatus = evaluation.canConfirm ? "needs_review" : "unresolved";
    }
    if (verificationStatus === "verified" && !evaluation.canConfirm) {
      verificationStatus = "needs_review";
    }

    const geometryOk = hasUsableGeometry(result.candidate.lat, result.candidate.lng);
    return {
      ...stop,
      id: stop.id,
      rawInput,
      searchInput: matchInput,
      address:
        verificationStatus === "verified" || evaluation.canConfirm
          ? result.candidate.displayName
          : matchInput,
      lat: geometryOk && (verificationStatus === "verified" || evaluation.canConfirm)
        ? result.candidate.lat
        : undefined,
      lng: geometryOk && (verificationStatus === "verified" || evaluation.canConfirm)
        ? result.candidate.lng
        : undefined,
      placeId: result.candidate.placeId,
      confidence: result.candidate.confidence,
      verificationStatus,
      reviewCandidates: verificationStatus === "needs_review" ? confirmable : undefined,
      unresolvedReason: verificationStatus === "unresolved" ? result.reason : undefined,
    };
  }

  return {
    ...stop,
    id: stop.id,
    rawInput,
    searchInput: matchInput,
    address: matchInput,
    lat: undefined,
    lng: undefined,
    placeId: undefined,
    confidence: undefined,
    verificationStatus: "unresolved",
    reviewCandidates: undefined,
    unresolvedReason: result.reason ?? "No confident match",
  };
}

function validReviewCandidates(
  existing: AddressSuggestion[] | undefined,
  selected: AddressSuggestion
): AddressSuggestion[] {
  const list = existing && existing.length > 0 ? existing : [selected];
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const s of [selected, ...list]) {
    if (seen.has(s.placeId)) continue;
    seen.add(s.placeId);
    out.push(s);
  }
  return out;
}

export function mergeImportedStops(
  existing: QuickRouteStop[],
  incoming: QuickRouteStop[],
  replace: boolean
): QuickRouteStop[] {
  if (replace) return incoming.length > 0 ? incoming : [newStop(), newStop()];
  return [...existing.filter(stopIsFilled), ...incoming];
}

export function stopIsFilled(stop: QuickRouteStop): boolean {
  return stop.address.trim().length > 0 || stop.rawInput.trim().length > 0;
}

export function stopBlocksRoute(stop: QuickRouteStop): boolean {
  if (!stopIsFilled(stop)) return false;
  return stop.verificationStatus !== "verified" || !hasUsableGeometry(stop.lat, stop.lng);
}

export function confirmableCandidates(candidates: AddressSuggestion[], rawInput: string): AddressSuggestion[] {
  return candidates.filter((s) => evaluateAddressSuggestion(rawInput, s).canConfirm);
}
