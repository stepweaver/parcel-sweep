import axios from "axios";

const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

const DEFAULT_CITY = "South Bend";
const DEFAULT_STATE = "IN";
const DEFAULT_STATE_NAME = "Indiana";
const DEFAULT_CENTER = { lat: 41.6764, lng: -86.252 };
/** South Bend metro bounding box: minLon, minLat, maxLon, maxLat */
const SERVICE_BBOX = "-86.50,41.48,-86.05,41.82";
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 250;

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
  error_message?: string;
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

function queryHasLocality(q: string, city: string, state: string): boolean {
  const lower = q.toLowerCase();
  return (
    lower.includes(city.toLowerCase()) ||
    lower.includes(state.toLowerCase()) ||
    lower.includes("indiana")
  );
}

function augmentQuery(q: string, city: string, state: string): string {
  if (queryHasLocality(q, city, state)) return q;
  return `${q} ${city} ${state}`;
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

function rankSuggestions(
  suggestions: AutocompleteSuggestion[],
  center: { lat: number; lng: number },
  limit: number
): AutocompleteSuggestion[] {
  const seen = new Set<string>();
  return suggestions
    .map((s) => ({ ...s, _dist: haversineMeters(center, { lat: s.lat, lng: s.lng }) }))
    .sort((a, b) => a._dist - b._dist)
    .filter((s) => {
      const key = s.displayName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ placeId, displayName, lat, lng }) => ({ placeId, displayName, lat, lng }));
}

async function googleAutocomplete(
  q: string,
  near: { lat: number; lng: number },
  stateAbbr: string,
  limit: number
): Promise<AutocompleteSuggestion[]> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const response = await axios.get<GoogleAutocompleteResponse>(
      GOOGLE_PLACES_AUTOCOMPLETE_URL,
      {
        params: {
          input: q,
          key: apiKey,
          location: `${near.lat},${near.lng}`,
          radius: 50000,
          components: `country:us|administrative_area:${stateAbbr}`,
          types: "address",
        },
        timeout: 3500,
      }
    );

    if (response.data.status !== "OK" && response.data.status !== "ZERO_RESULTS") {
      return [];
    }

    return (response.data.predictions ?? []).slice(0, limit).map((p) => ({
      placeId: p.place_id,
      displayName: p.description,
      lat: near.lat,
      lng: near.lng,
    }));
  } catch {
    return [];
  }
}

async function photonAutocomplete(
  q: string,
  near: { lat: number; lng: number },
  city: string,
  state: string,
  limit: number
): Promise<AutocompleteSuggestion[]> {
  const augmented = augmentQuery(q, city, state);

  try {
    const response = await axios.get<PhotonResponse>(PHOTON_URL, {
      params: {
        q: augmented,
        lat: near.lat,
        lon: near.lng,
        bbox: SERVICE_BBOX,
        limit: limit + 6,
      },
      timeout: 3500,
    });

    const suggestions = response.data.features
      .filter((f) => isInServiceArea(f.properties))
      .map((f) => ({
        placeId: `${f.properties.osm_type}-${f.properties.osm_id}`,
        displayName: buildPhotonDisplayName(f.properties),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        _hasNumber: Boolean(f.properties.housenumber),
        _isHouse: f.properties.type === "house",
      }))
      // Prefer exact house matches, then numbered addresses, then streets
      .sort((a, b) => {
        if (a._isHouse !== b._isHouse) return a._isHouse ? -1 : 1;
        if (a._hasNumber !== b._hasNumber) return a._hasNumber ? -1 : 1;
        return 0;
      });

    return rankSuggestions(
      suggestions.map(({ placeId, displayName, lat, lng }) => ({
        placeId,
        displayName,
        lat,
        lng,
      })),
      near,
      limit
    );
  } catch (err) {
    console.warn(
      "[autocomplete] Photon request failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

async function nominatimFallback(
  q: string,
  near: { lat: number; lng: number },
  city: string,
  state: string,
  limit: number
): Promise<AutocompleteSuggestion[]> {
  const augmented = augmentQuery(q, city, state);
  const delta = 0.18;

  try {
    const response = await axios.get<NominatimResult[]>(NOMINATIM_SEARCH_URL, {
      params: {
        q: augmented,
        format: "json",
        addressdetails: 1,
        countrycodes: "us",
        lat: near.lat,
        lon: near.lng,
        viewbox: `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`,
        bounded: 1,
        limit: limit + 2,
      },
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      timeout: 5000,
    });

    return rankSuggestions(
      response.data
        .filter((r) => r.address?.road || r.address?.house_number)
        .map((r) => {
          const a = r.address!;
          const street = [a.house_number, a.road].filter(Boolean).join(" ");
          const locality = [a.city ?? a.town, a.state, a.postcode].filter(Boolean).join(", ");
          return {
            placeId: String(r.place_id),
            displayName: street ? `${street}, ${locality}` : r.display_name.split(",").slice(0, 3).join(","),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          };
        }),
      near,
      limit
    );
  } catch {
    return [];
  }
}

export async function searchAddressAutocomplete(
  opts: AutocompleteOptions
): Promise<AutocompleteSuggestion[]> {
  const q = opts.q.trim();
  const limit = Math.min(opts.limit ?? 8, 10);
  const city = opts.city ?? DEFAULT_CITY;
  const state = opts.state ?? DEFAULT_STATE;
  const near = opts.near ?? DEFAULT_CENTER;

  if (q.length < 3) return [];

  const key = cacheKey({ ...opts, q, city, state });
  const cached = getCached(key);
  if (cached) return cached;

  // 1. Google Places — best partial-address matching when API key + Places API enabled
  let suggestions = await googleAutocomplete(q, near, state, limit);

  // 2. Photon — fast OSM autocomplete, good for partial street names like "1804 Twy"
  if (suggestions.length === 0) {
    suggestions = await photonAutocomplete(q, near, city, state, limit);
  }

  // 3. Nominatim — slow fallback for addresses Photon misses
  if (suggestions.length === 0) {
    suggestions = await nominatimFallback(q, near, city, state, limit);
  }

  setCache(key, suggestions);
  return suggestions;
}
