import type { AddressConfidence } from "./addressAutocompleteRank.js";
import {
  extractHouseNumberFromStreetLine,
  hasUsableGeometry,
  houseNumbersMatch,
  isQuickRouteZip,
  isSouthBendLocality,
  normalizeStreetCore,
  normalizeZip,
  parsePartialAddress,
  requestedStreetMatchesCandidate,
  streetPortion,
} from "./addressMatch.js";
import {
  evaluateAddressSuggestion,
  type SuggestionLike,
  type VerificationStatus,
} from "./quickRouteVerify.js";

export const GOOGLE_ADDRESS_VALIDATION_PROVIDER = "google_address_validation";

const PREMISE_VALIDATION = new Set(["PREMISE", "SUB_PREMISE"]);
const PREMISE_GEOCODE = new Set(["PREMISE", "SUB_PREMISE", "PREMISE_PROXIMITY"]);
const AREA_LEVEL_VALIDATION = new Set([
  "ROUTE",
  "BLOCK",
  "LOCALITY",
  "OTHER",
  "GRANULARITY_UNSPECIFIED",
]);

const STREET_OR_HOUSE_TYPES = new Set(["street_number", "route"]);

export interface GooglePostalAddress {
  regionCode?: string;
  languageCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
}

export interface GoogleAddressComponent {
  componentName?: { text?: string; languageCode?: string };
  componentType?: string;
  confirmationLevel?: string;
  inferred?: boolean;
  spellCorrected?: boolean;
  replaced?: boolean;
  unexpected?: boolean;
}

export interface GoogleAddressValidationResponse {
  result?: {
    verdict?: {
      inputGranularity?: string;
      validationGranularity?: string;
      geocodeGranularity?: string;
      addressComplete?: boolean;
      hasUnconfirmedComponents?: boolean;
      hasInferredComponents?: boolean;
      hasReplacedComponents?: boolean;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: GooglePostalAddress;
      addressComponents?: GoogleAddressComponent[];
      missingComponentTypes?: string[];
      unconfirmedComponentTypes?: string[];
      unresolvedTokens?: string[];
    };
    geocode?: {
      location?: { latitude?: number; longitude?: number };
      placeId?: string;
      placeTypes?: string[];
    };
    uspsData?: {
      standardizedAddress?: {
        firstAddressLine?: string;
        cityStateZipAddressLine?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        zipCodeExtension?: string;
      };
      dpvConfirmation?: string;
    };
  };
  error?: { code?: number; message?: string; status?: string };
}

export interface ChangedComponent {
  type: string;
  suggested?: string;
  kind: "replaced" | "spell_corrected" | "inferred" | "unconfirmed";
}

export interface GoogleValidationMeta {
  addressComplete: boolean;
  validationGranularity: string;
  geocodeGranularity: string;
  hasUnconfirmedComponents: boolean;
  hasInferredComponents: boolean;
  hasReplacedComponents: boolean;
  formattedAddress?: string;
  houseNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  geometryOk: boolean;
  materialStreetOrHouseChange: boolean;
  unconfirmedStreetOrHouse: boolean;
  inServiceArea: boolean;
  changedComponents: ChangedComponent[];
  rejectionReason?: string;
}

export interface SuggestedCorrection {
  explanation: string;
  changedComponents: string[];
  candidate: SuggestionLike;
}

export interface GoogleValidationDecision {
  status: VerificationStatus;
  candidate?: SuggestionLike;
  reason?: string;
  suggestedCorrection?: SuggestedCorrection;
  meta: GoogleValidationMeta;
}

function componentText(
  components: GoogleAddressComponent[] | undefined,
  type: string
): string | undefined {
  const hit = components?.find((c) => c.componentType === type);
  const text = hit?.componentName?.text?.trim();
  return text || undefined;
}

function confirmationOf(
  components: GoogleAddressComponent[] | undefined,
  type: string
): string | undefined {
  return components?.find((c) => c.componentType === type)?.confirmationLevel;
}

function buildStreetLine(houseNumber: string | undefined, street: string | undefined): string {
  return [houseNumber, street].filter(Boolean).join(" ");
}

function googleConfidence(
  validationGranularity: string,
  geocodeGranularity: string,
  addressComplete: boolean
): AddressConfidence {
  if (
    addressComplete &&
    PREMISE_VALIDATION.has(validationGranularity) &&
    PREMISE_GEOCODE.has(geocodeGranularity)
  ) {
    return "verified_parcel";
  }
  if (validationGranularity === "ROUTE" || geocodeGranularity === "ROUTE") {
    return "street_only";
  }
  return "ambiguous";
}

