import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QuickRouteResponse } from "../api";
import { STATIONS, DEFAULT_STATION } from "../config/operations";
import { QUICK_ROUTE_SERVICE_AREA } from "../config/quickRouteServiceArea";
import { QuickRouteMap } from "../components/QuickRouteMap";
import { AddressAutocomplete, type AddressSuggestion } from "../components/AddressAutocomplete";
import { googleMapsStopUrl, wazeStopUrl } from "../utils/navigationLinks";
import {
  applyStopSuggestion,
  applyStopTextEdit,
  confirmableCandidates,
  migrateSavedStops,
  newStop,
  parsePastedAddresses,
  stopBlocksRoute,
  stopIsFilled,
  type QuickRouteStop,
  type VerificationStatus,
} from "../utils/quickRouteStops";

type StartMode = "station" | "location" | "custom";

const STORAGE_KEY = "parcel-sweep:quick-route";

interface SavedState {
  stops: unknown[];
  startMode: StartMode;
  stationId: string;
  customAddress: string;
}

function loadSaved(): Partial<SavedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SavedState>) : {};
  } catch {
    return {};
  }
}

function saveState(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Build a Google Maps multi-stop URL from the optimized result. */
function buildGoogleMapsUrl(result: QuickRouteResponse): string {
  const points = [
    `${result.start.lat},${result.start.lng}`,
    ...result.route.flatMap((step) => step.stops.map((s) => `${s.lat},${s.lng}`)),
  ];
  return `https://www.google.com/maps/dir/${points.join("/")}`;
}

/** Build a Waze URL for the first stop (Waze doesn't support multi-stop via URL). */
function buildWazeUrl(result: QuickRouteResponse): string {
  const first = result.route[0]?.stops[0];
  if (!first) return "https://waze.com/ul";
  return wazeStopUrl({ lat: first.lat, lng: first.lng, address: first.address });
}

/** Build plain-text stop list for clipboard copy. */
function buildTextList(result: QuickRouteResponse): string {
  return [`Start: ${result.start.address}`, ...result.route.map((step) =>
    `${step.sequence}. ${step.stops.map((s) => s.address).join(" + ")}`
  )].join("\n");
}

function verificationLabel(status: VerificationStatus): string {
  if (status === "verified") return "Verified";
  if (status === "needs_review") return "Needs review";
  return "Unresolved";
}

export function QuickRoutePage() {
  const saved = loadSaved();

  const [stops, setStops] = useState<QuickRouteStop[]>(() => migrateSavedStops(saved.stops));
  const [startMode, setStartMode] = useState<StartMode>(saved.startMode ?? "location");
  const [stationId, setStationId] = useState(saved.stationId ?? DEFAULT_STATION.id);
  const [customAddress, setCustomAddress] = useState(saved.customAddress ?? "");
  const [customStartCoords, setCustomStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const customSelectRef = useRef<string | null>(null);

  // Geolocation
  const [locating, setLocating] = useState(false);
  const [locatedCoords, setLocatedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locatedLabel, setLocatedLabel] = useState("");
  const [locationError, setLocationError] = useState("");

  // Bulk paste panel
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // Submission
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickRouteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const addStopRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const autoLocateAttempted = useRef(false);

  // Persist to localStorage whenever key state changes
  useEffect(() => {
    saveState({ stops, startMode, stationId, customAddress });
  }, [stops, startMode, stationId, customAddress]);

  const registerRef = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const addStop = useCallback(() => {
    const s = newStop();
    setStops((prev) => [...prev, s]);
    requestAnimationFrame(() => {
      inputRefs.current.get(s.id)?.focus();
    });
  }, []);

  const removeStop = useCallback((id: string) => {
    setStops((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      requestAnimationFrame(() => {
        const target = next[Math.min(idx, next.length - 1)];
        if (target) inputRefs.current.get(target.id)?.focus();
        else addStopRef.current?.focus();
      });
      return next;
    });
  }, []);

  const updateStop = useCallback((id: string, address: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? applyStopTextEdit(s, address) : s)));
  }, []);

  const handleStopSelect = useCallback((stopId: string, suggestion: AddressSuggestion, rawInput: string) => {
    setStops((prev) => {
      const idx = prev.findIndex((s) => s.id === stopId);
      if (idx < 0) return prev;
      const updated = prev.map((s) =>
        s.id === stopId ? applyStopSuggestion(s, suggestion, rawInput) : s
      );
      const selected = updated[idx];
      if (selected.verificationStatus !== "verified") return updated;
      if (idx === prev.length - 1) {
        const nextStop = newStop();
        requestAnimationFrame(() => {
          inputRefs.current.get(nextStop.id)?.focus();
        });
        return [...updated, nextStop];
      }
      const nextId = updated[idx + 1].id;
      requestAnimationFrame(() => {
        inputRefs.current.get(nextId)?.focus();
      });
      return updated;
    });
  }, []);

  const handleConfirmCandidate = useCallback((stopId: string, suggestion: AddressSuggestion) => {
    setStops((prev) =>
      prev.map((s) =>
        s.id === stopId ? applyStopSuggestion(s, suggestion, s.rawInput, { userConfirmed: true }) : s
      )
    );
  }, []);

  const handleSuggestionsChange = useCallback((stopId: string, suggestions: AddressSuggestion[]) => {
    setStops((prev) =>
      prev.map((s) => (s.id === stopId ? { ...s, reviewCandidates: suggestions } : s))
    );
  }, []);

  const handleStopKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = stops.findIndex((s) => s.id === id);
        if (idx === stops.length - 1) {
          addStop();
        } else {
          inputRefs.current.get(stops[idx + 1].id)?.focus();
        }
      } else if (e.key === "Backspace") {
        const stop = stops.find((s) => s.id === id);
        if (stop?.address === "" && stops.length > 1) {
          e.preventDefault();
          removeStop(id);
        }
      }
    },
    [stops, addStop, removeStop]
  );

  const handleLocate = useCallback((options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setLocationError("Geolocation is not supported by this browser.");
      }
      return;
    }
    setLocating(true);
    if (!options?.silent) {
      setLocationError("");
      setLocatedCoords(null);
      setLocatedLabel("");
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocatedCoords({ lat: latitude, lng: longitude });
        setLocatedLabel(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setLocating(false);
        setLocationError("");
      },
      (err) => {
        if (!options?.silent) {
          setLocationError(`Could not get location: ${err.message}`);
        }
        setLocating(false);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  // Acquire location on load for route start (when selected) and autocomplete bias.
  useEffect(() => {
    if (autoLocateAttempted.current || locatedCoords || locating) return;
    if (!navigator.geolocation) return;
    autoLocateAttempted.current = true;
    handleLocate({ silent: true });
  }, [locatedCoords, locating, handleLocate]);

  /** Parse pasted text into stop entries and append to list. Newline is the delimiter. */
  const handlePasteImport = useCallback(() => {
    const lines = parsePastedAddresses(pasteText);
    if (lines.length === 0) return;
    const imported = lines.map((addr) => newStop(addr));
    setStops((prev) => {
      const filled = prev.filter((s) => stopIsFilled(s));
      return [...filled, ...imported];
    });
    setPasteText("");
    setShowPaste(false);
  }, [pasteText]);

  const handleClearAll = useCallback(() => {
    setStops([newStop(), newStop()]);
    setResult(null);
    setError("");
  }, []);

  const selectedStation = STATIONS.find((s) => s.id === stationId) ?? DEFAULT_STATION;

  // Prefer the user's location for autocomplete whenever we have it.
  const stopAutocompleteBias =
    locatedCoords ??
    (startMode === "station" ? selectedStation.coords : QUICK_ROUTE_SERVICE_AREA.center);

  const customStartBias = locatedCoords ?? undefined;

  const resolvedStartAddress = (() => {
    if (startMode === "station") return selectedStation.address;
    if (startMode === "location") return locatedLabel || "Current Location";
    return customAddress.trim();
  })();

  const resolvedStartCoords =
    startMode === "location"
      ? locatedCoords ?? undefined
      : startMode === "station"
        ? selectedStation.coords
        : customStartCoords ?? undefined;

  const filledStops = stops.filter((s) => stopIsFilled(s));
  const hasUnverifiedStops = filledStops.some((s) => stopBlocksRoute(s));
  const canSubmit =
    !loading &&
    filledStops.length >= 1 &&
    !hasUnverifiedStops &&
    resolvedStartAddress.length > 0 &&
    (startMode !== "location" || locatedCoords !== null);

  const handleSubmit = async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await api.quickRoute.optimize({
        startAddress: resolvedStartAddress,
        startCoords: resolvedStartCoords,
        stops: filledStops.map((s) => ({
          address: s.address.trim(),
          rawInput: s.rawInput,
          lat: s.lat,
          lng: s.lng,
          placeId: s.placeId,
          confidence: s.confidence,
          verificationStatus: s.verificationStatus,
        })),
      });
      setResult(res);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Route optimization failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyList = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildTextList(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <main className="page-container">
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem" }}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: ".2rem" }}>
              Quick Route
            </h1>
            <p className="text-muted" style={{ fontSize: ".875rem" }}>
              Enter addresses, pick a start, and get an optimized route.
            </p>
          </div>
          {(filledStops.length > 0 || result) && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClearAll}
              style={{ flexShrink: 0, marginTop: ".2rem" }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* ── Start point ─────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontWeight: 700, fontSize: ".8rem", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".75rem" }}>
            Start from
          </div>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            {(["location", "station", "custom"] as StartMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setStartMode(mode)}
                style={{
                  padding: ".4rem .9rem",
                  borderRadius: 999,
                  border: "1.5px solid",
                  borderColor: startMode === mode ? "var(--brand)" : "var(--border)",
                  background: startMode === mode ? "var(--brand)" : "transparent",
                  color: startMode === mode ? "#fff" : "var(--text)",
                  fontWeight: 600,
                  fontSize: ".85rem",
                  cursor: "pointer",
                  transition: "all .15s",
                }}
              >
                {mode === "station" && "Home Station"}
                {mode === "location" && "Current Location"}
                {mode === "custom" && "Custom Address"}
              </button>
            ))}
          </div>

          {startMode === "station" && (
            <select
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              style={{ width: "100%", marginTop: ".75rem" }}
            >
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.address}
                </option>
              ))}
            </select>
          )}

          {startMode === "location" && (
            <>
              <div style={{ display: "flex", gap: ".75rem", alignItems: "center", marginTop: ".75rem", flexWrap: "wrap" }}>
                {locatedCoords ? (
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem", flex: 1 }}>
                    <span style={{ color: "#16a34a", fontSize: ".95rem" }}>✓</span>
                    <span style={{ fontSize: ".875rem", color: "var(--text-secondary)" }}>
                      {locatedLabel}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted" style={{ fontSize: ".875rem", flex: 1 }}>
                    {locating ? "Locating…" : "Location not yet acquired"}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleLocate()}
                  disabled={locating}
                  style={{ flexShrink: 0 }}
                >
                  {locating ? <><span className="spinner" /> Locating…</> : locatedCoords ? "Re-locate" : "Locate me"}
                </button>
              </div>
              {locationError && (
                <div style={{ color: "#dc2626", fontSize: ".85rem", marginTop: ".5rem" }}>
                  {locationError}
                </div>
              )}
            </>
          )}

          {startMode === "custom" && (
            <AddressAutocomplete
              value={customAddress}
              onChange={(v) => {
                setCustomAddress(v);
                if (customSelectRef.current === v) {
                  customSelectRef.current = null;
                  return;
                }
                setCustomStartCoords(null);
              }}
              onSelect={(suggestion) => {
                customSelectRef.current = suggestion.displayName;
                setCustomAddress(suggestion.displayName);
                if (
                  suggestion.lat !== undefined &&
                  suggestion.lng !== undefined &&
                  Number.isFinite(suggestion.lat) &&
                  Number.isFinite(suggestion.lng) &&
                  !(suggestion.lat === 0 && suggestion.lng === 0)
                ) {
                  setCustomStartCoords({ lat: suggestion.lat, lng: suggestion.lng });
                } else {
                  setCustomStartCoords(null);
                }
              }}
              placeholder="Your home address, any city"
              serviceAreaOnly={false}
              near={customStartBias}
              style={{ width: "100%", marginTop: ".75rem" }}
            />
          )}
        </div>

        {/* ── Address list ─────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
            <div style={{ fontWeight: 700, fontSize: ".8rem", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Stops {filledStops.length > 0 && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({filledStops.length})</span>}
            </div>
            <button
              type="button"
              onClick={() => setShowPaste((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--brand)",
                fontWeight: 600,
                fontSize: ".82rem",
                cursor: "pointer",
                padding: ".1rem .3rem",
              }}
            >
              {showPaste ? "Cancel paste" : "Paste list"}
            </button>
          </div>

          {/* Bulk paste panel */}
          {showPaste && (
            <div
              style={{
                marginBottom: "1rem",
                padding: ".85rem",
                background: "var(--hover-bg)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: ".5rem" }}>
                Paste addresses — one per line. Commas stay part of the address.
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"2221 S Olive St, South Bend, IN 46614\n2107 S Mead St, South Bend, IN 46613"}
                autoFocus
                style={{
                  width: "100%",
                  minHeight: 100,
                  fontFamily: "inherit",
                  fontSize: ".875rem",
                  padding: ".5rem .65rem",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius)",
                  background: "var(--input-bg)",
                  color: "var(--text)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={handlePasteImport}
                disabled={pasteText.trim().length === 0}
                style={{ marginTop: ".5rem" }}
              >
                Add to list
              </button>
            </div>
          )}

          {/* Individual stop inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: ".65rem" }}>
            {stops.map((stop, idx) => {
              const filled = stopIsFilled(stop);
              const confirmable = confirmableCandidates(stop.reviewCandidates ?? [], stop.rawInput);
              return (
                <div key={stop.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: stop.verificationStatus === "verified" ? "#16a34a" : stop.address.trim() ? "var(--brand)" : "var(--border)",
                        color: stop.address.trim() ? "#fff" : "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                        userSelect: "none",
                        transition: "background .15s, color .15s",
                      }}
                    >
                      {idx + 1}
                    </div>
                    <AddressAutocomplete
                      ref={(el) => registerRef(stop.id, el)}
                      value={stop.address}
                      onChange={(v) => updateStop(stop.id, v)}
                      onSelect={(suggestion, rawInput) => handleStopSelect(stop.id, suggestion, rawInput)}
                      onSuggestionsChange={(suggestions) => handleSuggestionsChange(stop.id, suggestions)}
                      onKeyDown={(e) => handleStopKeyDown(e, stop.id)}
                      placeholder={`Address ${idx + 1}`}
                      near={stopAutocompleteBias}
                      city={QUICK_ROUTE_SERVICE_AREA.city}
                      state={QUICK_ROUTE_SERVICE_AREA.state}
                    />
                    <button
                      type="button"
                      title="Remove stop"
                      onClick={() => removeStop(stop.id)}
                      disabled={stops.length <= 1}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        border: "1.5px solid var(--border)",
                        background: "transparent",
                        color: stops.length <= 1 ? "var(--text-meta)" : "var(--text-muted)",
                        cursor: stops.length <= 1 ? "default" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {filled && (
                    <div
                      className={`quick-route-verify-badge quick-route-verify-${stop.verificationStatus}`}
                      style={{ marginLeft: 34, marginTop: ".28rem" }}
                    >
                      {stop.verificationStatus === "verified" && "✓ "}
                      {verificationLabel(stop.verificationStatus)}
                      {stop.verificationStatus === "verified" && stop.address !== stop.rawInput && (
                        <span className="quick-route-verify-canonical"> · {stop.address}</span>
                      )}
                    </div>
                  )}
                  {filled && stop.verificationStatus === "needs_review" && (
                    <div className="quick-route-review-panel">
                      {confirmable.length > 0 ? (
                        <>
                          <div className="quick-route-review-hint">Choose the correct address:</div>
                          {confirmable.map((candidate) => (
                            <button
                              key={candidate.placeId}
                              type="button"
                              className="quick-route-review-option"
                              onClick={() => handleConfirmCandidate(stop.id, candidate)}
                            >
                              {candidate.displayName}
                            </button>
                          ))}
                        </>
                      ) : (
                        <div className="quick-route-review-hint">
                          No matching South Bend 46613/46614 candidate yet. Edit the address or pick a suggestion.
                        </div>
                      )}
                    </div>
                  )}
                  {filled && stop.verificationStatus === "unresolved" && (
                    <div className="quick-route-review-hint" style={{ marginLeft: 34 }}>
                      Could not resolve this address. Pick a suggestion or edit the text.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            ref={addStopRef}
            type="button"
            onClick={addStop}
            style={{
              marginTop: ".75rem",
              display: "flex",
              alignItems: "center",
              gap: ".4rem",
              background: "transparent",
              border: "1.5px dashed var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--brand)",
              fontWeight: 600,
              fontSize: ".875rem",
              padding: ".45rem .85rem",
              cursor: "pointer",
              width: "100%",
              justifyContent: "center",
            }}
          >
            + Add stop
          </button>
        </div>

        {/* ── Submit ─────────────────────────────────────────── */}
        {error && (
          <div style={{ color: "#dc2626", fontSize: ".9rem", marginBottom: "1rem" }}>{error}</div>
        )}

        {hasUnverifiedStops && filledStops.length > 0 && (
          <p className="text-muted" style={{ fontSize: ".82rem", marginTop: ".75rem", marginBottom: ".5rem" }}>
            Verify every stop before generating a route.
          </p>
        )}

        <button
          className="btn-primary"
          style={{ width: "100%", fontSize: "1rem", padding: ".75rem" }}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {loading ? (
            <><span className="spinner" /> Optimizing route…</>
          ) : (
            `Generate optimal route →`
          )}
        </button>

        {loading && (
          <p className="text-muted" style={{ fontSize: ".82rem", marginTop: ".5rem", textAlign: "center" }}>
            Optimizing {filledStops.length} verified stops — may take a few seconds.
          </p>
        )}

        {/* ── Results ──────────────────────────────────────── */}
        {result && (
          <div style={{ marginTop: "2rem" }} ref={resultRef}>

            {/* Summary bar */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "1px",
                background: "var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                marginBottom: "1.25rem",
              }}
            >
              {[
                { label: "Stops", value: String(result.route.length) },
                { label: "Drive time", value: formatDuration(result.summary.estimatedDriveSeconds) },
                { label: "Distance", value: `${result.summary.estimatedDriveMiles} mi` },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "var(--surface)", padding: ".75rem 1rem", textAlign: "center" }}>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--brand)" }}>{value}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: ".1rem" }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Navigate buttons */}
            <div
              style={{
                display: "flex",
                gap: ".6rem",
                flexWrap: "wrap",
                marginBottom: "1.25rem",
              }}
            >
              <a
                href={buildGoogleMapsUrl(result)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: "1 1 160px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: ".4rem",
                  background: "#1a73e8",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: ".9rem",
                  padding: ".65rem 1rem",
                  borderRadius: "var(--radius)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Open in Google Maps
              </a>
              <a
                href={buildWazeUrl(result)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: "1 1 120px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: ".4rem",
                  background: "#33ccff",
                  color: "#1a1a2e",
                  fontWeight: 700,
                  fontSize: ".9rem",
                  padding: ".65rem 1rem",
                  borderRadius: "var(--radius)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Open in Waze
              </a>
              <button
                type="button"
                onClick={() => void handleCopyList()}
                style={{
                  flex: "1 1 120px",
                  background: "var(--surface)",
                  border: "1.5px solid var(--border)",
                  color: copied ? "#16a34a" : "var(--text)",
                  fontWeight: 600,
                  fontSize: ".9rem",
                  padding: ".65rem 1rem",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "✓ Copied!" : "Copy stop list"}
              </button>
            </div>

            {/* Map */}
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.25rem" }}>
              <QuickRouteMap result={result} height={340} />
            </div>

            {/* Ordered stop list */}
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontWeight: 700, fontSize: ".8rem", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Optimized stop order
              </div>

              {/* Depot row */}
              <div
                style={{
                  display: "flex",
                  gap: ".75rem",
                  alignItems: "flex-start",
                  paddingBottom: ".75rem",
                  marginBottom: ".75rem",
                  borderBottom: "1px solid var(--row-border)",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    background: "#004b87",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 800,
                    flexShrink: 0,
                    letterSpacing: ".03em",
                  }}
                >
                  GO
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: ".875rem" }}>Start</div>
                  <div className="text-muted" style={{ fontSize: ".8rem" }}>{result.start.address}</div>
                </div>
              </div>

              {result.route.map((step, idx) => {
                const mins = Math.round(step.driveSecondsFromPrevious / 60);
                const isLast = idx === result.route.length - 1;
                // Build a single-stop Google Maps link for this stop
                const stopNavUrl = googleMapsStopUrl({
                  lat: step.stops[0]?.lat ?? 0,
                  lng: step.stops[0]?.lng ?? 0,
                  address: step.stops[0]?.address,
                });
                return (
                  <div
                    key={step.clusterId}
                    style={{
                      display: "flex",
                      gap: ".75rem",
                      alignItems: "flex-start",
                      paddingBottom: isLast ? 0 : ".75rem",
                      marginBottom: isLast ? 0 : ".75rem",
                      borderBottom: isLast ? "none" : "1px solid var(--row-border)",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "var(--brand)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {step.sequence}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {step.stops.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: ".875rem",
                            fontWeight: i === 0 ? 600 : 400,
                            color: i === 0 ? "var(--text)" : "var(--text-secondary)",
                            marginBottom: i < step.stops.length - 1 ? ".15rem" : 0,
                          }}
                        >
                          {s.address}
                        </div>
                      ))}
                      {step.alerts.length > 0 && (
                        <div style={{ fontSize: ".78rem", color: "#d97706", marginTop: ".2rem" }}>
                          ⚠ {step.alerts.join(" · ")}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: ".2rem", flexShrink: 0 }}>
                      <div style={{ fontSize: ".8rem", color: "var(--text-muted)", textAlign: "right" }}>
                        {mins > 0 && <span>{mins} min</span>}
                        {step.driveMilesFromPrevious > 0 && (
                          <div style={{ fontSize: ".75rem" }}>{step.driveMilesFromPrevious} mi</div>
                        )}
                      </div>
                      <a
                        href={stopNavUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: ".75rem",
                          color: "var(--brand)",
                          fontWeight: 600,
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Navigate →
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Plan another route */}
            <button
              type="button"
              className="btn-secondary"
              style={{ width: "100%" }}
              onClick={handleClearAll}
            >
              Plan another route
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
