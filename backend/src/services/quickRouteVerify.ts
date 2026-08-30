import type { AddressConfidence } from "./addressAutocompleteRank.js";
import { isStrongConfidence } from "./addressAutocompleteRank.js";
import {
  extractCityStateZip,
  extractHouseNumberFromStreetLine,
  hasUsableGeometry,
  houseNumbersMatch,
  isQuickRouteZip,
  isSouthBendLocality,
  isWithinQuickRouteBounds,
  parsePartialAddress,
  requestedStreetMatchesCandidate,
  streetPortion,
} from "./addressMatch.js";
import { getCachedPlaceGeometry } from "./addressAutocomplete.js";
import { haversineMeters } from "./addressAutocompleteRank.js";

export type VerificationStatus = "unresolved" | "needs_review" | "verified";
export type VerificationMethod = "provider" | "manual_pin";

export interface SuggestionLike {
  placeId: string;
  displayName: string;
  lat?: number;
  lng?: number;
  confidence: AddressConfidence;
  city?: string;
  state?: string;
  zip?: string;
  houseNumber?: string;
  street?: string;
}

export interface AddressEvaluation {
  verificationStatus: VerificationStatus;
  canConfirm: boolean;
  reasons: string[];
}

const PLACE_GEOMETRY_TOLERANCE_METERS = 150;

export { parsePastedAddresses } from "./addressSegmenter.js";

export function evaluateAddressSuggestion(
  rawInput: string,
  suggestion: SuggestionLike
): AddressEvaluation {
  const reasons: string[] = [];
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
    ? houseNumbersMatch(parsedInput.houseNumber, candidateHouse) ||
      (candidateHouse === undefined &&
        parsedInput.houseNumber !== undefined &&
        new RegExp(`\\b${parsedInput.houseNumber}\\b`, "i").test(streetLine))
    : false;
  const streetOk = requestedStreetMatchesCandidate(rawInput, streetLine);
  const cityOk = isSouthBendLocality(city);
  const zipOk = isQuickRouteZip(zip);
  const strong = isStrongConfidence(suggestion.confidence);

  if (!geometryOk) reasons.push("missing geometry");
  if (!parsedInput.houseNumber) reasons.push("missing house number");
  if (parsedInput.houseNumber && !houseOk) reasons.push("house number mismatch");
  if (!streetOk) reasons.push("street mismatch");
  if (!cityOk) reasons.push("locality is not South Bend");
  if (!zipOk) reasons.push("ZIP is not 46613 or 46614");
  if (!strong) reasons.push("confidence is not strong enough to auto-verify");

  const canConfirm = Boolean(
    geometryOk && parsedInput.houseNumber && houseOk && streetOk && cityOk && zipOk
  );

  if (canConfirm && strong) {
    return { verificationStatus: "verified", canConfirm: true, reasons: [] };
  }
  if (canConfirm || (geometryOk && streetOk)) {
    return { verificationStatus: "needs_review", canConfirm, reasons };
  }
  if (geometryOk && !streetOk && parsedInput.houseNumber) {
    return { verificationStatus: "needs_review", canConfirm: false, reasons };
  }
  return { verificationStatus: "needs_review", canConfirm: false, reasons };
}

export interface VerifiedStopCoords {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  verificationMethod: VerificationMethod;
}

function hasAddressText(stop: { address?: unknown; rawInput?: unknown }): boolean {
  if (typeof stop.address === "string" && stop.address.trim().length > 0) return true;
  if (typeof stop.rawInput === "string" && stop.rawInput.trim().length > 0) return true;
  return false;
}

