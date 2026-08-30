import axios from "axios";
import {
  AutocompleteSuggestion,
  LruCache,
  RankCandidate,
  autocompleteCacheKey,
  expandSearchQueries,
  mergeAndRank,
  parsePartialAddress,
  shouldUseNationwideFallback,
} from "./addressAutocompleteRank.js";
import {
  extractCityStateZip,
  extractHouseNumberFromStreetLine,
  isQuickRouteServiceAreaResult,
  streetPortion,
} from "./addressMatch.js";
import {
  QUICK_ROUTE_NOMINATIM_VIEWBOX,
  QUICK_ROUTE_PHOTON_BBOX,
  QUICK_ROUTE_SERVICE_AREA,
} from "../config/quickRouteServiceArea.js";
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
  shouldUseNationwideFallback,
} from "./addressAutocompleteRank.js";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

const DEFAULT_CITY = QUICK_ROUTE_SERVICE_AREA.city;
const DEFAULT_STATE = QUICK_ROUTE_SERVICE_AREA.state;
const DEFAULT_CENTER = QUICK_ROUTE_SERVICE_AREA.center;
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
  /** When false, search US-wide (for custom start points outside South Bend). Default true. */
  serviceAreaOnly?: boolean;
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
    village?: string;
    municipality?: string;
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

export function getCachedPlaceGeometry(placeId: string): { lat: number; lng: number } | null {
  return geometryCache.get(placeId);
}

function normalizeState(state: string | undefined): string {
  if (!state) return "";
  if (state === "Indiana" || state === "IN") return "IN";
  return state;
}

function nominatimCity(r: NominatimResult): string | undefined {
  return r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.municipality;
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
  const locality = [nominatimCity(r), state, a.postcode].filter(Boolean).join(", ");
  return street ? `${street}, ${locality}` : r.display_name.split(",").slice(0, 3).join(",");
}

