export type AddressConfidence =
  | "verified_rooftop"
  | "verified_parcel"
  | "interpolated"
  | "street_matched_number_unverified"
  | "street_only"
  | "ambiguous";

export type CardinalDirection = "E" | "W" | "N" | "S";

export interface AutocompleteSuggestion {
  placeId: string;
  displayName: string;
  lat: number;
  lng: number;
  confidence: AddressConfidence;
  rankReason: string;
  distanceMeters?: number;
}

export interface ParsedPartialAddress {
  houseNumber?: string;
  preDirectional?: CardinalDirection;
  postDirectional?: CardinalDirection;
  /** Street tokens after house number / directionals, before suffix. */
  streetPart: string;
  suffix?: string;
}

export interface RankCandidate extends AutocompleteSuggestion {
  provider: "google" | "photon" | "nominatim";
  hasGeometry: boolean;
  houseNumberVerified?: boolean;
}

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|cir|circle|pkwy|parkway)\b/i;

const FULL_CARDINAL = /\b(east|west|north|south)\b/i;

const DIRECTIONAL_WORD: Record<string, CardinalDirection> = {
  east: "E",
  west: "W",
  north: "N",
  south: "S",
  e: "E",
  w: "W",
  n: "N",
  s: "S",
};

const CONFIDENCE_SCORE: Record<AddressConfidence, number> = {
  verified_rooftop: 80,
  verified_parcel: 60,
  interpolated: 20,
  street_matched_number_unverified: -20,
  street_only: -40,
  ambiguous: -80,
};

export function normalizeDirectional(token: string): CardinalDirection | undefined {
  return DIRECTIONAL_WORD[token.toLowerCase()];
}

export function parsePartialAddress(q: string): ParsedPartialAddress {
  const trimmed = q.trim();
  const houseMatch = trimmed.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
  let rest = houseMatch ? houseMatch[2].trim() : trimmed;
  const houseNumber = houseMatch?.[1];

  let preDirectional: CardinalDirection | undefined;
  let postDirectional: CardinalDirection | undefined;

  const preMatch = rest.match(/^(East|West|North|South|E|W|N|S)\.?\s+/i);
  if (preMatch) {
    preDirectional = normalizeDirectional(preMatch[1]);
    rest = rest.slice(preMatch[0].length).trim();
  }

  let suffix: string | undefined;
  const suffixMatch = rest.match(
    /\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway)\.?$/i
  );
  if (suffixMatch) {
    suffix = suffixMatch[1].toLowerCase();
    rest = rest.slice(0, -suffixMatch[0].length).trim();
  }

  const postMatch = rest.match(/\s+(East|West|North|South|E|W|N|S)\.?$/i);
  if (postMatch) {
    postDirectional = normalizeDirectional(postMatch[1]);
    rest = rest.slice(0, -postMatch[0].length).trim();
  }

  return { houseNumber, preDirectional, postDirectional, streetPart: rest, suffix };
}

export function queryHasLocality(q: string, city: string, state: string): boolean {
  const lower = q.toLowerCase();
  return (
    lower.includes(city.toLowerCase()) ||
    lower.includes(state.toLowerCase()) ||
    lower.includes("indiana")
  );
}

export function hasFullCardinal(streetPart: string): boolean {
  return FULL_CARDINAL.test(streetPart);
}

export function expandSearchQueries(q: string, city: string, state: string): string[] {
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

  if (parsed.houseNumber && parsed.streetPart) {
    const { houseNumber, streetPart, preDirectional } = parsed;
    const hasSuffix = Boolean(parsed.suffix) || STREET_SUFFIX.test(streetPart);
    const hasCardinal = Boolean(preDirectional) || hasFullCardinal(streetPart);

    if (!hasSuffix && !hasCardinal) {
      add(`${houseNumber} East ${streetPart} ${locality}`);
      add(`${houseNumber} West ${streetPart} ${locality}`);
      add(`${houseNumber} ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} ${streetPart} Street ${locality}`);
    } else if (!hasSuffix) {
      add(`${houseNumber} ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} ${streetPart} Street ${locality}`);
    }
  } else if (
    parsed.streetPart &&
    !parsed.suffix &&
    !STREET_SUFFIX.test(parsed.streetPart) &&
    !hasFullCardinal(parsed.streetPart)
  ) {
    add(`East ${parsed.streetPart} Avenue ${locality}`);
    add(`West ${parsed.streetPart} Avenue ${locality}`);
    add(`${parsed.streetPart} Avenue ${locality}`);
  }

  add(queryHasLocality(q, city, state) ? q : `${q} ${locality}`);
  return ordered.slice(0, 6);
}

