import type { AddressConfidence, AddressSuggestion } from "../components/AddressAutocomplete";
import { QUICK_ROUTE_SERVICE_AREA } from "../config/quickRouteServiceArea";
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
export type VerificationMethod = "provider" | "manual_pin";

export const GOOGLE_ADDRESS_VALIDATION_PROVIDER = "google_address_validation";

export interface SuggestedCorrection {
  explanation: string;
  changedComponents: string[];
  candidate: AddressSuggestion;
}

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
  verificationMethod?: VerificationMethod;
  verificationProvider?: string;
  reviewCandidates?: AddressSuggestion[];
  suggestedCorrection?: SuggestedCorrection;
  unresolvedReason?: string;
  duplicateKept?: boolean;
  manualVerifiedAt?: string;
  manualReverseGeocodeLabel?: string;
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
  const verificationMethod: VerificationMethod | undefined =
    raw.verificationMethod === "manual_pin" || raw.verificationMethod === "provider"
      ? raw.verificationMethod
      : verificationStatus === "verified"
        ? "provider"
        : undefined;
  const verificationProvider =
    typeof raw.verificationProvider === "string" ? raw.verificationProvider : undefined;
  const manualVerifiedAt = typeof raw.manualVerifiedAt === "string" ? raw.manualVerifiedAt : undefined;
  const manualReverseGeocodeLabel =
    typeof raw.manualReverseGeocodeLabel === "string" ? raw.manualReverseGeocodeLabel : undefined;

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
    if (verificationMethod === "manual_pin") {
      return {
        id: raw.id,
        rawInput,
        searchInput,
        address,
        lat,
        lng,
        verificationStatus: "verified",
        verificationMethod: "manual_pin",
        manualVerifiedAt,
        manualReverseGeocodeLabel,
        duplicateKept,
      };
    }
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
      verificationMethod: "provider",
      verificationProvider,
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
    suggestedCorrection: undefined,
    lat: undefined,
    lng: undefined,
    placeId: undefined,
    confidence: undefined,
    verificationMethod: undefined,
    verificationProvider: undefined,
    manualVerifiedAt: undefined,
    manualReverseGeocodeLabel: undefined,
    duplicateKept: stop.duplicateKept,
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
    verificationMethod: undefined,
    verificationProvider: undefined,
    unresolvedReason: undefined,
    reviewCandidates: undefined,
    suggestedCorrection: undefined,
    manualVerifiedAt: undefined,
    manualReverseGeocodeLabel: undefined,
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
    verificationMethod: verificationStatus === "verified" ? "provider" : undefined,
    verificationProvider:
      verificationStatus === "verified" ? stop.verificationProvider : undefined,
    unresolvedReason: verificationStatus === "unresolved" ? undefined : stop.unresolvedReason,
    suggestedCorrection: verificationStatus === "needs_review" ? stop.suggestedCorrection : undefined,
    reviewCandidates:
      verificationStatus === "needs_review"
        ? validReviewCandidates(stop.reviewCandidates, suggestion)
        : undefined,
    manualVerifiedAt: undefined,
    manualReverseGeocodeLabel: undefined,
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
  verificationMethod?: VerificationMethod;
  verificationProvider?: string;
  suggestedCorrection?: SuggestedCorrection;
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
      placeId: result.candidate.placeId || undefined,
      confidence: result.candidate.confidence,
      verificationStatus,
      verificationMethod: verificationStatus === "verified" ? (result.verificationMethod ?? "provider") : undefined,
      verificationProvider:
        verificationStatus === "verified" ? result.verificationProvider : undefined,
      reviewCandidates: verificationStatus === "needs_review" ? confirmable : undefined,
      suggestedCorrection:
        verificationStatus === "needs_review" ? result.suggestedCorrection : undefined,
      unresolvedReason: verificationStatus === "unresolved" ? result.reason : undefined,
      manualVerifiedAt: undefined,
      manualReverseGeocodeLabel: undefined,
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
    verificationStatus: result.suggestedCorrection ? "needs_review" : "unresolved",
    verificationMethod: undefined,
    verificationProvider: undefined,
    reviewCandidates: undefined,
    suggestedCorrection: result.suggestedCorrection,
    unresolvedReason: result.suggestedCorrection ? undefined : (result.reason ?? "No confident match"),
    manualVerifiedAt: undefined,
    manualReverseGeocodeLabel: undefined,
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
    if (!s.placeId || seen.has(s.placeId)) continue;
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

/**
 * User explicitly accepted a Google (or other) correction. Re-run Phase 1
 * against the accepted street line, not the original mismatched input.
 */
export function applySuggestedCorrection(
  stop: QuickRouteStop,
  correction: SuggestedCorrection
): QuickRouteStop {
  const streetLine =
    [correction.candidate.houseNumber, correction.candidate.street].filter(Boolean).join(" ") ||
    streetPortion(correction.candidate.displayName);
  const next = applyStopSuggestion(stop, correction.candidate, stop.rawInput, {
    userConfirmed: true,
    matchInput: streetLine,
  });
  return {
    ...next,
    searchInput: streetLine,
    verificationProvider:
      next.verificationStatus === "verified"
        ? stop.verificationProvider ?? GOOGLE_ADDRESS_VALIDATION_PROVIDER
        : undefined,
    suggestedCorrection: next.verificationStatus === "needs_review" ? correction : undefined,
  };
}

