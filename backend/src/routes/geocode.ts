import { Router, Request, Response } from "express";
import axios from "axios";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    neighbourhood?: string;
    state?: string;
    postcode?: string;
    country_code?: string;
  };
}

export interface AutocompleteSuggestion {
  placeId: number;
  /** Short, display-friendly address: "123 Main St, South Bend, IN 46601" */
  displayName: string;
  lat: number;
  lng: number;
}

const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
};

function buildDisplayName(r: NominatimResult): string {
  const a = r.address;
  if (!a) {
    // Fall back to truncating the raw display_name at the county level
    return r.display_name.split(",").slice(0, 4).join(",").trim();
  }

  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.neighbourhood ?? "";
  const state = a.state ? (STATE_ABBR[a.state] ?? a.state) : "";
  const zip = a.postcode ?? "";

  const localityParts = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean);
  const locality = localityParts.join(", ");

  if (street && locality) return `${street}, ${locality}`;
  if (street) return street;
  if (locality) return locality;
  return r.display_name.split(",").slice(0, 3).join(",").trim();
}

export const geocodeRouter = Router();

/**
 * GET /api/geocode/autocomplete?q=<query>[&limit=5][&near_lat=41.67&near_lng=-86.25]
 *
 * Returns up to `limit` address suggestions from Nominatim.
 * Pass near_lat/near_lng to bias results toward a geographic area.
 * Soft-fails (returns empty array) on network error so the UI never breaks.
 */
geocodeRouter.get(
  "/autocomplete",
  async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(parseInt(String(req.query.limit ?? "6"), 10), 10);
    const nearLat = req.query.near_lat ? parseFloat(String(req.query.near_lat)) : null;
    const nearLng = req.query.near_lng ? parseFloat(String(req.query.near_lng)) : null;

    if (q.length < 3) {
      res.json({ suggestions: [] });
      return;
    }

    const params: Record<string, string | number> = {
      q,
      format: "json",
      addressdetails: 1,
      countrycodes: "us",
      limit,
    };

    // If a bias point is provided, use a 0.5° viewbox around it (≈35 miles)
    // bounded=0 means results outside the box are still returned, just ranked lower
    if (nearLat !== null && nearLng !== null && !isNaN(nearLat) && !isNaN(nearLng)) {
      const delta = 0.35;
      params.viewbox = `${nearLng - delta},${nearLat - delta},${nearLng + delta},${nearLat + delta}`;
      params.bounded = 0;
    }

    try {
      const response = await axios.get<NominatimResult[]>(NOMINATIM_SEARCH_URL, {
        params,
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
        timeout: 8000,
      });

      const suggestions: AutocompleteSuggestion[] = response.data
        .filter((r) => r.address?.road || r.address?.house_number)
        .map((r) => ({
          placeId: r.place_id,
          displayName: buildDisplayName(r),
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }));

      res.json({ suggestions });
    } catch (err) {
      console.warn(
        "[geocode] Autocomplete request failed:",
        err instanceof Error ? err.message : err
      );
      res.json({ suggestions: [] });
    }
  }
);