function attachParsedLocality<T extends RankCandidate>(candidate: T): T {
  const parsed = extractCityStateZip(candidate.displayName);
  return {
    ...candidate,
    city: candidate.city ?? parsed.city,
    state: candidate.state ?? parsed.state,
    zip: candidate.zip ?? parsed.zip,
    houseNumber:
      candidate.houseNumber ?? extractHouseNumberFromStreetLine(streetPortion(candidate.displayName)),
    street: candidate.street ?? streetPortion(candidate.displayName).replace(/^\d+[a-zA-Z]?\s+/, "").trim(),
  };
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
  limit: number,
  serviceAreaOnly: boolean
): Promise<RankCandidate[]> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) return [];

  const predictions: Array<{ place_id: string; description: string }> = [];
  const seen = new Set<string>();

  // Literal query is queries[0] after expandSearchQueries ordering.
  for (const input of queries.slice(0, 1)) {
    try {
      const response = await axios.get<GoogleAutocompleteResponse>(
        GOOGLE_PLACES_AUTOCOMPLETE_URL,
        {
          params: {
            input,
            key: apiKey,
            location: `${near.lat},${near.lng}`,
            radius: serviceAreaOnly ? 12000 : 500000,
            components: serviceAreaOnly
              ? `country:us|administrative_area:${stateAbbr}`
              : "country:us",
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
    const locality = extractCityStateZip(p.description);
    const streetLine = streetPortion(p.description);
    return attachParsedLocality({
      placeId: p.place_id,
      displayName: p.description,
      lat: geometry?.lat,
      lng: geometry?.lng,
      confidence: "ambiguous" as const,
      rankReason: "Suggested match",
      provider: "google" as const,
      hasGeometry: Boolean(geometry),
      city: locality.city,
      state: locality.state,
      zip: locality.zip,
      houseNumber: extractHouseNumberFromStreetLine(streetLine),
      street: streetLine.replace(/^\d+[a-zA-Z]?\s+/, "").trim(),
    });
  });
}

async function photonSearch(
  query: string,
  near: { lat: number; lng: number } | undefined,
  fetchLimit: number,
  serviceAreaOnly: boolean
): Promise<RankCandidate[]> {
  const params: Record<string, string | number> = {
    q: query,
    limit: fetchLimit,
  };
  if (near) {
    params.lat = near.lat;
    params.lon = near.lng;
  }
  if (serviceAreaOnly) {
    params.bbox = QUICK_ROUTE_PHOTON_BBOX;
  }

  const response = await axios.get<PhotonResponse>(PHOTON_URL, {
    params,
    timeout: 3500,
  });

  return response.data.features
    .filter((f) => {
      if (!serviceAreaOnly) {
        return (f.properties.countrycode ?? "us").toLowerCase() === "us";
      }
      return isQuickRouteServiceAreaResult({
        city: f.properties.city,
        state: f.properties.state,
        zip: f.properties.postcode,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      });
    })
    .map((f) =>
      attachParsedLocality({
        placeId: `${f.properties.osm_type}-${f.properties.osm_id}`,
        displayName: buildPhotonDisplayName(f.properties),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        confidence: "interpolated" as const,
        rankReason: "Suggested match",
        provider: "photon" as const,
        hasGeometry: true,
        houseNumberVerified: Boolean(f.properties.housenumber),
        city: f.properties.city,
        state: normalizeState(f.properties.state),
        zip: f.properties.postcode,
        houseNumber: f.properties.housenumber,
        street: f.properties.street || f.properties.name,
      })
    );
}

async function nominatimSearch(
  query: string,
  near: { lat: number; lng: number } | undefined,
  fetchLimit: number,
  serviceAreaOnly: boolean
): Promise<RankCandidate[]> {
  const params: Record<string, string | number> = {
    q: query,
    format: "json",
    addressdetails: 1,
    countrycodes: "us",
    limit: fetchLimit,
  };
  if (serviceAreaOnly) {
    params.viewbox = QUICK_ROUTE_NOMINATIM_VIEWBOX;
    params.bounded = 1;
  } else if (near) {
    const delta = 2.5;
    params.lat = near.lat;
    params.lon = near.lng;
    params.viewbox = `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`;
    params.bounded = 0;
  }

  const response = await axios.get<NominatimResult[]>(NOMINATIM_SEARCH_URL, {
    params,
    headers: { "User-Agent": NOMINATIM_USER_AGENT },
    timeout: 4000,
  });

  return response.data
    .filter((r) => r.address?.road || r.address?.house_number)
    .filter((r) => {
      if (!serviceAreaOnly) return true;
      return isQuickRouteServiceAreaResult({
        city: nominatimCity(r),
        state: r.address?.state,
        zip: r.address?.postcode,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        displayName: r.display_name,
      });
    })
    .map((r) =>
      attachParsedLocality({
        placeId: String(r.place_id),
        displayName: buildNominatimDisplayName(r),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        confidence: "interpolated" as const,
        rankReason: "Suggested match",
        provider: "nominatim" as const,
        hasGeometry: true,
        houseNumberVerified: Boolean(r.address?.house_number),
        city: nominatimCity(r),
        state: r.address?.state,
        zip: r.address?.postcode,
        houseNumber: r.address?.house_number,
        street: r.address?.road,
      })
    );
}

async function osmAutocomplete(
  queries: string[],
  near: { lat: number; lng: number } | undefined,
  limit: number,
  serviceAreaOnly: boolean
): Promise<RankCandidate[]> {
  const perQuery = limit + 6;
  const primaryQuery = queries[0];
  if (!primaryQuery) return [];

  const photonQueries = serviceAreaOnly ? queries.slice(0, 3) : queries.slice(0, 1);

  const photonBatches = await Promise.all(
    photonQueries.map((query) =>
      photonSearch(query, near, perQuery, serviceAreaOnly).catch(() => [])
    )
  );
  const results = photonBatches.flat();

  if (results.length < Math.max(2, limit / 2)) {
    const nominatimPrimary = await nominatimGate
      .run(`nominatim:${primaryQuery}`, () =>
        nominatimSearch(primaryQuery, near, perQuery, serviceAreaOnly)
      )
      .catch(() => [] as RankCandidate[]);
    results.push(...nominatimPrimary);
  }

  return results;
}

async function runAutocompleteSearch(
  opts: AutocompleteOptions & { serviceAreaOnly: boolean }
): Promise<AutocompleteSuggestion[]> {
  const q = opts.q.trim();
  const limit = Math.min(opts.limit ?? 8, 10);
  const city = opts.serviceAreaOnly
    ? QUICK_ROUTE_SERVICE_AREA.city
    : (opts.city ?? DEFAULT_CITY);
  const state = opts.serviceAreaOnly
    ? QUICK_ROUTE_SERVICE_AREA.state
    : (opts.state ?? DEFAULT_STATE);
  const near = opts.near ?? (opts.serviceAreaOnly ? DEFAULT_CENTER : undefined);
  const parsed = parsePartialAddress(q);
  const queries = expandSearchQueries(q, city, state, opts.serviceAreaOnly);
  const rankNear = near ?? DEFAULT_CENTER;

  const [googleResults, osmResults] = await Promise.all([
    googleAutocomplete(queries, rankNear, state, limit + 2, opts.serviceAreaOnly),
    osmAutocomplete(queries, near, limit + 4, opts.serviceAreaOnly),
  ]);

  return mergeAndRank([...googleResults, ...osmResults], parsed, rankNear, limit, {
    enforceServiceArea: opts.serviceAreaOnly,
  });
}

export async function searchAddressAutocomplete(
  opts: AutocompleteOptions
): Promise<AutocompleteSuggestion[]> {
  const q = opts.q.trim();
  const limit = Math.min(opts.limit ?? 8, 10);
  const city = opts.city ?? DEFAULT_CITY;
  const state = opts.state ?? DEFAULT_STATE;
  const serviceAreaOnly = opts.serviceAreaOnly !== false;

  if (q.length < 3) return [];

  const key = autocompleteCacheKey({ ...opts, q, city, state, serviceAreaOnly });
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  let merged = await runAutocompleteSearch({ ...opts, q, limit, city, state, serviceAreaOnly });

  if (merged.length === 0 && shouldUseNationwideFallback(serviceAreaOnly, q, city)) {
    merged = await runAutocompleteSearch({
      ...opts,
      q,
      limit,
      city,
      state,
      serviceAreaOnly: false,
    });
  }

  suggestionCache.set(key, merged);
  return merged;
}
