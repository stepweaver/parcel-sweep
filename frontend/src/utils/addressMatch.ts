import { QUICK_ROUTE_SERVICE_AREA, QUICK_ROUTE_ZIP_SET } from "../config/quickRouteServiceArea";

export type CardinalDirection = "E" | "W" | "N" | "S";

export interface ParsedPartialAddress {
  houseNumber?: string;
  preDirectional?: CardinalDirection;
  postDirectional?: CardinalDirection;
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