export function streetPortion(displayName: string): string {
  return (displayName.split(",")[0] ?? displayName).trim();
}

export function extractCandidateDirectional(streetLine: string): CardinalDirection | undefined {
  const withoutNumber = streetLine.replace(/^\d+[a-zA-Z]?\s+/, "").trim();
  const pre = withoutNumber.match(/^(East|West|North|South|E|W|N|S)\.?\s+/i);
  if (pre) return normalizeDirectional(pre[1]);
  const post = withoutNumber.match(/\s+(East|West|North|South|E|W|N|S)\.?$/i);
  if (post) return normalizeDirectional(post[1]);
  return undefined;
}

/** Street core for fuzzy match — keeps directionals out of token comparison. */
export function normalizeStreetCore(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\d+[a-z]?\s*/, " ")
    .replace(/^(east|west|north|south|e|w|n|s)\.?\s+/i, " ")
    .replace(/\s+(east|west|north|south|e|w|n|s)\.?$/i, " ")
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|terrace|ter|circle|cir|parkway|pkwy)\b/g,
      " "
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function streetCoreWords(text: string): string[] {
  return normalizeStreetCore(text)
    .split(/\s+/)
    .filter((t) => t.length >= 1 && !/^\d+$/.test(t));
}

export function streetQueryTokens(streetPart: string): string[] {
  const cleaned = streetPart.trim().toLowerCase();
  if (!cleaned) return [];
  if (STREET_SUFFIX.test(cleaned) || hasFullCardinal(cleaned)) {
    return streetCoreWords(cleaned);
  }
  return [cleaned.replace(/[^a-z0-9]/g, "")].filter((t) => t.length >= 1);
}

