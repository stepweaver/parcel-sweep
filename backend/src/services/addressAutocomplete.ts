import axios from "axios";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

const DEFAULT_CITY = "South Bend";
const DEFAULT_STATE = "IN";
const DEFAULT_CENTER = { lat: 41.6764, lng: -86.252 };
const SERVICE_BBOX = "-86.50,41.48,-86.05,41.82";
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 300;
const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|cir|circle|pkwy|parkway)\b/i;
const FULL_CARDINAL = /\b(east|west|north|south)\b/i;

export interface AutocompleteSuggestion {
  placeId: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface AutocompleteOptions {
  q: string;
  limit?: number;
  near?: { lat: number; lng: number };
  city?: string;
  state?: string;
}

interface ParsedPartialAddress {
  houseNumber?: string;
  streetPart: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type: string;
    osm_id: number;
    type?: string;
    housenumber?: string;
    street?: string;
    name?: string;
    city?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    state?: string;
    postcode?: string;
  };
}

interface GoogleAutocompleteResponse {
  status: string;
  predictions?: Array<{ place_id: string; description: string }>;
}

const cache = new Map<string, { expires: number; suggestions: AutocompleteSuggestion[] }>();

function cacheKey(opts: AutocompleteOptions): string {
  const near = opts.near ? `${opts.near.lat},${opts.near.lng}` : "";
  return `${opts.q}|${near}|${opts.city ?? ""}|${opts.state ?? ""}`;
}

function getCached(key: string): AutocompleteSuggestion[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.suggestions;
}

function setCache(key: string, suggestions: AutocompleteSuggestion[]): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, suggestions });
}

function haversineMeters(
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

function parsePartialAddress(q: string): ParsedPartialAddress {
  const trimmed = q.trim();
  const match = trimmed.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
  if (match) {
    return { houseNumber: match[1], streetPart: match[2].trim() };
  }
  return { streetPart: trimmed };
}

function queryHasLocality(q: string, city: string, state: string): boolean {
  const lower = q.toLowerCase();
  return (
    lower.includes(city.toLowerCase()) ||
    lower.includes(state.toLowerCase()) ||
    lower.includes("indiana")
  );
}

function hasFullCardinal(streetPart: string): boolean {
  return FULL_CARDINAL.test(streetPart);
}

/** Build search phrasings — prioritizes East/West partial patterns common in South Bend. */
function expandSearchQueries(q: string, city: string, state: string): string[] {
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
    const { houseNumber, streetPart } = parsed;
    const hasSuffix = STREET_SUFFIX.test(streetPart);

    if (!hasSuffix && !hasFullCardinal(streetPart)) {
      // Best partial-street patterns — "302 E" → "302 East E …" surfaces East Ewing Ave
      add(`${houseNumber} East ${streetPart} ${locality}`);
      add(`${houseNumber} West ${streetPart} ${locality}`);
      add(`${houseNumber} East ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} West ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} ${streetPart} Street ${locality}`);
    } else if (!hasSuffix) {
      add(`${houseNumber} ${streetPart} Avenue ${locality}`);
      add(`${houseNumber} ${streetPart} Street ${locality}`);
    }
  } else if (parsed.streetPart && !STREET_SUFFIX.test(parsed.streetPart) && !hasFullCardinal(parsed.streetPart)) {
    add(`East ${parsed.streetPart} Avenue ${locality}`);
    add(`West ${parsed.streetPart} Avenue ${locality}`);
    add(`${parsed.streetPart} Avenue ${locality}`);
  }

  add(queryHasLocality(q, city, state) ? q : `${q} ${locality}`);

  return ordered.slice(0, 8);
}

function streetPortion(displayName: string): string {
  return (displayName.split(",")[0] ?? displayName).trim();
}

function normalizeStreetForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(east|west|north|south)\b/g, " ")
    .replace(/\b(e|w|n|s)\b(?=\s|$)/g, " ")
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|terrace|ter|circle|cir|parkway|pkwy)\b/g,
      " "
    )
    .replace(/^\d+[a-z]?\s*/, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNameWords(text: string): string[] {
  return normalizeStreetForMatch(text)
    .split(/\s+/)
    .filter((t) => t.length >= 1 && !/^\d+$/.test(t));
}

function streetQueryTokens(streetPart: string): string[] {
  const cleaned = streetPart.trim().toLowerCase();
  if (!cleaned) return [];
  if (STREET_SUFFIX.test(cleaned) || hasFullCardinal(cleaned)) {
    return streetNameWords(cleaned);
  }
  // Treat short partial street input as a single prefix token ("E", "Ei", "Ewing")
  return [cleaned.replace(/[^a-z0-9]/g, "")].filter((t) => t.length >= 1);
}

/** Prefix or subsequence match — "Ei" matches "Ewing", "E" matches "Ewing". */
function fuzzyStreetMatch(queryToken: string, word: string): boolean {
  if (!queryToken || !word) return false;
  if (word.startsWith(queryToken)) return true;
  if (queryToken.length === 1) return word.startsWith(queryToken);

  let qi = 0;
  for (let wi = 0; wi < word.length && qi < queryToken.length; wi++) {
    if (word[wi] === queryToken[qi]) qi++;
  }
  return qi === queryToken.length;
}

function normalizeState(state: string | undefined): string {
  if (!state) return "";
  if (state === "Indiana" || state === "IN") return "IN";
  return state;
}

function isInServiceArea(props: PhotonFeature["properties"]): boolean {
  const st = normalizeState(props.state);
  const zip = props.postcode ?? "";
  const city = (props.city ?? "").toLowerCase();
  if (st === "IN" && city.includes("south bend")) return true;
  if (/^466\d{2}$/.test(zip)) return true;
  return false;
}

function buildPhotonDisplayName(props: PhotonFeature["properties"]): string {
  const streetLine = [props.housenumber, props.street || props.name]
    .filter(Boolean)
    .join(" ");
  const city = props.city ?? "";
  const state = normalizeState(props.state);
  const zip = props.postcode ?? "";
  const locality = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  if (streetLine && locality) return `${streetLine}, ${locality}`;
  if (streetLine) return streetLine;
  if (props.name && locality) return `${props.name}, ${locality}`;
  return props.name ?? streetLine;
}

function buildNominatimDisplayName(r: NominatimResult): string {
  const a = r.address;
  if (!a) return r.display_name.split(",").slice(0, 4).join(",").trim();
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const state = a.state === "Indiana" ? "IN" : (a.state ?? "");
  const locality = [a.city ?? a.town, state, a.postcode].filter(Boolean).join(", ");
  return street ? `${street}, ${locality}` : r.display_name.split(",").slice(0, 3).join(",");
}

function scoreSuggestion(
  s: AutocompleteSuggestion,
  parsed: ParsedPartialAddress,
  near: { lat: number; lng: number }
): number {
  const streetLine = streetPortion(s.displayName);
  const words = streetNameWords(streetLine);
  const lower = s.displayName.toLowerCase();
  let score = 0;

  if (parsed.houseNumber) {
    const numRe = new RegExp(
      `\\b${parsed.houseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );
    if (numRe.test(streetLine)) score += 120;
    else score -= 60;
  }

  const tokens = streetQueryTokens(parsed.streetPart);
  let streetMatchCount = 0;
  if (tokens.length === 0) {
    score += 5;
  } else {
    for (const token of tokens) {
      if (words.some((w) => fuzzyStreetMatch(token, w))) {
        streetMatchCount++;
        score += 80;
      } else {
        score -= 40;
      }
    }
    if (streetMatchCount === 0 && parsed.houseNumber) {
      const numRe = new RegExp(
        `\\b${parsed.houseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i"
      );
      if (numRe.test(streetLine)) score -= 90;
    }
  }

  if (parsed.houseNumber && !/\d/.test(streetLine)) {
    score -= 30;
  }

  if (lower.includes("south bend")) score += 20;
  if (/^466\d{2}/.test(s.displayName)) score += 10;

  const qLower = parsed.streetPart.toLowerCase();
  const lineLower = streetLine.toLowerCase();
  if (!/\b(west|w)\b/.test(qLower) && /\beast\b/.test(lineLower)) score += 10;
  if (!/\b(east|e)\b/.test(qLower) && !/\b(west|w)\b/.test(qLower) && /\bwest\b/.test(lineLower)) {
    score -= 5;
  }

  score -= haversineMeters(near, { lat: s.lat, lng: s.lng }) / 3000;

  return score;
}

function mergeAndRank(
  suggestions: AutocompleteSuggestion[],
  parsed: ParsedPartialAddress,
  near: { lat: number; lng: number },
  limit: number
): AutocompleteSuggestion[] {
  const seen = new Set<string>();
  const ranked = suggestions
    .map((s) => ({ ...s, _score: scoreSuggestion(s, parsed, near) }))
    .sort((a, b) => b._score - a._score)
    .filter((s) => {
      const key = s.displayName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const tokens = streetQueryTokens(parsed.streetPart);
  const filtered =
    parsed.houseNumber && tokens.length > 0
      ? ranked.filter((s) => s._score >= 60)
      : ranked.filter((s) => s._score > 0);

  let picked = filtered;
  if (picked.length === 0 && tokens.length > 0) {
    picked = ranked.filter((s) => {
      const words = streetNameWords(streetPortion(s.displayName));
      return tokens.some((t) => words.some((w) => fuzzyStreetMatch(t, w)));
    });
  }
  if (picked.length === 0) picked = ranked;

  return picked.slice(0, limit).map(({ placeId, displayName, lat, lng }) => ({
    placeId,
    displayName,
    lat,
    lng,
  }));
}

async function googleAutocomplete(
  queries: string[],
  near: { lat: number; lng: number },
  stateAbbr: string,
  limit: number
): Promise<AutocompleteSuggestion[]> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) return [];

  const all: AutocompleteSuggestion[] = [];

  for (const input of queries.slice(0, 4)) {
    try {
      const response = await axios.get<GoogleAutocompleteResponse>(
        GOOGLE_PLACES_AUTOCOMPLETE_URL,
        {
          params: {
            input,
            key: apiKey,
            location: `${near.lat},${near.lng}`,
            radius: 50000,
            components: `country:us|administrative_area:${stateAbbr}`,
            types: "address",
          },
          timeout: 3500,
        }
      );

      if (response.data.status === "OK" && response.data.predictions?.length) {
        for (const p of response.data.predictions) {
          all.push({
            placeId: p.place_id,
            displayName: p.description,
            lat: near.lat,
            lng: near.lng,
          });
        }
      }
    } catch {
      // try next variant
    }
  }

  return all;
}

async function photonSearch(
  query: string,
  near: { lat: number; lng: number },
  fetchLimit: number
): Promise<AutocompleteSuggestion[]> {
  const response = await axios.get<PhotonResponse>(PHOTON_URL, {
    params: {
      q: query,
      lat: near.lat,
      lon: near.lng,
      bbox: SERVICE_BBOX,
      limit: fetchLimit,
    },
    timeout: 3500,
  });

  return response.data.features
    .filter((f) => isInServiceArea(f.properties))
    .map((f) => ({
      placeId: `${f.properties.osm_type}-${f.properties.osm_id}`,
      displayName: buildPhotonDisplayName(f.properties),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));
}

async function nominatimSearch(
  query: string,
  near: { lat: number; lng: number },
  fetchLimit: number
): Promise<AutocompleteSuggestion[]> {
  const delta = 0.22;
  const response = await axios.get<NominatimResult[]>(NOMINATIM_SEARCH_URL, {
    params: {
      q: query,
      format: "json",
      addressdetails: 1,
      countrycodes: "us",
      lat: near.lat,
      lon: near.lng,
      viewbox: `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`,
      bounded: 0,
      limit: fetchLimit,
    },
    headers: { "User-Agent": NOMINATIM_USER_AGENT },
    timeout: 12000,
  });

  return response.data
    .filter((r) => r.address?.road || r.address?.house_number)
    .filter((r) => {
      const city = (r.address?.city ?? r.address?.town ?? "").toLowerCase();
      const state = r.address?.state ?? "";
      const zip = r.address?.postcode ?? "";
      return city.includes("south bend") || state === "Indiana" || /^466\d{2}$/.test(zip);
    })
    .map((r) => ({
      placeId: String(r.place_id),
      displayName: buildNominatimDisplayName(r),
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
}

async function resolveHouseOnStreets(
  parsed: ParsedPartialAddress,
  city: string,
  state: string,
  near: { lat: number; lng: number },
  candidates: AutocompleteSuggestion[]
): Promise<AutocompleteSuggestion[]> {
  if (!parsed.houseNumber || parsed.streetPart.length > 8) return [];

  const tokens = streetQueryTokens(parsed.streetPart);
  if (tokens.length === 0) return [];

  const streets = new Set<string>();
  for (const candidate of candidates) {
    const line = streetPortion(candidate.displayName).replace(/^\d+[a-zA-Z]?\s+/, "").trim();
    const words = streetNameWords(line);
    if (line && tokens.some((t) => words.some((w) => fuzzyStreetMatch(t, w)))) {
      streets.add(line);
      const shortened = line.replace(/^(North|South|East|West|N|S|E|W)\s+/i, "").trim();
      if (shortened !== line) streets.add(shortened);
    }
  }

  const locality = `${city}, ${state}`;
  const lookups = await Promise.all(
    [...streets].slice(0, 3).map((street) =>
      nominatimSearch(`${parsed.houseNumber} ${street}, ${locality}`, near, 2).catch(
        () => [] as AutocompleteSuggestion[]
      )
    )
  );
  return lookups.flat();
}

async function osmAutocomplete(
  queries: string[],
  parsed: ParsedPartialAddress,
  city: string,
  state: string,
  near: { lat: number; lng: number },
  limit: number
): Promise<AutocompleteSuggestion[]> {
  const perQuery = limit + 6;

  const streetQuery = queries.find((q) => /\b(Street|St)\b/i.test(q));
  const avenueQuery = queries.find((q) => /\b(Avenue|Ave)\b/i.test(q));
  const baseQuery = queries[queries.length - 1];
  const nominatimQueries = [
    streetQuery,
    avenueQuery,
    queries.find((q) => /\bEast\b/i.test(q)),
    baseQuery,
  ].filter((q): q is string => Boolean(q));
  const uniqueNominatim = [...new Set(nominatimQueries)].slice(0, 3);

  const photonQueries = [
    streetQuery,
    avenueQuery,
    ...queries.filter((q) => q !== streetQuery && q !== avenueQuery),
  ]
    .filter((q): q is string => Boolean(q))
    .slice(0, 6);

  const [photonBatches, nominatimBatches] = await Promise.all([
    Promise.all(
      photonQueries.map((q) =>
        photonSearch(q, near, perQuery).catch(() => [] as AutocompleteSuggestion[])
      )
    ),
    Promise.all(
      uniqueNominatim.map((q) =>
        nominatimSearch(q, near, perQuery).catch(() => [] as AutocompleteSuggestion[])
      )
    ),
  ]);

  const initial = [...photonBatches.flat(), ...nominatimBatches.flat()];
  const resolved = await resolveHouseOnStreets(parsed, city, state, near, initial);
  return [...initial, ...resolved];
}

export async function searchAddressAutocomplete(
  opts: AutocompleteOptions
): Promise<AutocompleteSuggestion[]> {
  const q = opts.q.trim();
  const limit = Math.min(opts.limit ?? 8, 10);
  const city = opts.city ?? DEFAULT_CITY;
  const state = opts.state ?? DEFAULT_STATE;
  const near = opts.near ?? DEFAULT_CENTER;
  const parsed = parsePartialAddress(q);
  const queries = expandSearchQueries(q, city, state);

  if (q.length < 3) return [];

  const key = cacheKey({ ...opts, q, city, state });
  const cached = getCached(key);
  if (cached) return cached;

  const [googleResults, osmResults] = await Promise.all([
    googleAutocomplete(queries, near, state, limit + 4),
    osmAutocomplete(queries, parsed, city, state, near, limit + 8),
  ]);

  const merged = mergeAndRank([...googleResults, ...osmResults], parsed, near, limit);

  setCache(key, merged);
  return merged;
}
