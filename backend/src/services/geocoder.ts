import axios from "axios";
import { GeocodedStop, StopInput } from "../types/index.js";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

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

/**
 * Geocodes the start address and all delivery stop addresses.
 * Returns a geocoded start point and array of geocoded stops.
 * Requests are made in parallel with a concurrency cap to avoid rate limits.
 */
export async function geocodeAll(
  startAddress: string,
  stops: StopInput[],
  apiKey: string,
  concurrency = 10
): Promise<{ start: GeocodedStop; stops: GeocodedStop[] }> {
  const allAddresses: StopInput[] = [
    { address: startAddress, packageCount: 0 },
    ...stops,
  ];

  const results: GeocodedStop[] = [];

  for (let i = 0; i < allAddresses.length; i += concurrency) {
    const batch = allAddresses.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (stop) => {
        const coords = await geocodeAddress(stop.address, apiKey);
        return {
          address: stop.address,
          packageCount: stop.packageCount ?? 1,
          lat: coords.lat,
          lng: coords.lng,
        } satisfies GeocodedStop;
      })
    );
    results.push(...batchResults);
  }

  const [start, ...geocodedStops] = results;
  return { start, stops: geocodedStops };
}
