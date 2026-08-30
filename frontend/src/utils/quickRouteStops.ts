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

export type VerificationStatus = "unresolved" | "needs_review" | "verified";

export interface QuickRouteStop {
  id: string;
  rawInput: string;
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  confidence?: AddressConfidence;
  verificationStatus: VerificationStatus;
  reviewCandidates?: AddressSuggestion[];
}

const STRONG_CONFIDENCE: ReadonlySet<AddressConfidence> = new Set([
  "verified_rooftop",
  "verified_parcel",
]);

export function newStop(address = ""): QuickRouteStop {
  return {
    id: crypto.randomUUID(),
    rawInput: address,
    address,
    verificationStatus: "unresolved",
  };
}

export function parsePastedAddresses(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function migrateQuickRouteStop(raw: unknown): QuickRouteStop | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const address = typeof raw.address === "string" ? raw.address : "";
  const rawInput = typeof raw.rawInput === "string" ? raw.rawInput : address;
  const hasNewShape = "verificationStatus" in raw || "rawInput" in raw;

  if (!hasNewShape) {
    return {
      id: raw.id,
      rawInput: address,
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

  // Never keep a stop verified without usable coordinates.
  if (verificationStatus === "verified" && !hasUsableGeometry(lat, lng)) {
    return {
      id: raw.id,
      rawInput,
      address,
      verificationStatus: "unresolved",
    };
  }

  if (verificationStatus === "verified") {
    return {
      id: raw.id,
      rawInput,
      address,
      lat,
      lng,
      placeId,
      confidence,
      verificationStatus: "verified",
    };
  }

  return {
    id: raw.id,
    rawInput,
    address,
    verificationStatus,
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
    rawInput: text,
    address: text,
    verificationStatus: "unresolved",
  };
}

export function applyStopSuggestion(
  stop: QuickRouteStop,
  suggestion: AddressSuggestion,
  rawInput: string,
  options?: { userConfirmed?: boolean }
): QuickRouteStop {
  const evaluation = evaluateAddressSuggestion(rawInput, suggestion);
  let verificationStatus = evaluation.verificationStatus;
  if (options?.userConfirmed && evaluation.canConfirm) {
    verificationStatus = "verified";
  }

  const geometryOk = hasUsableGeometry(suggestion.lat, suggestion.lng);

  return {
    ...stop,
    rawInput,
    address: suggestion.displayName,
    lat: geometryOk ? suggestion.lat : undefined,
    lng: geometryOk ? suggestion.lng : undefined,
    placeId: suggestion.placeId,
    confidence: suggestion.confidence,
    verificationStatus,
    reviewCandidates:
      verificationStatus === "needs_review"
        ? validReviewCandidates(stop.reviewCandidates, suggestion)
        : undefined,
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
