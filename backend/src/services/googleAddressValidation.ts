import axios from "axios";
import {
  evaluateGoogleValidation,
  extractUserZip,
  streetLineForValidation,
  type GoogleAddressValidationResponse,
  type GoogleValidationDecision,
} from "./googleAddressValidationAdapter.js";

const VALIDATE_URL = "https://addressvalidation.googleapis.com/v1:validateAddress";
const CACHE_MAX = 200;

export const GOOGLE_ADDRESS_VALIDATION_PROVIDER = "google_address_validation";

export function isGoogleAddressValidationConfigured(): boolean {
  return Boolean(process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim());
}

export function isGoogleAddressValidationCassEnabled(): boolean {
  const raw = process.env.GOOGLE_ADDRESS_VALIDATION_ENABLE_CASS?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

interface CacheEntry {
  decision: GoogleValidationDecision;
  storedAt: number;
}

const responseCache = new Map<string, CacheEntry>();

function cacheKey(input: string): string {
  const zip = extractUserZip(input) ?? "";
  const line = streetLineForValidation(input).toLowerCase().replace(/\s+/g, " ").trim();
  return `${line}|${zip}`;
}

function remember(key: string, decision: GoogleValidationDecision): void {
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { decision, storedAt: Date.now() });
}

export function clearGoogleAddressValidationCache(): void {
  responseCache.clear();
}

export function buildGoogleValidationRequest(input: string): {
  address: {
    regionCode: "US";
    locality: "South Bend";
    administrativeArea: "IN";
    addressLines: string[];
    postalCode?: string;
  };
  enableUspsCass?: boolean;
} {
  const address: {
    regionCode: "US";
    locality: "South Bend";
    administrativeArea: "IN";
    addressLines: string[];
    postalCode?: string;
  } = {
    regionCode: "US",
    locality: "South Bend",
    administrativeArea: "IN",
    addressLines: [streetLineForValidation(input)],
  };
  const zip = extractUserZip(input);
  if (zip) address.postalCode = zip;

  const body: {
    address: typeof address;
    enableUspsCass?: boolean;
  } = { address };
  if (isGoogleAddressValidationCassEnabled()) {
    body.enableUspsCass = true;
  }
  return body;
}

export class GoogleAddressValidationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAddressValidationUnavailableError";
  }
}

async function requestGoogleValidation(input: string): Promise<GoogleAddressValidationResponse> {
  const apiKey = process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY?.trim();
  if (!apiKey) {
    throw new GoogleAddressValidationUnavailableError("Google Address Validation is not configured");
  }

  try {
    const response = await axios.post<GoogleAddressValidationResponse>(
      `${VALIDATE_URL}?key=${encodeURIComponent(apiKey)}`,
      buildGoogleValidationRequest(input),
      {
        timeout: 5000,
        headers: { "Content-Type": "application/json" },
        validateStatus: (status) => status < 500,
      }
    );
    if (response.status >= 400) {
      throw new GoogleAddressValidationUnavailableError(
        `Google Address Validation HTTP ${response.status}`
      );
    }
    if (response.data?.error) {
      throw new GoogleAddressValidationUnavailableError(
        response.data.error.message ?? response.data.error.status ?? "Google Address Validation error"
      );
    }
    return response.data;
  } catch (err) {
    if (err instanceof GoogleAddressValidationUnavailableError) throw err;
    const raw = err instanceof Error ? err.message : "Google Address Validation request failed";
    const message = raw.replace(/key=[^&\s]+/gi, "key=REDACTED");
    throw new GoogleAddressValidationUnavailableError(message);
  }
}

function logDecision(input: string, decision: GoogleValidationDecision, providerStatus: string): void {
  console.log("[geocode:google]", {
    normalizedAddress: streetLineForValidation(input),
    provider: GOOGLE_ADDRESS_VALIDATION_PROVIDER,
    providerStatus,
    validationGranularity: decision.meta.validationGranularity,
    geocodeGranularity: decision.meta.geocodeGranularity,
    addressComplete: decision.meta.addressComplete,
    finalStatus: decision.status,
    rejectionReason: decision.reason ?? null,
  });
}

/**
 * Validate a Quick Route address with Google Address Validation when configured.
 * Returns null when the service is not configured. Throws when configured but unavailable.
 */
export async function validateQuickRouteAddress(
  input: string
): Promise<GoogleValidationDecision | null> {
  if (!isGoogleAddressValidationConfigured()) return null;

  const key = cacheKey(input);
  const cached = responseCache.get(key);
  if (cached) {
    logDecision(input, cached.decision, "cache");
    return cached.decision;
  }

  const raw = await requestGoogleValidation(input);
  const decision = evaluateGoogleValidation(input, raw);
  remember(key, decision);

  logDecision(input, decision, "ok");
  return decision;
}
