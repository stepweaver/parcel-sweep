import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QuickRouteResponse } from "../api";
import { STATIONS, DEFAULT_STATION } from "../config/operations";
import { QuickRouteMap } from "../components/QuickRouteMap";
import { FriendlyInput } from "../components/FriendlyInput";

interface StopEntry {
  id: string;
  address: string;
}

type StartMode = "station" | "location" | "custom";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function newStop(address = ""): StopEntry {
  return { id: crypto.randomUUID(), address };
}

export function QuickRoutePage() {
  const [stops, setStops] = useState<StopEntry[]>([newStop(), newStop()]);

  // Start point
  const [startMode, setStartMode] = useState<StartMode>("station");
  const [stationId, setStationId] = useState(DEFAULT_STATION.id);
  const [customAddress, setCustomAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [locatedCoords, setLocatedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locatedLabel, setLocatedLabel] = useState("");
  const [locationError, setLocationError] = useState("");

  // Submission
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickRouteResponse | null>(null);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const addStopRef = useRef<HTMLButtonElement>(null);

  const registerRef = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const addStop = useCallback(() => {
    const s = newStop();
    setStops((prev) => [...prev, s]);
    // Focus the new input after render
    requestAnimationFrame(() => {
      inputRefs.current.get(s.id)?.focus();
    });
  }, []);

  const removeStop = useCallback((id: string) => {
    setStops((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      // Focus previous or next stop, or the add button
      requestAnimationFrame(() => {
        const target = next[Math.min(idx, next.length - 1)];
        if (target) inputRefs.current.get(target.id)?.focus();
        else addStopRef.current?.focus();
      });
      return next;
    });
  }, []);

  const updateStop = useCallback((id: string, address: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, address } : s)));
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

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocationError("");
    setLocatedCoords(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocatedCoords({ lat: latitude, lng: longitude });
        setLocatedLabel(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setLocating(false);
      },
      (err) => {
        setLocationError(`Could not get location: ${err.message}`);
        setLocating(false);
      },
      { timeout: 10000 }
    );
  }, []);

  // Auto-locate when mode switches to location
  useEffect(() => {
    if (startMode === "location" && !locatedCoords && !locating) {
      handleLocate();
    }
  }, [startMode, locatedCoords, locating, handleLocate]);

  const selectedStation = STATIONS.find((s) => s.id === stationId) ?? DEFAULT_STATION;

  const resolvedStartAddress = (() => {
    if (startMode === "station") return selectedStation.address;
    if (startMode === "location") return locatedLabel || "Current Location";
    return customAddress.trim();
  })();

  const resolvedStartCoords = startMode === "location" ? locatedCoords ?? undefined : undefined;

  const filledStops = stops.filter((s) => s.address.trim().length > 0);
  const canSubmit =
    !loading &&
    filledStops.length >= 1 &&
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
        stops: filledStops.map((s) => ({ address: s.address.trim() })),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Route optimization failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-container">
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: ".25rem" }}>
          Quick Route Planner
        </h1>
        <p className="text-muted" style={{ fontSize: ".9rem", marginBottom: "2rem" }}>
          Add addresses, pick a start point, and generate an optimized route instantly.
        </p>

        {/* ── Start point ─────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontWeight: 700, fontSize: ".85rem", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".75rem" }}>
            Start from
          </div>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: startMode !== "station" ? ".75rem" : 0 }}>
            {(["station", "location", "custom"] as StartMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setStartMode(mode)}
                style={{
                  padding: ".4rem .9rem",
                  borderRadius: 999,
                  border: "1.5px solid",
                  borderColor: startMode === mode ? "var(--usps-blue)" : "var(--border)",
                  background: startMode === mode ? "var(--usps-blue)" : "transparent",
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
            <div style={{ display: "flex", gap: ".75rem", alignItems: "center", marginTop: ".25rem", flexWrap: "wrap" }}>
              {locatedCoords ? (
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flex: 1 }}>
                  <span style={{ fontSize: "1rem" }}>📍</span>
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
                onClick={handleLocate}
                disabled={locating}
                style={{ flexShrink: 0 }}
              >
                {locating ? <><span className="spinner" /> Locating…</> : locatedCoords ? "Re-locate" : "Locate me"}
              </button>
            </div>
          )}

          {startMode === "location" && locationError && (
            <div style={{ color: "#dc2626", fontSize: ".85rem", marginTop: ".5rem" }}>
              {locationError}
            </div>
          )}

          {startMode === "custom" && (
            <FriendlyInput
              type="text"
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder="e.g. 123 Main St, South Bend, IN 46601"
              style={{ width: "100%", marginTop: ".75rem" }}
            />
          )}
        </div>

        {/* ── Address list ─────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontWeight: 700, fontSize: ".85rem", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: ".75rem" }}>
            Stops
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
            {stops.map((stop, idx) => (
              <div
                key={stop.id}
                style={{ display: "flex", alignItems: "center", gap: ".5rem" }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "var(--usps-blue)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                    userSelect: "none",
                  }}
                >
                  {idx + 1}
                </div>
                <FriendlyInput
                  ref={(el) => registerRef(stop.id, el)}
                  type="text"
                  value={stop.address}
                  onChange={(e) => updateStop(stop.id, e.target.value)}
                  onKeyDown={(e) => handleStopKeyDown(e, stop.id)}
                  placeholder={`Address ${idx + 1}`}
                  style={{ flex: 1 }}
                  autoComplete="off"
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
                    transition: "border-color .15s, color .15s",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
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
              color: "var(--usps-blue)",
              fontWeight: 600,
              fontSize: ".875rem",
              padding: ".45rem .85rem",
              cursor: "pointer",
              width: "100%",
              justifyContent: "center",
              transition: "border-color .15s, background .15s",
            }}
          >
            + Add stop
          </button>
        </div>

        {/* ── Submit ─────────────────────────────────────────── */}
        {error && (
          <div style={{ color: "#dc2626", fontSize: ".9rem", marginBottom: "1rem" }}>{error}</div>
        )}

        <button
          className="btn-primary"
          style={{ width: "100%", fontSize: "1rem", padding: ".7rem" }}
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
            Geocoding addresses and running optimizer — this may take a few seconds.
          </p>
        )}

        {/* ── Results ──────────────────────────────────────── */}
        {result && (
          <div style={{ marginTop: "2rem" }}>
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
                <div
                  key={label}
                  style={{
                    background: "var(--surface)",
                    padding: ".75rem 1rem",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--usps-blue)" }}>
                    {value}
                  </div>
                  <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: ".1rem" }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Map */}
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.25rem" }}>
              <QuickRouteMap result={result} height={340} />
            </div>

            {/* Stop list */}
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: ".85rem", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Optimized stop order
              </div>

              {/* Depot */}
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
                        background: "var(--usps-blue)",
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
                        <div key={i} style={{ fontSize: ".875rem", fontWeight: i === 0 ? 600 : 400, color: i === 0 ? "var(--text)" : "var(--text-secondary)", marginBottom: i < step.stops.length - 1 ? ".15rem" : 0 }}>
                          {s.address}
                        </div>
                      ))}
                      {step.alerts.length > 0 && (
                        <div style={{ fontSize: ".78rem", color: "#d97706", marginTop: ".2rem" }}>
                          ⚠ {step.alerts.join(" · ")}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: ".8rem", color: "var(--text-muted)", textAlign: "right", flexShrink: 0, marginTop: 4 }}>
                      {mins > 0 && <>{mins} min</>}
                      <div style={{ fontSize: ".75rem" }}>
                        {step.driveMilesFromPrevious > 0 && `${step.driveMilesFromPrevious} mi`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
