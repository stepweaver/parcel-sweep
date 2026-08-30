import {
  type CardinalDirection,
  type ParsedPartialAddress,
  STREET_SUFFIX_RE,
  candidateHasHouseNumber,
  extractCityStateZip,
  extractHouseNumberFromStreetLine,
  hasFullCardinal,
  hasUsableGeometry,
  isQuickRouteServiceAreaResult,
  isQuickRouteZip,
  isSouthBendLocality,
  normalizeDirectional,
  parsePartialAddress,
  queryHasLocality,
  requestedStreetMatchesCandidate,
  streetCoreWords,
  streetPortion,
  streetsEquivalent,
} from "./addressMatch.js";

export type {
  CardinalDirection,
  ParsedPartialAddress,
} from "./addressMatch.js";

export {
  parsePartialAddress,
  queryHasLocality,
  hasFullCardinal,
  normalizeDirectional,
  streetPortion,
  candidateHasHouseNumber,
  normalizeStreetCore,
  streetCoreWords,
  streetsEquivalent,
  requestedStreetMatchesCandidate,
} from "./addressMatch.js";

export type AddressConfidence =
  | "verified_rooftop"
  | "verified_parcel"
  | "interpolated"
  | "street_matched_number_unverified"
  | "street_only"
  | "ambiguous";

export interface AutocompleteSuggestion {
  placeId: string;
  displayName: string;
  lat?: number;
  lng?: number;
  confidence: AddressConfidence;
  rankReason: string;
  distanceMeters?: number;
  city?: string;
  state?: string;
  zip?: string;
  houseNumber?: string;
  street?: string;
}

export interface RankCandidate extends AutocompleteSuggestion {
  provider: "google" | "photon" | "nominatim";
  hasGeometry: boolean;
  houseNumberVerified?: boolean;
}

const CONFIDENCE_SCORE: Record<AddressConfidence, number> = {
  verified_rooftop: 80,
  verified_parcel: 60,
  interpolated: 20,
  street_matched_number_unverified: -20,
  street_only: -40,
  ambiguous: -80,
};

const STRONG_CONFIDENCE: ReadonlySet<AddressConfidence> = new Set([
  "verified_rooftop",
  "verified_parcel",
]);

export function isStrongConfidence(confidence: AddressConfidence): boolean {
  return STRONG_CONFIDENCE.has(confidence);
}

export function expandSearchQueries(
  q: string,
  city: string,
  state: string,
  serviceAreaOnly = true
): string[] {
  const trimmed = q.replace(/\s+/g, " ").trim();
  if (!serviceAreaOnly) {
    return trimmed.length >= 3 ? [trimmed] : [];
  }

  const parsed = parsePartialAddress(q);
  const locality = `${city} ${state}`;
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length < 3 || seen.has(t)) return;
    seen.add(t);
    ordered.push(t);
  };

  // Literal user input is always query #1. Guessed expansions never outrank it.
  add(queryHasLocality(q, city, state) ? trimmed : `${trimmed} ${locality}`);

  if (parsed.houseNumber && parsed.streetPart) {
    const { houseNumber, streetPart, preDirectional } = parsed;
    const dir = preDirectional ?? "";
    const hasSuffix = Boolean(parsed.suffix) || STREET_SUFFIX_RE.test(streetPart);
    const hasCardinal = Boolean(preDirectional) || hasFullCardinal(streetPart);

    if (!hasSuffix) {
      add(`${houseNumber} ${dir} ${streetPart} Street ${locality}`);
      add(`${houseNumber} ${dir} ${streetPart} Avenue ${locality}`);
    }
    // Guessed directionals only when the user did not type one.
    if (!hasCardinal) {
      add(`${houseNumber} East ${streetPart} ${locality}`);
      add(`${houseNumber} West ${streetPart} ${locality}`);
    }
  } else if (
    parsed.streetPart &&
    !parsed.houseNumber &&
    !parsed.suffix &&
    !STREET_SUFFIX_RE.test(parsed.streetPart) &&
    !hasFullCardinal(parsed.streetPart)
  ) {
    add(`${parsed.streetPart} Street ${locality}`);
    add(`${parsed.streetPart} Avenue ${locality}`);
    add(`East ${parsed.streetPart} ${locality}`);
    add(`West ${parsed.streetPart} ${locality}`);
  }

  return ordered.slice(0, 6);
}