export function fuzzyStreetMatch(queryToken: string, word: string): boolean {
  if (!queryToken || !word) return false;
  if (word.startsWith(queryToken)) return true;
  if (queryToken.length === 1) return word.startsWith(queryToken);

  let qi = 0;
  for (let wi = 0; wi < word.length && qi < queryToken.length; wi++) {
    if (word[wi] === queryToken[qi]) qi++;
  }
  return qi === queryToken.length;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function candidateHasHouseNumber(streetLine: string, houseNumber: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(houseNumber)}\\b`, "i");
  return re.test(streetLine);
}

export function deriveConfidence(
  candidate: RankCandidate,
  parsed: ParsedPartialAddress
): AddressConfidence {
  const streetLine = streetPortion(candidate.displayName);
  const hasHouseInLine = /\d/.test(streetLine);

  if (candidate.provider === "google" && !candidate.hasGeometry) return "ambiguous";

  if (parsed.houseNumber) {
    const exact = candidateHasHouseNumber(streetLine, parsed.houseNumber);
    if (candidate.houseNumberVerified === true && exact) return "verified_parcel";
    if (candidate.houseNumberVerified === false && exact) {
      return "street_matched_number_unverified";
    }
    if (exact) return "interpolated";
    if (!hasHouseInLine) return "street_only";
    return "street_matched_number_unverified";
  }

  if (!hasHouseInLine) return "street_only";
  return "interpolated";
}

export function buildRankReason(
  confidence: AddressConfidence,
  distanceMeters: number | undefined,
  parsed: ParsedPartialAddress,
  candidateDir: CardinalDirection | undefined
): string {
  const inputDir = inputDirectional(parsed);
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
  near: { lat: number; lng: number }
): number {
  const streetLine = streetPortion(candidate.displayName);
  const words = streetCoreWords(streetLine);
  const candidateDir = extractCandidateDirectional(streetLine);
  const lower = candidate.displayName.toLowerCase();
  let score = 0;

  if (parsed.houseNumber) {
    if (candidateHasHouseNumber(streetLine, parsed.houseNumber)) {
      score += candidate.houseNumberVerified === true ? 220 : 120;
      if (candidate.houseNumberVerified === false) score -= 300;
    } else {
      score -= 120;
    }
  }

  const tokens = streetQueryTokens(parsed.streetPart);
  if (tokens.length === 0) {
    score += 5;
  } else {
    let streetMatchCount = 0;
    for (const token of tokens) {
      if (words.some((w) => fuzzyStreetMatch(token, w))) {
        streetMatchCount++;
        score += 80;
      } else {
        score -= 40;
      }
    }
    if (streetMatchCount === 0 && parsed.houseNumber) {
      if (candidateHasHouseNumber(streetLine, parsed.houseNumber)) score -= 90;
    }
  }

  score += scoreDirectional(parsed, candidateDir);

  if (parsed.suffix) {
    const suffixRe = new RegExp(`\\b${escapeRegExp(parsed.suffix.slice(0, 3))}`, "i");
    if (suffixRe.test(streetLine)) score += 20;
  }

  if (parsed.houseNumber && !/\d/.test(streetLine)) score -= 30;

  if (lower.includes("south bend")) score += 20;
  if (/^466\d{2}/.test(candidate.displayName)) score += 10;

  const confidence = deriveConfidence(candidate, parsed);
  score += CONFIDENCE_SCORE[confidence];

  if (candidate.hasGeometry) {
    const dMeters = haversineMeters(near, { lat: candidate.lat, lng: candidate.lng });
    score += proximityScore(dMeters);
    score -= dMeters / 8000;
  } else {
    score -= 25;
  }

  return score;
}

export function mergeAndRank(
  candidates: RankCandidate[],
  parsed: ParsedPartialAddress,
  near: { lat: number; lng: number },
  limit: number
): AutocompleteSuggestion[] {
  const seen = new Set<string>();
  const ranked = candidates
    .map((c) => {
      const confidence = deriveConfidence(c, parsed);
      const streetLine = streetPortion(c.displayName);
      const candidateDir = extractCandidateDirectional(streetLine);
      const distanceMeters = c.hasGeometry
        ? haversineMeters(near, { lat: c.lat, lng: c.lng })
        : undefined;
      const rankReason = buildRankReason(confidence, distanceMeters, parsed, candidateDir);
      return {
        ...c,
        confidence,
        rankReason,
        distanceMeters,
        _score: scoreCandidate({ ...c, confidence }, parsed, near),
      };
    })
    .sort((a, b) => b._score - a._score)
    .filter((s) => {
      const key = s.displayName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const tokens = streetQueryTokens(parsed.streetPart);
  let picked = ranked.filter((s) => {
    if (parsed.houseNumber && tokens.length > 0) return s._score >= 40;
    return s._score > -20;
  });

  if (picked.length === 0 && tokens.length > 0) {
    picked = ranked.filter((s) => {
      const words = streetCoreWords(streetPortion(s.displayName));
      return tokens.some((t) => words.some((w) => fuzzyStreetMatch(t, w)));
    });
  }
  if (picked.length === 0) picked = ranked;

  return picked.slice(0, limit).map(
    ({ placeId, displayName, lat, lng, confidence, rankReason, distanceMeters }) => ({
      placeId,
      displayName,
      lat,
      lng,
      confidence,
      rankReason,
      distanceMeters,
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
}): string {
  const near = opts.near ? locationBucket(opts.near.lat, opts.near.lng) : "";
  return `${opts.q.toLowerCase()}|${near}|${opts.city ?? ""}|${opts.state ?? ""}`;
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
