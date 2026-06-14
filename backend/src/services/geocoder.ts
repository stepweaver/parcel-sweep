import axios from "axios";
import { GeocodedStop, StopInput } from "../types/index.js";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

interface GoogleGeocodeResult {
  geometry: {
    location: { lat: number; lng: number };
  };
  formatted_address: string;
}

interface GoogleGeocodeResponse {
  status: string;
  results: GoogleGeocodeResult[];
  error_message?: string;
}

async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ lat: number; lng: number }> {
  const response = await axios.get<GoogleGeocodeResponse>(GEOCODE_URL, {
    params: { address, key: apiKey },
  });

  const { status, results, error_message } = response.data;

  if (status !== "OK" || results.length === 0) {
    throw new Error(
      `Geocoding failed for "${address}": ${status}${error_message ? ` — ${error_message}` : ""}`
    );
  }

  return results[0].geometry.location;
}

/** Free geocoding via OpenStreetMap Nominatim (same provider family as manifest generation). */
export async function geocodeWithNominatim(
  address: string
): Promise<{ lat: number; lng: number }> {
  const response = await axios.get<Array<{ lat: string; lon: string }>>(
    NOMINATIM_URL,
    {
      params: { q: address, format: "json", limit: 1, countrycodes: "us" },
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      timeout: 15_000,
    }
  );

  const hit = response.data[0];
  if (!hit) {
    throw new Error(
      `Could not geocode "${address}" via OpenStreetMap. Check the depot address spelling.`
    );
  }

  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
}

/**
 * Geocode an address using Google when configured, otherwise OpenStreetMap.
 * Falls back to Nominatim if Google fails.
 */
export async function resolveAddressCoords(
  address: string
): Promise<{ lat: number; lng: number; source: "google" | "nominatim" }> {
  const googleApiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();

  if (googleApiKey) {
    try {
      const coords = await geocodeAddress(address, googleApiKey);
      return { ...coords, source: "google" };
    } catch (err) {
      console.warn(
        "[geocoder] Google geocoding failed, trying OpenStreetMap:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const coords = await geocodeWithNominatim(address);
  return { ...coords, source: "nominatim" };
}

/** Whether a Google Geocoding API key is present at runtime (for health checks). */
export function isGoogleGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GEOCODING_API_KEY?.trim());
}

/**
 * Geocodes the start address and all delivery stop addresses.
 * Uses Google when apiKey is provided; otherwise resolveAddressCoords (Google or OSM).
 */
export async function geocodeAll(
  startAddress: string,
  stops: StopInput[],
  apiKey?: string,
  concurrency = 10
): Promise<{ start: GeocodedStop; stops: GeocodedStop[] }> {
  const allAddresses: StopInput[] = [
    { address: startAddress, packageCount: 0 },
    ...stops,
  ];

  const results: GeocodedStop[] = [];
  const key = apiKey?.trim() || process.env.GOOGLE_GEOCODING_API_KEY?.trim();

  async function geocodeStop(stop: StopInput): Promise<GeocodedStop> {
    if (key) {
      try {
        const coords = await geocodeAddress(stop.address, key);
        return {
          address: stop.address,
          packageCount: stop.packageCount ?? 1,
          lat: coords.lat,
          lng: coords.lng,
        };
      } catch (err) {
        console.warn(
          `[geocoder] Google failed for "${stop.address}", trying OSM:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    const coords = await geocodeWithNominatim(stop.address);
    return {
      address: stop.address,
      packageCount: stop.packageCount ?? 1,
      lat: coords.lat,
      lng: coords.lng,
    };
  }

  for (let i = 0; i < allAddresses.length; i += concurrency) {
    const batch = allAddresses.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(geocodeStop));
    results.push(...batchResults);
  }

  const [start, ...geocodedStops] = results;
  return { start, stops: geocodedStops };
}
