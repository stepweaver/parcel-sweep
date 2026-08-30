import {
  QUICK_ROUTE_SERVICE_AREA,
  QUICK_ROUTE_ZIP_SET,
} from "../config/quickRouteServiceArea.js";

export type CardinalDirection = "E" | "W" | "N" | "S";

export interface ParsedPartialAddress {
  houseNumber?: string;
  preDirectional?: CardinalDirection;
  postDirectional?: CardinalDirection;
  /** Street tokens after house number / directionals, before suffix. */
  streetPart: string;
  suffix?: string;
}

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

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|cir|circle|pkwy|parkway)\b/i;

const FULL_CARDINAL = /\b(east|west|north|south)\b/i;

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

export function hasFullCardinal(streetPart: string): boolean {
  return FULL_CARDINAL.test(streetPart);
}

export function queryHasLocality(q: string, city: string, state: string): boolean {
  const lower = q.toLowerCase();
  return (
    lower.includes(city.toLowerCase()) ||
    lower.includes(state.toLowerCase()) ||
    lower.includes("indiana")
  );
}

export function normalizeZip(zip: string | undefined): string | undefined {
  const m = (zip ?? "").match(/\b(\d{5})\b/);
  return m?.[1];
}

export function isQuickRouteZip(zip: string | undefined): boolean {
  const n = normalizeZip(zip);
  return n !== undefined && QUICK_ROUTE_ZIP_SET.has(n);
}

export function isSouthBendLocality(city: string | undefined): boolean {
  const n = (city ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;
  return n === "south bend" || n.endsWith(" south bend") || n.startsWith("south bend ");
}

export function isIndianaState(state: string | undefined): boolean {
  const n = (state ?? "").trim().toLowerCase();
  if (!n) return false;
  return n === "in" || n === "indiana";
}

export function hasUsableGeometry(lat: number | undefined, lng: number | undefined): boolean {
  if (lat === undefined || lng === undefined) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

export function isWithinQuickRouteBounds(lat: number, lng: number): boolean {
  const { bounds } = QUICK_ROUTE_SERVICE_AREA;
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

export function streetPortion(displayName: string): string {
  return (displayName.split(",")[0] ?? displayName).trim();
}

export function extractCityStateZip(displayName: string): {
  city?: string;
  state?: string;
  zip?: string;
} {
  const parts = displayName
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^usa$/i.test(p) && !/^united states$/i.test(p));

  let zip: string | undefined;
  let state: string | undefined;
  let city: string | undefined;

  for (let i = parts.length - 1; i >= 1; i--) {
    const part = parts[i];
    const zipMatch = part.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch && !zip) zip = zipMatch[1];

    const stateMatch = part.match(/\b(IN|Indiana|IL|MI|OH|WI)\b/i);
    if (stateMatch && !state) state = stateMatch[1];

    if (!city) {
      const withoutRegion = part
        .replace(/\b(\d{5})(?:-\d{4})?\b/, "")
        .replace(/\b(IN|Indiana|IL|MI|OH|WI)\b/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (withoutRegion && !/^[A-Z]{2}$/i.test(withoutRegion)) {
        city = withoutRegion;
      }
    }
    if (zip && state && city) break;
  }

  return { city, state, zip };
}

export function extractHouseNumberFromStreetLine(streetLine: string): string | undefined {
  const m = streetLine.trim().match(/^(\d+[a-zA-Z]?)\b/);
  return m?.[1];
}

export function houseNumbersMatch(
  requested: string | undefined,
  candidate: string | undefined
): boolean {
  if (!requested || !candidate) return false;
  return requested.toLowerCase() === candidate.toLowerCase();
}

export function candidateHasHouseNumber(streetLine: string, houseNumber: string): boolean {
  const escaped = houseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(streetLine);
}

/**
 * Street core: house number, directionals, and suffix stripped.
 * "S Jackson St" and "South Jackson Street" both become "jackson".
 */
export function normalizeStreetCore(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\d+[a-z]?\s*/, "")
    .trim()
    .replace(/^(east|west|north|south|e|w|n|s)\.?\s+/i, "")
    .trim()
    .replace(/\s+(east|west|north|south|e|w|n|s)\.?$/i, "")
    .trim()
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

/**
 * True when two street strings refer to the same street after harmless
 * abbreviation/punctuation/case normalization.
 *
 * Prefix/subsequence matches are NOT equivalent: Fox ≠ Foxboro.
 */
export function streetsEquivalent(a: string, b: string): boolean {
  const coreA = normalizeStreetCore(a);
  const coreB = normalizeStreetCore(b);
  if (!coreA || !coreB) return false;
  return coreA === coreB;
}

export function requestedStreetMatchesCandidate(
  rawInput: string,
  candidateStreetLine: string
): boolean {
  if (streetsEquivalent(rawInput, candidateStreetLine)) return true;
  const parsed = parsePartialAddress(rawInput);
  if (!parsed.streetPart) return false;
  return streetsEquivalent(parsed.streetPart, candidateStreetLine);
}

export interface ServiceAreaComponents {
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  displayName?: string;
}

/**
 * Quick Route stop filter: South Bend + ZIP allowlist.
 * A present ZIP must be 46613 or 46614. Statewide / 466xx-prefix matches are not enough.
 */
export function isQuickRouteServiceAreaResult(components: ServiceAreaComponents): boolean {
  const fromDisplay = components.displayName
    ? extractCityStateZip(components.displayName)
    : {};
  const city = components.city ?? fromDisplay.city;
  const state = components.state ?? fromDisplay.state;
  const zip = normalizeZip(components.zip) ?? fromDisplay.zip;

  if (isForbiddenLocality(city)) return false;
  if (state && !isIndianaState(state)) return false;
  if (zip) {
    return isQuickRouteZip(zip) && isSouthBendLocality(city);
  }

  // No ZIP: only keep if locality is South Bend and geometry is inside the envelope.
  if (!isSouthBendLocality(city)) return false;
  if (
    hasUsableGeometry(components.lat, components.lng) &&
    isWithinQuickRouteBounds(components.lat!, components.lng!)
  ) {
    return true;
  }
  return false;
}

export function isForbiddenLocality(city: string | undefined): boolean {
  const n = (city ?? "").toLowerCase();
  return (
    n.includes("fort wayne") ||
    n.includes("indianapolis") ||
    n.includes("chicago") ||
    n.includes("milwaukee")
  );
}

export const STREET_SUFFIX_RE = STREET_SUFFIX;
