import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { api, type RouteDetail, type RouteStopDetail } from "../api";
import { DeliveryMap } from "../components/DeliveryMap";
import { AlertBanner, type ActiveAlert } from "../components/AlertBanner";
import { joinRoute, leaveRoute, onStopCompleted, onRouteComplete } from "../socket";

// ── Client-side Haversine ──────────────────────────────────────────────────
const EARTH_R = 6_371_000;
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// ── Predictive alert thresholds ───────────────────────────────────────────
const ZONE_ARRIVING = 40;   // m  → full-screen flash, siren
const ZONE_ALERT    = 120;  // m  → urgent top banner, triple beep
const ZONE_WARNING  = 300;  // m  → amber toast, double ding

// ── Demo path interpolation ───────────────────────────────────────────────
function interpolatePath(geo: [number, number][], t: number): { lat: number; lng: number } {
  if (geo.length === 0) return { lat: 0, lng: 0 };
  if (geo.length === 1) return { lat: geo[0][1], lng: geo[0][0] };
  const dists = [0];
  for (let i = 1; i < geo.length; i++) {
    const dx = geo[i][0] - geo[i - 1][0], dy = geo[i][1] - geo[i - 1][1];
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = dists[dists.length - 1];
  const target = t * total;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= target) {
      const f = (target - dists[i - 1]) / (dists[i] - dists[i - 1]);
      return { lat: geo[i - 1][1] + f * (geo[i][1] - geo[i - 1][1]), lng: geo[i - 1][0] + f * (geo[i][0] - geo[i - 1][0]) };
    }
  }
  return { lat: geo[geo.length - 1][1], lng: geo[geo.length - 1][0] };
}