export function stopAllowsManualPin(stop: QuickRouteStop): boolean {
  if (!stopIsFilled(stop)) return false;
  return stop.verificationStatus === "unresolved" || stop.verificationStatus === "needs_review";
}

export function stopAllowsAdjustPin(stop: QuickRouteStop): boolean {
  return stop.verificationStatus === "verified" && stop.verificationMethod === "manual_pin";
}

export interface ManualPinDraft {
  stopId: string;
  lat?: number;
  lng?: number;
}

export function applyManualPinMapClick(
  draft: ManualPinDraft,
  lat: number,
  lng: number
): ManualPinDraft {
  return { stopId: draft.stopId, lat, lng };
}

export function confirmManualPin(
  stop: QuickRouteStop,
  draft: ManualPinDraft,
  options?: { reverseLabel?: string; at?: string }
): QuickRouteStop {
  if (draft.stopId !== stop.id) return stop;
  if (!hasUsableGeometry(draft.lat, draft.lng)) return stop;
  return {
    ...stop,
    address: stop.searchInput?.trim() || stop.address.trim() || stop.rawInput.trim(),
    lat: draft.lat,
    lng: draft.lng,
    placeId: undefined,
    confidence: undefined,
    verificationStatus: "verified",
    verificationMethod: "manual_pin",
    verificationProvider: undefined,
    manualVerifiedAt: options?.at ?? new Date().toISOString(),
    manualReverseGeocodeLabel: options?.reverseLabel,
    unresolvedReason: undefined,
    reviewCandidates: undefined,
    suggestedCorrection: undefined,
  };
}

export function adjustManualPin(
  stop: QuickRouteStop,
  lat: number,
  lng: number,
  options?: { reverseLabel?: string; at?: string }
): QuickRouteStop {
  if (stop.verificationMethod !== "manual_pin") return stop;
  if (!hasUsableGeometry(lat, lng)) return stop;
  return {
    ...stop,
    id: stop.id,
    lat,
    lng,
    manualVerifiedAt: options?.at ?? new Date().toISOString(),
    manualReverseGeocodeLabel: options?.reverseLabel ?? stop.manualReverseGeocodeLabel,
  };
}

export function streetSafeCandidateCenter(
  stop: QuickRouteStop
): { lat: number; lng: number } | undefined {
  const matchInput = matchInputFor(stop);
  for (const candidate of stop.reviewCandidates ?? []) {
    if (!hasUsableGeometry(candidate.lat, candidate.lng)) continue;
    const streetLine = candidate.street
      ? [candidate.houseNumber, candidate.street].filter(Boolean).join(" ")
      : streetPortion(candidate.displayName);
    if (requestedStreetMatchesCandidate(matchInput, streetLine)) {
      return { lat: candidate.lat as number, lng: candidate.lng as number };
    }
  }
  if (
    stop.suggestedCorrection &&
    hasUsableGeometry(stop.suggestedCorrection.candidate.lat, stop.suggestedCorrection.candidate.lng)
  ) {
    const c = stop.suggestedCorrection.candidate;
    const streetLine = c.street
      ? [c.houseNumber, c.street].filter(Boolean).join(" ")
      : streetPortion(c.displayName);
    if (requestedStreetMatchesCandidate(matchInput, streetLine)) {
      return { lat: c.lat as number, lng: c.lng as number };
    }
  }
  return undefined;
}

export function manualPinMapCenter(
  stop: QuickRouteStop,
  otherStops: QuickRouteStop[]
): { lat: number; lng: number; zoom: number } {
  const streetSafe = streetSafeCandidateCenter(stop);
  if (streetSafe) return { ...streetSafe, zoom: 18 };

  const verified = otherStops.filter(
    (s) =>
      s.id !== stop.id &&
      s.verificationStatus === "verified" &&
      hasUsableGeometry(s.lat, s.lng)
  );
  if (verified.length > 0) {
    const lat = verified.reduce((sum, s) => sum + (s.lat as number), 0) / verified.length;
    const lng = verified.reduce((sum, s) => sum + (s.lng as number), 0) / verified.length;
    return { lat, lng, zoom: 15 };
  }

  return { ...QUICK_ROUTE_SERVICE_AREA.center, zoom: 14 };
}

export function verificationSourceCopy(stop: QuickRouteStop): { title: string; detail?: string } {
  if (stop.verificationStatus === "needs_review") return { title: "Check this" };
  if (stop.verificationStatus !== "verified") return { title: "Needs a location" };
  if (stop.verificationMethod === "manual_pin") {
    return { title: "Ready", detail: "Pinned by you" };
  }
  if (stop.verificationProvider === GOOGLE_ADDRESS_VALIDATION_PROVIDER) {
    return { title: "Ready", detail: "Google Address Validation" };
  }
  return { title: "Ready" };
}
