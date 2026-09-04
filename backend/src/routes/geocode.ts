import { Router, Request, Response } from "express";
import axios from "axios";
import { searchAddressAutocomplete } from "../services/addressAutocomplete.js";
import {
  BATCH_RESOLVE_MAX_ADDRESSES,
  resolveAddressBatch,
  type BatchResolveInput,
} from "../services/batchResolve.js";
import { isOpenAiConfigured, parseAddressList } from "../services/addressParser.js";
import {
  decodeAudioBase64,
  isTranscriptionConfigured,
  MAX_CAPTURE_AUDIO_BYTES,
  transcribeCaptureAudio,
} from "../services/transcribeAudio.js";
import { hasUsableGeometry } from "../services/addressMatch.js";

export const geocodeRouter = Router();

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? "parcel-sweep/1.0 (delivery route optimizer)";

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
 * GET /api/geocode/reverse?lat=&lng=
 *
 * Informational reverse-geocode label for manual map pins.
 * Never used to rename a stop's delivery address.
 */
geocodeRouter.get("/reverse", async (req: Request, res: Response): Promise<void> => {
  const lat = parseFloat(String(req.query.lat ?? ""));
  const lng = parseFloat(String(req.query.lng ?? ""));
  if (!hasUsableGeometry(lat, lng)) {
    res.status(400).json({ error: "lat and lng are required." });
    return;
  }
  try {
    const response = await axios.get<{ display_name?: string }>(NOMINATIM_REVERSE_URL, {
      params: { lat, lon: lng, format: "json", zoom: 18, addressdetails: 0 },
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      timeout: 4000,
    });
    const label = typeof response.data?.display_name === "string" ? response.data.display_name : "";
    res.json({ label });
  } catch (err) {
    console.warn(
      "[geocode] reverse lookup failed:",
      err instanceof Error ? err.message : err
    );
    res.json({ label: "" });
  }
});

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
    const preferGoogle = (req.body as { preferGoogle?: unknown })?.preferGoogle === true;
    const { results, count } = await resolveAddressBatch(entries, { preferGoogle });
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

geocodeRouter.get("/capture-config", (_req: Request, res: Response): void => {
  res.json({
    transcription: isTranscriptionConfigured(),
    openaiParser: isOpenAiConfigured(),
  });
});

/**
 * POST /api/geocode/capture
 *
 * Field capture: optional audio → transcript → structured addresses →
 * Google-first batch validation. Never drops a parsed row.
 */
geocodeRouter.post("/capture", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    transcript?: unknown;
    audioBase64?: unknown;
    audioMimeType?: unknown;
  };

  let transcript =
    typeof body.transcript === "string" ? body.transcript.replace(/\s+/g, " ").trim() : "";

  if (!transcript && typeof body.audioBase64 === "string" && body.audioBase64.trim()) {
    if (!isTranscriptionConfigured()) {
      res.status(503).json({
        error: "Server transcription isn’t configured. Paste or type the addresses instead.",
      });
      return;
    }
    try {
      const audio = decodeAudioBase64(body.audioBase64);
      if (audio.length > MAX_CAPTURE_AUDIO_BYTES) {
        res.status(400).json({ error: "Recording is too large. Try a shorter take." });
        return;
      }
      const mime = typeof body.audioMimeType === "string" ? body.audioMimeType : "audio/webm";
      transcript = await transcribeCaptureAudio(audio, mime);
    } catch (err) {
      res.status(422).json({
        error: err instanceof Error ? err.message : "We couldn't transcribe that recording.",
      });
      return;
    }
  }

  if (!transcript) {
    res.status(400).json({ error: "Add a recording or a list of addresses." });
    return;
  }

  const parsed = await parseAddressList(transcript);
  if (parsed.addresses.length === 0) {
    res.status(422).json({
      error: "We couldn't find any addresses in that input.",
      transcript,
      parsed: [],
      results: [],
      count: {
        parsed: 0,
        verified: 0,
        needsReview: 0,
        unresolved: 0,
        accountedFor: 0,
        ok: true,
      },
      parser: parsed.source,
    });
    return;
  }
  if (parsed.addresses.length > BATCH_RESOLVE_MAX_ADDRESSES) {
    res.status(400).json({
      error: `Batch is limited to ${BATCH_RESOLVE_MAX_ADDRESSES} addresses.`,
      transcript,
    });
    return;
  }

  const entries: BatchResolveInput[] = parsed.addresses.map((address) => ({
    id: crypto.randomUUID(),
    rawInput: address.rawInput,
    searchInput: address.addressInput,
  }));

  try {
    const { results, count } = await resolveAddressBatch(entries, { preferGoogle: true });
    if (results.length !== entries.length || !count.ok) {
      console.error("[capture] count invariant failed", {
        parsed: parsed.addresses.length,
        resolved: results.length,
        count,
      });
    }
    res.json({
      transcript,
      parser: parsed.source,
      parsed: parsed.addresses.map((address, index) => ({
        id: entries[index].id,
        rawInput: address.rawInput,
        addressInput: address.addressInput,
        express: address.express,
      })),
      results,
      count,
    });
  } catch (err) {
    console.warn("[capture] resolve failed", err instanceof Error ? err.message : err);
    const fallbackResults = entries.map((entry) => ({
      id: entry.id,
      rawInput: entry.rawInput,
      normalizedInput: (entry.searchInput ?? entry.rawInput).trim(),
      status: "unresolved" as const,
      reason: "Address service unavailable — try again.",
      candidates: [],
    }));
    res.json({
      transcript,
      parser: parsed.source,
      parsed: parsed.addresses.map((address, index) => ({
        id: entries[index].id,
        rawInput: address.rawInput,
        addressInput: address.addressInput,
        express: address.express,
      })),
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
