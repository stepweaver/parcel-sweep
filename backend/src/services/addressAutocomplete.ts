import axios from "axios";
import {
  AutocompleteSuggestion,
  LruCache,
  RankCandidate,
  autocompleteCacheKey,
  expandSearchQueries,
  mergeAndRank,
  parsePartialAddress,
} from "./addressAutocompleteRank.js";
import { nominatimGate } from "./providerRateLimit.js";

export type {
  AddressConfidence,
  AutocompleteSuggestion,
  ParsedPartialAddress,
} from "./addressAutocompleteRank.js";
export {
  parsePartialAddress,
  expandSearchQueries,
  mergeAndRank,
  scoreCandidate,
  deriveConfidence,
  locationBucket,
  autocompleteCacheKey,
} from "./addressAutocompleteRank.js";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

const DEFAULT_CITY = "South Bend";
const DEFAULT_STATE = "IN";
const DEFAULT_CENTER = { lat: 41.6764, lng: -86.252 };
const SERVICE_BBOX = "-86.50,41.48,-86.05,41.82";
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 300;
const GEOMETRY_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOMETRY_CACHE_MAX = 500;

export interface AutocompleteOptions {
  q: string;
  limit?: number;
  near?: { lat: number; lng: number };
  city?: string;
  state?: string;
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

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{ geometry: { location: { lat: number; lng: number } } }>;
}

const suggestionCache = new LruCache<AutocompleteSuggestion[]>(CACHE_MAX, CACHE_TTL_MS);
const geometryCache = new LruCache<{ lat: number; lng: number }>(
  GEOMETRY_CACHE_MAX,
  GEOMETRY_CACHE_TTL_MS
);

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
  const streetLine = [props.housenumber, props.street || props.name].filter(Boolean).join(" ");
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

async function resolveGooglePlaceGeometry(
  placeId: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  const cached = geometryCache.get(placeId);
  if (cached) return cached;

  try {
    const response = await axios.get<GoogleGeocodeResponse>(GOOGLE_GEOCODE_URL, {
      params: { place_id: placeId, key: apiKey },
      timeout: 3500,
    });
    const location = response.data.results?.[0]?.geometry.location;
    if (!location) return null;
    geometryCache.set(placeId, location);
    return location;
  } catch {
    return null;
  }
}

async function googleAutocomplete(
  queries: string[],
  near: { lat: number; lng: number },
  stateAbbr: string,
  limit: number
): Promise<RankCandidate[]> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) return [];

  const predictions: Array<{ place_id: string; description: string }> = [];
  const seen = new Set<string>();

  for (const input of queries.slice(0, 1)) {
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
          if (seen.has(p.place_id)) continue;
          seen.add(p.place_id);
          predictions.push(p);
        }
      }
    } catch {
      // try next variant
    }
  }

  const slice = predictions.slice(0, limit + 4);
  const geometries = await Promise.all(
    slice.map((p) => resolveGooglePlaceGeometry(p.place_id, apiKey))
  );

  return slice.map((p, i) => {
    const geometry = geometries[i];
    return {
      placeId: p.place_id,
      displayName: p.description,
      lat: geometry?.lat ?? near.lat,
      lng: geometry?.lng ?? near.lng,
      confidence: "ambiguous" as const,
      rankReason: "Suggested match",
      provider: "google" as const,
      hasGeometry: Boolean(geometry),
    };
  });
}

async function photonSearch(
  query: string,
  near: { lat: number; lng: number },
  fetchLimit: number
): Promise<RankCandidate[]> {
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
      confidence: "interpolated" as const,
      rankReason: "Suggested match",
      provider: "photon" as const,
      hasGeometry: true,
      houseNumberVerified: Boolean(f.properties.housenumber),
    }));
}

async function nominatimSearch(
  query: string,
  near: { lat: number; lng: number },
  fetchLimit: number
): Promise<RankCandidate[]> {
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
    timeout: 4000,
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
      confidence: "interpolated" as const,
      rankReason: "Suggested match",
      provider: "nominatim" as const,
      hasGeometry: true,
      houseNumberVerified: Boolean(r.address?.house_number),
    }));
}

async function osmAutocomplete(
  queries: string[],
  near: { lat: number; lng: number },
  limit: number
): Promise<RankCandidate[]> {
  const perQuery = limit + 6;
  const primaryQuery = queries[0];
  if (!primaryQuery) return [];

  // Parallel Photon lookups — interactive autocomplete must stay sub-second when possible.
  const photonBatches = await Promise.all(
    queries.slice(0, 3).map((query) => photonSearch(query, near, perQuery).catch(() => []))
  );
  const results = photonBatches.flat();

  // Single Nominatim fallback only when Photon is sparse (avoids serial multi-second chains).
  if (results.length < Math.max(2, limit / 2)) {
    const nominatimPrimary = await nominatimGate
      .run(`nominatim:${primaryQuery}`, () => nominatimSearch(primaryQuery, near, perQuery))
      .catch(() => [] as RankCandidate[]);
    results.push(...nominatimPrimary);
  }

  return results;
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

  const key = autocompleteCacheKey({ ...opts, q, city, state });
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  const [googleResults, osmResults] = await Promise.all([
    googleAutocomplete(queries, near, state, limit + 2),
    osmAutocomplete(queries, near, limit + 4),
  ]);

  const merged = mergeAndRank([...googleResults, ...osmResults], parsed, near, limit);
  suggestionCache.set(key, merged);
  return merged;
}
