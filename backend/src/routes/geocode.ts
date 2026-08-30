import { Router, Request, Response } from "express";
import { searchAddressAutocomplete } from "../services/addressAutocomplete.js";
import {
  BATCH_RESOLVE_MAX_ADDRESSES,
  resolveAddressBatch,
  type BatchResolveInput,
} from "../services/batchResolve.js";

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

/**
 * POST /api/geocode/resolve-batch
 *
 * Resolves many addresses with bounded concurrency using the same Phase 1
 * matching / service-area / confidence rules as autocomplete.
 */
geocodeRouter.post("/resolve-batch", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { addresses?: unknown };
  if (!Array.isArray(body?.addresses)) {
    res.status(400).json({ error: "addresses must be an array." });
    return;
  }
  if (body.addresses.length === 0) {
    res.status(400).json({ error: "addresses must not be empty." });
    return;
  }
  if (body.addresses.length > BATCH_RESOLVE_MAX_ADDRESSES) {
    res.status(400).json({
      error: `Batch is limited to ${BATCH_RESOLVE_MAX_ADDRESSES} addresses.`,
    });
    return;
  }

  const entries: BatchResolveInput[] = [];
  for (const item of body.addresses) {
    if (typeof item !== "object" || item === null) {
      res.status(400).json({ error: "Each address entry must be an object." });
      return;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.trim().length === 0) {
      res.status(400).json({ error: "Each address entry must include a string id." });
      return;
    }
    if (typeof rec.rawInput !== "string") {
      res.status(400).json({ error: "Each address entry must include rawInput." });
      return;
    }
    entries.push({
      id: rec.id,
      rawInput: rec.rawInput,
      searchInput: typeof rec.searchInput === "string" ? rec.searchInput : rec.rawInput,
    });
  }

  try {
    const { results, count } = await resolveAddressBatch(entries);
    res.json({ results, count });
  } catch (err) {
    console.warn(
      "[geocode:batch] Batch request failed:",
      err instanceof Error ? err.message : err
    );
    const fallbackResults = entries.map((entry) => ({
      id: entry.id,
      rawInput: entry.rawInput,
      normalizedInput: (entry.searchInput ?? entry.rawInput).trim(),
      status: "unresolved" as const,
      reason: "Address service unavailable — try again.",
      candidates: [],
    }));
    res.json({
      results: fallbackResults,
      count: {
        parsed: entries.length,
        verified: 0,
        needsReview: 0,
        unresolved: entries.length,
        accountedFor: entries.length,
        ok: true,
      },
    });
  }
});