export function extractCandidateDirectional(streetLine: string): CardinalDirection | undefined {
  const withoutNumber = streetLine.replace(/^\d+[a-zA-Z]?\s+/, "").trim();
  const pre = withoutNumber.match(/^(East|West|North|South|E|W|N|S)\.?\s+/i);
  if (pre) return normalizeDirectional(pre[1]);
  const post = withoutNumber.match(/\s+(East|West|North|South|E|W|N|S)\.?$/i);
  if (post) return normalizeDirectional(post[1]);
  return undefined;
}

export function streetQueryTokens(streetPart: string): string[] {
  const cleaned = streetPart.trim().toLowerCase();
  if (!cleaned) return [];
  return streetCoreWords(cleaned);
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function inputDirectional(parsed: ParsedPartialAddress): CardinalDirection | undefined {
  return parsed.preDirectional ?? parsed.postDirectional;
}

function scoreDirectional(parsed: ParsedPartialAddress, candidateDir: CardinalDirection | undefined): number {
  const inputDir = inputDirectional(parsed);
  if (inputDir && candidateDir) {
    return inputDir === candidateDir ? 90 : -120;
  }
  if (inputDir && !candidateDir) return -30;
  return 0;
}

function proximityScore(meters: number): number {
  if (meters <= 250) return 40;
  if (meters <= 1000) return 20;
  if (meters <= 3000) return 8;
  return 0;
}

function candidateStreetLine(candidate: RankCandidate): string {
  return candidate.street
    ? [candidate.houseNumber, candidate.street].filter(Boolean).join(" ")
    : streetPortion(candidate.displayName);
}

function candidateHouseNumber(candidate: RankCandidate): string | undefined {
  return (
    candidate.houseNumber ??
    extractHouseNumberFromStreetLine(streetPortion(candidate.displayName))
  );
}

function localityMatchesServiceArea(candidate: RankCandidate, enforceServiceArea: boolean): boolean {
  if (!enforceServiceArea) return true;
  return isQuickRouteServiceAreaResult({
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    lat: candidate.lat,
    lng: candidate.lng,
    displayName: candidate.displayName,
  });
}

export function streetMatchesRequest(parsed: ParsedPartialAddress, candidate: RankCandidate): boolean {
  const streetLine = candidateStreetLine(candidate);
  if (!parsed.streetPart) return false;
  if (requestedStreetMatchesCandidate(parsed.streetPart, streetLine)) return true;
  const reconstructed = [parsed.preDirectional, parsed.streetPart, parsed.suffix]
    .filter(Boolean)
    .join(" ");
  return streetsEquivalent(reconstructed, streetLine);
}

export function houseMatchesRequest(parsed: ParsedPartialAddress, candidate: RankCandidate): boolean {
  if (!parsed.houseNumber) return false;
  const candidateHouse = candidateHouseNumber(candidate);
  if (candidateHouse && parsed.houseNumber.toLowerCase() === candidateHouse.toLowerCase()) {
    return true;
  }
  return candidateHasHouseNumber(candidateStreetLine(candidate), parsed.houseNumber);
}

/**
 * Strong/exact confidence requires house + street + (when enforced) service area + geometry.
 * Provider parcel metadata cannot substitute for an address-component match.
 */
export function deriveConfidence(
  candidate: RankCandidate,
  parsed: ParsedPartialAddress,
  enforceServiceArea = false
): AddressConfidence {
  const streetLine = candidateStreetLine(candidate);
  const hasHouseInLine = /\d/.test(streetLine);
  const geometryOk = candidate.hasGeometry && hasUsableGeometry(candidate.lat, candidate.lng);
  const streetOk = parsed.streetPart ? streetMatchesRequest(parsed, candidate) : false;
  const houseOk = parsed.houseNumber ? houseMatchesRequest(parsed, candidate) : false;
  const areaOk = localityMatchesServiceArea(candidate, enforceServiceArea);

  if (!geometryOk) return "ambiguous";

  if (parsed.houseNumber && parsed.streetPart && houseOk && !streetOk) {
    // Same number, different street — never Exact / verified_parcel.
    return "ambiguous";
  }

  if (parsed.houseNumber && houseOk && streetOk && areaOk && geometryOk) {
    if (candidate.provider === "google") return "verified_rooftop";
    if (candidate.houseNumberVerified === true) return "verified_parcel";
    return "interpolated";
  }

  if (parsed.houseNumber) {
    if (streetOk && !houseOk && !hasHouseInLine) return "street_only";
    if (streetOk && houseOk && !areaOk) return "interpolated";
    if (streetOk) return "street_matched_number_unverified";
    return "ambiguous";
  }

  if (streetOk && areaOk) return "street_only";
  if (!hasHouseInLine) return "street_only";
  return "interpolated";
}

export function buildRankReason(
  confidence: AddressConfidence,
  distanceMeters: number | undefined,
  parsed: ParsedPartialAddress,
  candidateDir: CardinalDirection | undefined,
  streetOk: boolean
): string {
  const inputDir = inputDirectional(parsed);
  if (parsed.houseNumber && parsed.streetPart && !streetOk) {
    return "Street does not match";
  }
  if (inputDir && candidateDir && inputDir !== candidateDir) {
    return "Different direction — check carefully";
  }
  if (confidence === "verified_rooftop" || confidence === "verified_parcel") {
    if (distanceMeters !== undefined && distanceMeters <= 500) return "Closest exact match";
    return "Exact number, farther away";
  }
  if (confidence === "street_only") return "Street match only";
  if (confidence === "interpolated") return "Approximate / interpolated";
  if (confidence === "street_matched_number_unverified") return "Needs confirmation";
  if (confidence === "ambiguous") return "Needs confirmation";
  if (!inputDir && candidateDir && distanceMeters !== undefined && distanceMeters <= 1000) {
    return `${candidateDir === "E" ? "East" : candidateDir === "W" ? "West" : candidateDir === "N" ? "North" : "South"} — closer to your location`;
  }
  return "Suggested match";
}

export function scoreCandidate(
  candidate: RankCandidate,
  parsed: ParsedPartialAddress,
  near: { lat: number; lng: number },
  enforceServiceArea = false
): number {
  const streetLine = candidateStreetLine(candidate);
  const candidateDir = extractCandidateDirectional(streetLine);
  let score = 0;

  const streetOk = parsed.streetPart ? streetMatchesRequest(parsed, candidate) : false;
  const houseOk = parsed.houseNumber ? houseMatchesRequest(parsed, candidate) : false;

  if (parsed.houseNumber) {
    if (houseOk) {
      score += candidate.houseNumberVerified === true ? 220 : 120;
      if (candidate.houseNumberVerified === false) score -= 300;
    } else {
      score -= 120;
    }
  }

  if (!parsed.streetPart) {
    score += 5;
  } else if (streetOk) {
    score += 80;
  } else {
    // A matching house number must never rescue a mismatching street.
    score -= 240;
    if (houseOk) score -= 200;
  }

  score += scoreDirectional(parsed, candidateDir);

  if (parsed.suffix) {
    const suffixRe = new RegExp(`\\b${parsed.suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 3)}`, "i");
    if (suffixRe.test(streetLine)) score += 20;
  }

  if (parsed.houseNumber && !/\d/.test(streetLine)) score -= 30;

  const fromDisplay = extractCityStateZip(candidate.displayName);
  const city = candidate.city ?? fromDisplay.city;
  const zip = candidate.zip ?? fromDisplay.zip;
  if (isSouthBendLocality(city)) score += 20;
  if (isQuickRouteZip(zip)) score += 15;

  const confidence = deriveConfidence(candidate, parsed, enforceServiceArea);
  score += CONFIDENCE_SCORE[confidence];

  if (candidate.hasGeometry && hasUsableGeometry(candidate.lat, candidate.lng)) {
    const dMeters = haversineMeters(near, { lat: candidate.lat!, lng: candidate.lng! });
    score += proximityScore(dMeters);
    score -= dMeters / 8000;
  } else {
    score -= 25;
  }

  return score;
}

export interface MergeAndRankOptions {
  enforceServiceArea?: boolean;
}

export function mergeAndRank(
  candidates: RankCandidate[],
  parsed: ParsedPartialAddress,
  near: { lat: number; lng: number },
  limit: number,
  options: MergeAndRankOptions = {}
): AutocompleteSuggestion[] {
  const enforceServiceArea = options.enforceServiceArea === true;
  const seen = new Set<string>();
  const ranked = candidates
    .filter((c) => {
      if (!enforceServiceArea) return true;
      return isQuickRouteServiceAreaResult({
        city: c.city,
        state: c.state,
        zip: c.zip,
        lat: c.lat,
        lng: c.lng,
        displayName: c.displayName,
      });
    })
    .map((c) => {
      const confidence = deriveConfidence(c, parsed, enforceServiceArea);
      const streetLine = candidateStreetLine(c);
      const candidateDir = extractCandidateDirectional(streetLine);
      const streetOk = parsed.streetPart ? streetMatchesRequest(parsed, c) : false;
      const distanceMeters =
        c.hasGeometry && hasUsableGeometry(c.lat, c.lng)
          ? haversineMeters(near, { lat: c.lat!, lng: c.lng! })
          : undefined;
      const rankReason = buildRankReason(confidence, distanceMeters, parsed, candidateDir, streetOk);
      return {
        ...c,
        confidence,
        rankReason,
        distanceMeters,
        streetOk,
        _score: scoreCandidate({ ...c, confidence }, parsed, near, enforceServiceArea),
      };
    })
    .sort((a, b) => b._score - a._score)
    .filter((s) => {
      const key = s.displayName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Same house number + different street must not surface as a valid candidate.
  const eligible = ranked.filter((s) => {
    if (parsed.houseNumber && parsed.streetPart && !s.streetOk) return false;
    return true;
  });

  let picked = eligible.filter((s) => {
    if (parsed.houseNumber && parsed.streetPart) return s._score >= 40;
    return s._score > -20;
  });

  if (picked.length === 0 && parsed.streetPart) {
    picked = eligible.filter((s) => s.streetOk);
  }
  if (picked.length === 0) picked = eligible;

  return picked.slice(0, limit).map(
    ({
      placeId,
      displayName,
      lat,
      lng,
      confidence,
      rankReason,
      distanceMeters,
      city,
      state,
      zip,
      houseNumber,
      street,
      hasGeometry,
    }) => ({
      placeId,
      displayName,
      lat: hasGeometry && hasUsableGeometry(lat, lng) ? lat : undefined,
      lng: hasGeometry && hasUsableGeometry(lat, lng) ? lng : undefined,
      confidence,
      rankReason,
      distanceMeters,
      city,
      state,
      zip,
      houseNumber,
      street,
    })
  );
}

/** ~150 m location buckets for cache keys (geohash precision ≈ 7). */
export function locationBucket(lat: number, lng: number, decimals = 3): string {
  const factor = 10 ** decimals;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
}

export function autocompleteCacheKey(opts: {
  q: string;
  near?: { lat: number; lng: number };
  city?: string;
  state?: string;
  serviceAreaOnly?: boolean;
}): string {
  const near = opts.near ? locationBucket(opts.near.lat, opts.near.lng) : "";
  const area = opts.serviceAreaOnly === false ? "all" : "local";
  return `${opts.q.toLowerCase()}|${near}|${opts.city ?? ""}|${opts.state ?? ""}|${area}`;
}

/** Used only when nationwide search is intentionally enabled (not Quick Route stops). */
export function shouldRetryNationwide(q: string, city: string): boolean {
  const lower = q.toLowerCase();
  if (lower.includes(",")) return !lower.includes(city.toLowerCase());
  if (/\b\d{5}(?:-\d{4})?\b/.test(q)) return !/\b466\d{2}\b/.test(q);
  return q.trim().length >= 12;
}

export function shouldUseNationwideFallback(serviceAreaOnly: boolean, q: string, city: string): boolean {
  if (serviceAreaOnly) return false;
  return shouldRetryNationwide(q, city);
}

export class LruCache<T> {
  private readonly map = new Map<string, { expires: number; value: T }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number
  ) {}

  get(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(key, { expires: Date.now() + this.ttlMs, value });
  }
}