function fmtDist(m: number) { return m < 950 ? `${Math.round(m)}m` : `${(m / 1609.34).toFixed(1)} mi`; }
function fmtEta(secs: number) {
  if (secs <= 0) return "< 1 min";
  const m = Math.round(secs / 60);
  return m < 60 ? `~${m} min` : `~${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Component ────────────────────────────────────────────────────────────

export function DriverView() {
  const { id } = useParams<{ id: string }>();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routeComplete, setRouteComplete] = useState(false);

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);

  const [demoMode, setDemoMode] = useState(false);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoProgressRef = useRef(0);

  // Track which alert zones have already fired (keyed by `${stopId}:${zone}`)
  const firedZonesRef = useRef<Set<string>>(new Set());

  // GPS ping throttle — only POST to server every 5 seconds
  const lastPingRef = useRef(0);

  const refreshRoute = useCallback(async () => {
    if (!id) return;
    const r = await api.routes.get(id);
    setRoute(r);
    const next = r.stops.findIndex((s) => s.status === "pending");
    if (next >= 0) setActiveIdx(next);
    if (r.status === "complete") setRouteComplete(true);
  }, [id]);

  // ── Screen Wake Lock ────────────────────────────────────────────────────
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen")
      .then((wl) => { wakeLockRef.current = wl; })
      .catch(() => { /* permission denied — silently skip */ });
    return () => { wakeLockRef.current?.release().catch(() => {}); };
  }, []);

  // ── Proximity engine ────────────────────────────────────────────────────
  const checkProximity = useCallback((pos: { lat: number; lng: number }, r: RouteDetail, currentIdx: number) => {
    const pendingStops = r.stops.filter((s) => s.status === "pending");
    const currentStop = r.stops[currentIdx] ?? pendingStops[0];

    if (currentStop) {
      const dist = haversine(pos, currentStop.centroid);
      const sid = currentStop.id;

      if (dist < ZONE_ARRIVING && !firedZonesRef.current.has(`${sid}:arriving`)) {
        firedZonesRef.current.add(`${sid}:arriving`);
        setActiveAlert({
          id: uuidv4(),
          level: "arriving",
          lines: [
            `Stop #${currentStop.sequenceNumber}`,
            currentStop.packages[0]?.address ?? "Unknown address",
            `${currentStop.packages.reduce((s, p) => s + p.packageCount, 0)} package(s)`,
          ],
        });
      } else if (dist < ZONE_ALERT && !firedZonesRef.current.has(`${sid}:alert`)) {
        firedZonesRef.current.add(`${sid}:alert`);
        setActiveAlert({
          id: uuidv4(),
          level: "alert",
          lines: [
            `Stop #${currentStop.sequenceNumber} · ${fmtDist(dist)} ahead`,
            currentStop.packages[0]?.address ?? "Unknown address",
          ],
        });
      } else if (dist < ZONE_WARNING && !firedZonesRef.current.has(`${sid}:warning`)) {
        firedZonesRef.current.add(`${sid}:warning`);
        setActiveAlert({
          id: uuidv4(),
          level: "warning",
          lines: [
            `Stop #${currentStop.sequenceNumber} in ${fmtDist(dist)}`,
            currentStop.packages[0]?.address ?? "Unknown address",
          ],
        });
      }
    }

    // Check nearby stops in other sequence positions
    const alertMeters = r.alertMeters;
    for (const stop of pendingStops) {
      if (stop === currentStop) continue;
      const dist = haversine(pos, stop.centroid);
      if (dist < alertMeters && !firedZonesRef.current.has(`${stop.id}:nearby`)) {
        firedZonesRef.current.add(`${stop.id}:nearby`);
        setActiveAlert({
          id: uuidv4(),
          level: "nearby",
          lines: [
            `${fmtDist(dist)} away · Stop #${stop.sequenceNumber}`,
            stop.packages[0]?.address ?? "Unknown address",
            `${stop.packages.reduce((s, p) => s + p.packageCount, 0)} pkg(s) — consider delivering now`,
          ],
        });
        break; // one nearby alert at a time
      }
    }
  }, []);

  // ── Unified GPS handler ────────────────────────────────────────────────
  const handleGps = useCallback((pos: { lat: number; lng: number }, r: RouteDetail | null, currIdx: number) => {
    setDriverPos(pos);
    if (r) checkProximity(pos, r, currIdx);

    // Throttled server ping
    const now = Date.now();
    if (id && now - lastPingRef.current > 5000) {
      lastPingRef.current = now;
      void api.routes.gps(id, { lat: pos.lat, lng: pos.lng });
    }
  }, [id, checkProximity]);

  // ── Initial load + real GPS + socket ──────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let routeSnapshot: RouteDetail | null = null;
    let activeIdxSnapshot = 0;

    api.routes.get(id)
      .then((r) => {
        routeSnapshot = r;
        setRoute(r);
        if (r.status === "complete") setRouteComplete(true);
        const next = r.stops.findIndex((s) => s.status === "pending");
        activeIdxSnapshot = next >= 0 ? next : 0;
        setActiveIdx(activeIdxSnapshot);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    joinRoute(id);
    const offStop = onStopCompleted(async () => {
      await refreshRoute();
      firedZonesRef.current = new Set(); // reset zones after stop change
    });
    const offComplete = onRouteComplete(() => { setRouteComplete(true); void refreshRoute(); });

    // Real GPS watch
    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => handleGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }, routeSnapshot, activeIdxSnapshot),
        () => { /* permission denied — user can use Demo Mode */ },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }

    return () => {
      leaveRoute(id);
      offStop(); offComplete();
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (demoRef.current) clearInterval(demoRef.current);
    };
  }, [id, refreshRoute, handleGps]);

  // ── Demo mode ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (demoRef.current) { clearInterval(demoRef.current); demoRef.current = null; }
    if (!demoMode || !route) return;

    const allGeo: [number, number][] = [];
    for (const stop of route.stops) {
      if (stop.geometry) allGeo.push(...stop.geometry);
    }
    if (allGeo.length === 0) return;

    demoProgressRef.current = 0;
    let localIdx = activeIdx;

    demoRef.current = setInterval(() => {
      demoProgressRef.current = Math.min(demoProgressRef.current + 0.0025, 1);
      const pos = interpolatePath(allGeo, demoProgressRef.current);
      handleGps(pos, route, localIdx);
      if (demoProgressRef.current >= 1) { clearInterval(demoRef.current!); demoRef.current = null; }
    }, 150);

    return () => { if (demoRef.current) { clearInterval(demoRef.current); demoRef.current = null; } };
  }, [demoMode, route]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop actions ──────────────────────────────────────────────────────
  const handleArrive = async (stop: RouteStopDetail) => {
    if (!id) return;
    await api.routes.stopArrive(id, stop.id);
    await refreshRoute();
  };

  const handleComplete = async (stop: RouteStopDetail) => {
    if (!id) return;
    await api.routes.stopComplete(id, stop.id);
    firedZonesRef.current = new Set(); // reset proximity zones for new stop
    await refreshRoute();
  };

  const handleSkip = () => {
    if (!route) return;
    const pending = route.stops.filter((s) => s.status === "pending");
    const currentStop = route.stops[activeIdx];
    const nextDifferent = pending.find((s) => s.id !== currentStop?.id);
    if (nextDifferent) {
      const idx = route.stops.indexOf(nextDifferent);
      setActiveIdx(idx);
      firedZonesRef.current = new Set();
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#004b87" }}>
        <div style={{ color: "#fff", fontSize: "1.2rem" }}><span className="spinner" style={{ borderTopColor: "#fff" }} /> Loading route…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#7f1d1d", flexDirection: "column", gap: "1rem" }}>
        <div style={{ color: "#fca5a5", fontSize: "1.1rem" }}>Error: {error}</div>
        <Link to="/"><button className="btn-primary">Back</button></Link>
      </div>
    );
  }
  if (!route) return null;

  const activeStop = route.stops[activeIdx] ?? route.stops.find((s) => s.status !== "complete") ?? null;
  const pendingStops = route.stops.filter((s) => s.status !== "complete");
  const completedCount = route.stops.length - pendingStops.length;
  const nextStop = pendingStops.find((s) => s.id !== activeStop?.id);
  const distToActive = activeStop && driverPos ? haversine(driverPos, activeStop.centroid) : null;
  const totalPkgsAtStop = activeStop?.packages.reduce((s, p) => s + p.packageCount, 0) ?? 0;

  return (
    // position:fixed + inset:0 = immune to browser chrome/address bar changes
    <div className="driver-shell" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#000", touchAction: "none" }}>

      {/* ── Route complete overlay ──────────────────────────────────── */}
      {routeComplete && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20000, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <div style={{ fontSize: "5rem" }}>🎉</div>
            <div style={{ color: "#4ade80", fontWeight: 900, fontSize: "clamp(2rem, 8vw, 3rem)", marginBottom: ".5rem" }}>Route Complete!</div>
            <div style={{ color: "#d1d5db", marginBottom: "2rem" }}>All {route.stops.length} stops delivered.</div>
            <Link to="/"><button className="btn-primary" style={{ padding: "1rem 2rem", fontSize: "1.1rem" }}>Done</button></Link>
          </div>
        </div>
      )}

      {/* ── Alert overlay ───────────────────────────────────────────── */}
      <AlertBanner alert={activeAlert} onDismiss={() => setActiveAlert(null)} />

      {/* ── Header bar (52px) ───────────────────────────────────────── */}
      <div style={{
        height: 52,
        flexShrink: 0,
        background: "#004b87",
        display: "flex",
        alignItems: "center",
        padding: "0 .75rem",
        gap: ".75rem",
        zIndex: 100,
      }}>
        <Link to={`/routes/${id}/route`} style={{ color: "#90caf9", fontSize: ".8rem", flexShrink: 0 }}>← Plan</Link>
        <div style={{ flex: 1, color: "#fff", fontWeight: 800, fontSize: "clamp(.85rem, 3.5vw, 1rem)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {completedCount}/{route.stops.length} stops
          {distToActive !== null && (
            <span style={{ fontWeight: 400, marginLeft: ".5rem", color: "#93c5fd" }}>
              · {fmtDist(distToActive)} to next
            </span>
          )}
        </div>
        <button
          onClick={() => setDemoMode((v) => !v)}
          style={{
            background: demoMode ? "#da291c" : "rgba(255,255,255,.15)",
            color: "#fff", border: "none", borderRadius: 6,
            padding: ".35rem .75rem", fontWeight: 700, fontSize: ".8rem",
            cursor: "pointer", flexShrink: 0, minHeight: 36,
          }}
        >
          {demoMode ? "Stop" : "Demo"}
        </button>
      </div>

      {/* ── Map (fills all remaining space above bottom card) ───────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <DeliveryMap
          stops={route.stops}
          driverPosition={driverPos}
          activeStopId={activeStop?.id}
          clusterMeters={route.clusterMeters}
          followDriver
          style={{ width: "100%", height: "100%" }}
        />
        {/* No GPS overlay */}
        {!driverPos && (
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,.65)", color: "#fbbf24", padding: ".35rem .8rem",
            borderRadius: 20, fontSize: ".78rem", fontWeight: 700, whiteSpace: "nowrap",
            zIndex: 500,
          }}>
            No GPS · tap Demo to simulate
          </div>
        )}
      </div>

      {/* ── Bottom info card (fixed height) ──────────────────────────── */}
      {activeStop ? (
        <div style={{
          flexShrink: 0,
          background: "#0f172a",
          borderTop: "2px solid #1e3a5f",
          padding: "clamp(.75rem, 3vw, 1.1rem) clamp(.75rem, 3vw, 1.25rem)",
          display: "flex",
          flexDirection: "column",
          gap: ".5rem",
          zIndex: 100,
        }}>
          {/* Stop label + distance */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "#da291c", fontWeight: 900, fontSize: "clamp(.75rem, 3vw, .9rem)", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Stop #{activeStop.sequenceNumber}
            </span>
            {distToActive !== null && (
              <span style={{ color: "#94a3b8", fontSize: "clamp(.75rem, 2.8vw, .85rem)" }}>
                {fmtDist(distToActive)} · {fmtEta(activeStop.driveSecondsFromPrev)}
              </span>
            )}
          </div>

          {/* Address — BIG */}
          <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: "clamp(1.1rem, 5vw, 1.6rem)", lineHeight: 1.15 }}>
            {activeStop.packages[0]?.address ?? "Unknown address"}
          </div>

          {/* Recipient + package count */}
          <div style={{ color: "#94a3b8", fontSize: "clamp(.8rem, 3.2vw, 1rem)" }}>
            {activeStop.packages[0]?.recipientName}
            {activeStop.packages.length > 1 && ` + ${activeStop.packages.length - 1} more`}
            {" · "}
            <strong style={{ color: "#e2e8f0" }}>{totalPkgsAtStop}</strong> {totalPkgsAtStop === 1 ? "package" : "packages"}
          </div>

          {/* Alerts (compact inline) */}
          {activeStop.alerts.length > 0 && (
            <div style={{ color: "#fbbf24", fontSize: "clamp(.72rem, 2.8vw, .85rem)", display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
              {activeStop.alerts.map((a, i) => <span key={i}>⚠ {a}</span>)}
            </div>
          )}

          {/* Upcoming next stop preview */}
          {nextStop && (
            <div style={{ color: "#475569", fontSize: "clamp(.7rem, 2.5vw, .8rem)", borderTop: "1px solid #1e293b", paddingTop: ".4rem" }}>
              Next: #{nextStop.sequenceNumber} · {nextStop.packages[0]?.address ?? "?"}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: ".75rem", marginTop: ".25rem" }}>
            {activeStop.status === "pending" && (
              <button
                className="btn-primary"
                style={{ flex: 1, minHeight: 52, fontSize: "clamp(.9rem, 3.5vw, 1.05rem)", fontWeight: 800 }}
                onClick={() => void handleArrive(activeStop)}
              >
                Arrived
              </button>
            )}
            {activeStop.status === "arrived" && (
              <button
                className="btn-success"
                style={{ flex: 2, minHeight: 56, fontSize: "clamp(1rem, 4vw, 1.2rem)", fontWeight: 900, letterSpacing: ".03em" }}
                onClick={() => void handleComplete(activeStop)}
              >
                ✓ Delivered
              </button>
            )}
            {pendingStops.length > 1 && (
              <button
                className="btn-ghost"
                style={{ flex: 1, minHeight: 52, fontSize: "clamp(.85rem, 3vw, 1rem)", color: "#94a3b8", borderColor: "#334155" }}
                onClick={handleSkip}
              >
                Skip →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flexShrink: 0, background: "#0f172a", borderTop: "2px solid #1e3a5f", padding: "1.5rem", textAlign: "center" }}>
          <div style={{ color: "#4ade80", fontWeight: 900, fontSize: "1.4rem" }}>All stops complete! 🎉</div>
        </div>
      )}
    </div>
  );
}