function describeChange(input: string, meta: GoogleValidationMeta): string {
  const parsed = parsePartialAddress(input);
  const parts: string[] = [];
  const inputCore = normalizeStreetCore(input);
  const googleCore = meta.street ? normalizeStreetCore(meta.street) : "";
  if (inputCore && googleCore && inputCore !== googleCore) {
    parts.push(`street ${inputCore} → ${googleCore}`);
  }
  if (
    parsed.houseNumber &&
    meta.houseNumber &&
    !houseNumbersMatch(parsed.houseNumber, meta.houseNumber)
  ) {
    parts.push(`house ${parsed.houseNumber} → ${meta.houseNumber}`);
  }
  if (parts.length === 0 && meta.changedComponents.length > 0) {
    return meta.changedComponents
      .map((c) => `${c.type}${c.suggested ? ` → ${c.suggested}` : ""} (${c.kind})`)
      .join("; ");
  }
  if (parts.length === 0) {
    return "Google suggested a standardized address that differs from the original.";
  }
  return `Google suggested a different ${parts.join(" and ")}.`;
}

/**
 * Convert a Google Address Validation payload into Parcel Sweep's candidate
 * model. Does not auto-verify: callers must run Phase 1 matching plus the
 * Google-specific gates in evaluateGoogleValidation.
 */
export function adaptGoogleValidationResponse(
  input: string,
  response: GoogleAddressValidationResponse
): { candidate?: SuggestionLike; meta: GoogleValidationMeta } {
  const result = response.result;
  const verdict = result?.verdict ?? {};
  const components = result?.address?.addressComponents;
  const postal = result?.address?.postalAddress;
  const usps = result?.uspsData?.standardizedAddress;
  const location = result?.geocode?.location;

  const houseNumber =
    componentText(components, "street_number") ??
    extractHouseNumberFromStreetLine(postal?.addressLines?.[0] ?? usps?.firstAddressLine ?? "");
  const street =
    componentText(components, "route") ??
    (usps?.firstAddressLine
      ? usps.firstAddressLine.replace(/^\d+[a-zA-Z]?\s+/, "").trim()
      : undefined);
  const city = postal?.locality ?? componentText(components, "locality") ?? usps?.city;
  const state =
    postal?.administrativeArea ?? componentText(components, "administrative_area_level_1") ?? usps?.state;
  const zip =
    normalizeZip(postal?.postalCode) ??
    normalizeZip(componentText(components, "postal_code")) ??
    normalizeZip(usps?.zipCode);
  const formattedAddress = result?.address?.formattedAddress;
  const lat = location?.latitude;
  const lng = location?.longitude;
  const placeId = result?.geocode?.placeId?.trim() || undefined;
  const geometryOk = hasUsableGeometry(lat, lng);

  const streetLine = buildStreetLine(houseNumber, street);
  const displayStreet = streetLine || streetPortion(formattedAddress ?? input);
  const parsedInput = parsePartialAddress(input);

  const changedComponents: ChangedComponent[] = [];
  for (const component of components ?? []) {
    const type = component.componentType ?? "unknown";
    const suggested = component.componentName?.text;
    if (component.replaced) {
      changedComponents.push({ type, suggested, kind: "replaced" });
    } else if (component.spellCorrected) {
      changedComponents.push({ type, suggested, kind: "spell_corrected" });
    } else if (component.inferred && STREET_OR_HOUSE_TYPES.has(type)) {
      changedComponents.push({ type, suggested, kind: "inferred" });
    } else if (
      component.confirmationLevel === "UNCONFIRMED_AND_SUSPICIOUS" ||
      component.confirmationLevel === "UNCONFIRMED_BUT_PLAUSIBLE"
    ) {
      if (STREET_OR_HOUSE_TYPES.has(type)) {
        changedComponents.push({ type, suggested, kind: "unconfirmed" });
      }
    }
  }

  const streetOk = requestedStreetMatchesCandidate(input, displayStreet);
  const houseOk = parsedInput.houseNumber
    ? houseNumbersMatch(parsedInput.houseNumber, houseNumber)
    : false;
  const materialStreetOrHouseChange = Boolean(parsedInput.houseNumber) && (!streetOk || !houseOk);

  const unconfirmedTypes = new Set(result?.address?.unconfirmedComponentTypes ?? []);
  const unconfirmedStreetOrHouse =
    unconfirmedTypes.has("street_number") ||
    unconfirmedTypes.has("route") ||
    confirmationOf(components, "street_number") === "UNCONFIRMED_AND_SUSPICIOUS" ||
    confirmationOf(components, "route") === "UNCONFIRMED_AND_SUSPICIOUS";

  const inServiceArea = isSouthBendLocality(city) && isQuickRouteZip(zip);

  let rejectionReason: string | undefined;
  if (!result) rejectionReason = "Google Address Validation returned no result";
  else if (!geometryOk) rejectionReason = "missing geometry";
  else if (AREA_LEVEL_VALIDATION.has(verdict.validationGranularity ?? "")) {
    rejectionReason = `validation granularity is ${verdict.validationGranularity}`;
  }

  const meta: GoogleValidationMeta = {
    addressComplete: verdict.addressComplete === true,
    validationGranularity: verdict.validationGranularity ?? "GRANULARITY_UNSPECIFIED",
    geocodeGranularity: verdict.geocodeGranularity ?? "GRANULARITY_UNSPECIFIED",
    hasUnconfirmedComponents: verdict.hasUnconfirmedComponents === true,
    hasInferredComponents: verdict.hasInferredComponents === true,
    hasReplacedComponents: verdict.hasReplacedComponents === true,
    formattedAddress,
    houseNumber,
    street,
    city,
    state,
    zip,
    lat,
    lng,
    placeId,
    geometryOk,
    materialStreetOrHouseChange,
    unconfirmedStreetOrHouse,
    inServiceArea,
    changedComponents,
    rejectionReason,
  };

  if (!formattedAddress && !streetLine) {
    return { meta };
  }

  const localityBits = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const displayName =
    formattedAddress ??
    (displayStreet && localityBits ? `${displayStreet}, ${localityBits}` : displayStreet);

  const candidate: SuggestionLike = {
    placeId: placeId ?? "",
    displayName,
    lat,
    lng,
    confidence: googleConfidence(
      meta.validationGranularity,
      meta.geocodeGranularity,
      meta.addressComplete
    ),
    city,
    state,
    zip,
    houseNumber,
    street,
  };

  return { candidate, meta };
}

