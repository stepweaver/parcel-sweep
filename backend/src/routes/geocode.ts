import { Router, Request, Response } from "express";
import { searchAddressAutocomplete } from "../services/addressAutocomplete.js";

export const geocodeRouter = Router();

/**
 * GET /api/geocode/autocomplete?q=<query>
 *   [&near_lat=41.67&near_lng=-86.25]
 *   [&city=South Bend&state=IN]
 *
 * Returns address suggestions biased toward the service area (South Bend, IN by default).
 */
geocodeRouter.get(
  "/autocomplete",
  async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(parseInt(String(req.query.limit ?? "8"), 10), 10);
    const nearLat = req.query.near_lat ? parseFloat(String(req.query.near_lat)) : null;
    const nearLng = req.query.near_lng ? parseFloat(String(req.query.near_lng)) : null;
    const city = typeof req.query.city === "string" ? req.query.city.trim() : undefined;
    const state = typeof req.query.state === "string" ? req.query.state.trim() : undefined;
    const serviceAreaOnly = req.query.service_area_only !== "false";

    if (q.length < 3) {
      res.json({ suggestions: [] });
      return;
    }

    const near =
      nearLat !== null &&
      nearLng !== null &&
      !isNaN(nearLat) &&
      !isNaN(nearLng)
        ? { lat: nearLat, lng: nearLng }
        : undefined;

    try {
      const suggestions = await searchAddressAutocomplete({
        q,
        limit,
        near,
        city,
        state,
        serviceAreaOnly,
      });
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