function validateManualPinStop(stop: {
  address?: unknown;
  rawInput?: unknown;
  lat?: unknown;
  lng?: unknown;
  verificationStatus?: unknown;
  verificationMethod?: unknown;
}): { ok: true; stop: VerifiedStopCoords } | { ok: false; error: string } {
  if (stop.verificationStatus !== "verified" || stop.verificationMethod !== "manual_pin") {
    return {
      ok: false,
      error: "Manual pin stops must be explicitly verified with verificationMethod manual_pin.",
    };
  }
  if (!hasAddressText(stop)) {
    return { ok: false, error: "Each manually verified stop must include the original address." };
  }
  if (typeof stop.lat !== "number" || typeof stop.lng !== "number") {
    return { ok: false, error: "Each manually verified stop must include numeric lat/lng." };
  }
  if (!hasUsableGeometry(stop.lat, stop.lng)) {
    return { ok: false, error: "Stop coordinates are missing or not a valid lat/lng." };
  }
  if (!isWithinQuickRouteBounds(stop.lat, stop.lng)) {
    return {
      ok: false,
      error: `Coordinates for "${typeof stop.address === "string" ? stop.address : "stop"}" are outside the Quick Route service area.`,
    };
  }

  const address =
    typeof stop.address === "string" && stop.address.trim()
      ? stop.address.trim()
      : String(stop.rawInput).trim();

  return {
    ok: true,
    stop: {
      address,
      lat: stop.lat,
      lng: stop.lng,
      verificationMethod: "manual_pin",
    },
  };
}

export function validateVerifiedStopCoords(stop: {
  address?: unknown;
  rawInput?: unknown;
  lat?: unknown;
  lng?: number | unknown;
  placeId?: unknown;
  verificationStatus?: unknown;
  verificationMethod?: unknown;
}): { ok: true; stop: VerifiedStopCoords } | { ok: false; error: string } {
  if (stop.verificationStatus !== "verified") {
    return {
      ok: false,
      error: "Each Quick Route stop must be verified before route optimization.",
    };
  }

  if (stop.verificationMethod === "manual_pin") {
    return validateManualPinStop(stop);
  }

  if (typeof stop.address !== "string" || stop.address.trim().length === 0) {
    return { ok: false, error: "Each verified stop must include an address." };
  }
  if (typeof stop.placeId !== "string" || stop.placeId.trim().length === 0) {
    return { ok: false, error: "Each verified stop must include a placeId." };
  }
  if (typeof stop.lat !== "number" || typeof stop.lng !== "number") {
    return { ok: false, error: "Each verified stop must include numeric lat/lng." };
  }
  if (!hasUsableGeometry(stop.lat, stop.lng)) {
    return { ok: false, error: "Stop coordinates are missing or not a valid lat/lng." };
  }
  if (!isWithinQuickRouteBounds(stop.lat, stop.lng)) {
    return {
      ok: false,
      error: `Coordinates for "${stop.address}" are outside the Quick Route service area.`,
    };
  }

  const cached = getCachedPlaceGeometry(stop.placeId);
  if (cached) {
    const drift = haversineMeters(cached, { lat: stop.lat, lng: stop.lng });
    if (drift > PLACE_GEOMETRY_TOLERANCE_METERS) {
      return {
        ok: false,
        error: `Coordinates for "${stop.address}" do not match the known place geometry.`,
      };
    }
  }

  return {
    ok: true,
    stop: {
      address: stop.address.trim(),
      lat: stop.lat,
      lng: stop.lng,
      placeId: stop.placeId.trim(),
      verificationMethod: "provider",
    },
  };
}

export function isValidStartCoords(coords: { lat: number; lng: number } | undefined): boolean {
  if (!coords) return false;
  return hasUsableGeometry(coords.lat, coords.lng);
}

export interface EditableStop {
  id: string;
  rawInput: string;
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  confidence?: AddressConfidence;
  verificationStatus: VerificationStatus;
  verificationMethod?: VerificationMethod;
  verificationProvider?: string;
  manualVerifiedAt?: string;
}

export function applyStopTextEdit<T extends EditableStop>(stop: T, text: string): T {
  if (stop.address === text) return stop;
  return {
    ...stop,
    rawInput: text,
    address: text,
    lat: undefined,
    lng: undefined,
    placeId: undefined,
    confidence: undefined,
    verificationStatus: "unresolved" as const,
    verificationMethod: undefined,
    verificationProvider: undefined,
    manualVerifiedAt: undefined,
  };
}

export function migrateLegacyQuickRouteStop(raw: { id: string; address: string }): EditableStop {
  return {
    id: raw.id,
    rawInput: raw.address,
    address: raw.address,
    verificationStatus: "unresolved",
  };
}