export function googleAutoVerifyEligible(meta: GoogleValidationMeta): boolean {
  if (!meta.geometryOk) return false;
  if (!meta.addressComplete) return false;
  if (!PREMISE_VALIDATION.has(meta.validationGranularity)) return false;
  if (!PREMISE_GEOCODE.has(meta.geocodeGranularity)) return false;
  if (!meta.placeId) return false;
  if (meta.materialStreetOrHouseChange) return false;
  if (meta.unconfirmedStreetOrHouse) return false;
  return true;
}

/**
 * Map Google Address Validation through Phase 1 house/street/locality/ZIP
 * matching. Google cannot verify a wrong street or house number, even with
 * usable geometry and a complete verdict.
 */
export function evaluateGoogleValidation(
  input: string,
  response: GoogleAddressValidationResponse
): GoogleValidationDecision {
  const { candidate, meta } = adaptGoogleValidationResponse(input, response);

  if (!candidate) {
    return {
      status: "unresolved",
      reason: meta.rejectionReason ?? "No Google Address Validation result",
      meta,
    };
  }

  const phase1 = evaluateAddressSuggestion(input, {
    ...candidate,
    // Provider-verified Google stops must carry a real Place ID. A synthetic
    // fallback is only used so evaluateAddressSuggestion can run.
    placeId: meta.placeId ?? candidate.placeId,
  });

  if (googleAutoVerifyEligible(meta) && phase1.verificationStatus === "verified") {
    return {
      status: "verified",
      candidate: { ...candidate, placeId: meta.placeId as string },
      meta,
    };
  }

  if (meta.materialStreetOrHouseChange && meta.inServiceArea && meta.geometryOk) {
    const explanation = describeChange(input, meta);
    return {
      status: "needs_review",
      candidate,
      reason: explanation,
      suggestedCorrection: {
        explanation,
        changedComponents: meta.changedComponents.map((c) =>
          c.suggested ? `${c.type}: ${c.suggested}` : c.type
        ),
        candidate,
      },
      meta,
    };
  }

  if (phase1.canConfirm) {
    return {
      status: "needs_review",
      candidate,
      reason: meta.rejectionReason ?? phase1.reasons[0] ?? "Needs confirmation",
      meta,
    };
  }

  return {
    status: "unresolved",
    candidate,
    reason:
      meta.rejectionReason ??
      phase1.reasons[0] ??
      "Google Address Validation did not produce a verified Quick Route match",
    meta,
  };
}

export function extractUserZip(input: string): string | undefined {
  return normalizeZip(input);
}

export function streetLineForValidation(input: string): string {
  const line = streetPortion(input).trim();
  return line || input.trim();
}
