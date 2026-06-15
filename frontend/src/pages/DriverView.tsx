import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { api, type RouteDetail, type RouteStopDetail } from "../api";
import { DeliveryMap } from "../components/DeliveryMap";
import { MapThemeSelector } from "../components/MapThemeSelector";
import { AlertBanner, type ActiveAlert } from "../components/AlertBanner";
import { useMapTheme } from "../hooks/useMapTheme";
import { NavigateButtons } from "../components/NavigateButtons";
import { joinRoute, leaveRoute, onStopCompleted, onRouteComplete } from "../socket";
import { notifyProximityAlert, requestNotificationPermission } from "../utils/proximityNotify";
import { filterFutureNearbyAlerts } from "../utils/nearbyAlerts";

// ── Client-side Haversine ──────────────────────────────────────────────────
const EARTH_R = 6_371_000;
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function compassBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const toD = (r: number) => (r * 180) / Math.PI;
  const dLng = toR(to.lng - from.lng);
  const lat1 = toR(from.lat);
  const lat2 = toR(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toD(Math.atan2(y, x)) + 360) % 360;
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

/** Urban delivery pace when route leg timings are unavailable (~25 mph). */
const DEMO_URBAN_MPS = 11;
const DEMO_TICK_MS = 200;
const DEMO_SPEED_OPTIONS = [1, 2, 4] as const;
type DemoSpeed = (typeof DEMO_SPEED_OPTIONS)[number];

function estimatePathDurationSec(geo: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < geo.length; i++) {
    meters += haversine(
      { lat: geo[i - 1][1], lng: geo[i - 1][0] },
      { lat: geo[i][1], lng: geo[i][0] },
    );
  }
  return meters / DEMO_URBAN_MPS;
}

function demoLegDurationSec(stop: RouteStopDetail, geo: [number, number][]): number {
  const driveSec = stop.driveSecondsFromPrev;
  const estimated = driveSec > 0 ? driveSec : estimatePathDurationSec(geo);
  return Math.max(estimated, 30);
}

/** Bearing along the route polyline at normalized progress t ∈ [0, 1]. */
function headingFromPath(geo: [number, number][], t: number): number {
  if (geo.length < 2) return 0;
  const ahead = Math.min(t + 0.015, 1);
  const from = interpolatePath(geo, t);
  const to = interpolatePath(geo, ahead);
  if (haversine(from, to) < 0.5) {
    return compassBearing(
      { lat: geo[0][1], lng: geo[0][0] },
      { lat: geo[1][1], lng: geo[1][0] },
    );
  }
  return compassBearing(from, to);
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
  const { themeId, setThemeId } = useMapTheme();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routeComplete, setRouteComplete] = useState(false);

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [driverHeading, setDriverHeading] = useState<number | null>(null);
  const prevPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);

  const [demoMode, setDemoMode] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState<DemoSpeed>(1);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoProgressRef = useRef(0);
  const demoSpeedRef = useRef<DemoSpeed>(1);
  const demoActionBusyRef = useRef(false);
  const lastDemoLegRef = useRef<string | null>(null);
  demoSpeedRef.current = demoSpeed;
  const routeRef = useRef<RouteDetail | null>(null);
  const activeIdxRef = useRef(0);
  routeRef.current = route;
  activeIdxRef.current = activeIdx;

  // Track which alert zones have already fired (keyed by `${stopId}:${zone}`)
  const firedZonesRef = useRef<Set<string>>(new Set());

  // GPS ping throttle — only POST to server every 5 seconds
  const lastPingRef = useRef(0);

  const refreshRoute = useCallback(async () => {
    if (!id) return;
    const r = await api.routes.get(id);
    routeRef.current = r;
    setRoute(r);
    const next = r.stops.findIndex((s) => s.status === "pending");
    if (next >= 0) {
      activeIdxRef.current = next;
      setActiveIdx(next);
    }
    if (r.status === "complete") setRouteComplete(true);
  }, [id]);

  /** Demo mirrors production: auto-arrive at the arriving zone, auto-deliver at the stop. */
  const processDemoStopActions = useCallback(async (
    pos: { lat: number; lng: number },
    r: RouteDetail,
    currIdx: number,
    atLegEnd: boolean,
  ) => {
    if (!demoMode || !id || demoActionBusyRef.current) return;

    const stop = routeRef.current?.stops[currIdx] ?? r.stops[currIdx];
    if (!stop || stop.status === "complete") return;

    const dist = haversine(pos, stop.centroid);

    if (stop.status === "pending" && (dist <= ZONE_ARRIVING || atLegEnd)) {
      demoActionBusyRef.current = true;
      try {
        await api.routes.stopArrive(id, stop.id);
        if (atLegEnd) {
          await api.routes.stopComplete(id, stop.id);
          firedZonesRef.current = new Set();
          await refreshRoute();
        } else {
          setRoute((prev) => {
            if (!prev) return prev;
            const updated = {
              ...prev,
              stops: prev.stops.map((s) =>
                s.id === stop.id
                  ? { ...s, status: "arrived" as const, arrivedAt: new Date().toISOString() }
                  : s,
              ),
            };
            routeRef.current = updated;
            return updated;
          });
        }
      } finally {
        demoActionBusyRef.current = false;
      }
      return;
    }

    const liveStop = routeRef.current?.stops[currIdx] ?? stop;
    if (liveStop.status === "arrived" && atLegEnd) {
      demoActionBusyRef.current = true;
      try {
        await api.routes.stopComplete(id, liveStop.id);
        firedZonesRef.current = new Set();
        await refreshRoute();
      } finally {
        demoActionBusyRef.current = false;
      }
    }
  }, [demoMode, id, refreshRoute]);

  // ── Screen Wake Lock + notification permission ─────────────────────────
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen")
      .then((wl) => { wakeLockRef.current = wl; })
      .catch(() => { /* permission denied — silently skip */ });
    void requestNotificationPermission();
    return () => { wakeLockRef.current?.release().catch(() => {}); };
  }, []);

  const fireAlert = useCallback((alert: ActiveAlert) => {
    setActiveAlert(alert);
    notifyProximityAlert(alert);
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
        fireAlert({
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
        fireAlert({
          id: uuidv4(),
          level: "alert",
          lines: [
            `Stop #${currentStop.sequenceNumber} · ${fmtDist(dist)} ahead`,
            currentStop.packages[0]?.address ?? "Unknown address",
          ],
        });
      } else if (dist < ZONE_WARNING && !firedZonesRef.current.has(`${sid}:warning`)) {
        firedZonesRef.current.add(`${sid}:warning`);
        fireAlert({
          id: uuidv4(),
          level: "warning",
          lines: [
            `Stop #${currentStop.sequenceNumber} in ${fmtDist(dist)}`,
            currentStop.packages[0]?.address ?? "Unknown address",
          ],
        });
      }
    }

    // Check nearby stops later in the delivery sequence only
    const alertMeters = r.alertMeters;
    for (const stop of pendingStops) {
      if (stop === currentStop) continue;
      if (currentStop && stop.sequenceNumber <= currentStop.sequenceNumber) continue;
      const dist = haversine(pos, stop.centroid);
      if (dist < alertMeters && !firedZonesRef.current.has(`${stop.id}:nearby`)) {
        firedZonesRef.current.add(`${stop.id}:nearby`);
        fireAlert({
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
  }, [fireAlert]);

  // ── Unified GPS handler ────────────────────────────────────────────────
  const handleGps = useCallback((
    pos: { lat: number; lng: number },
    gpsHeading: number | undefined,
    r: RouteDetail | null,
    currIdx: number,
  ) => {
    setDriverPos(pos);
    if (r) checkProximity(pos, r, currIdx);

    let heading = gpsHeading;
    if (heading == null && prevPosRef.current) {
      const moved = haversine(prevPosRef.current, pos);
      if (moved > 3) {
        heading = compassBearing(prevPosRef.current, pos);
      }
    }
    if (heading != null && Number.isFinite(heading)) {
      lastHeadingRef.current = heading;
      setDriverHeading(heading);
    }
    prevPosRef.current = pos;

    const now = Date.now();
    if (id && now - lastPingRef.current > 5000) {
      lastPingRef.current = now;
      void api.routes.gps(id, {
        lat: pos.lat,
        lng: pos.lng,
        heading: lastHeadingRef.current ?? undefined,
      });
    }
  }, [id, checkProximity]);

  // ── Initial load + socket ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;

    api.routes.get(id)
      .then((r) => {
        setRoute(r);
        if (r.status === "complete") setRouteComplete(true);
        const next = r.stops.findIndex((s) => s.status === "pending");
        setActiveIdx(next >= 0 ? next : 0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    joinRoute(id);
    const offStop = onStopCompleted(async () => {
      await refreshRoute();
      firedZonesRef.current = new Set();
    });
    const offComplete = onRouteComplete(() => { setRouteComplete(true); void refreshRoute(); });

    return () => {
      leaveRoute(id);
      offStop(); offComplete();
      if (demoRef.current) clearInterval(demoRef.current);
    };
  }, [id, refreshRoute]);

  // Real GPS — paused during demo so simulated path is not overwritten
  useEffect(() => {
    if (!id || demoMode || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rawHeading = pos.coords.heading;
        const heading = rawHeading != null && Number.isFinite(rawHeading) ? rawHeading : undefined;
        handleGps(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          heading,
          routeRef.current,
          activeIdxRef.current,
        );
      },
      () => { /* permission denied — user can use Demo Mode */ },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );

    return () => { navigator.geolocation.clearWatch(watchId); };
  }, [id, demoMode, handleGps]);

  useEffect(() => {
    if (!demoMode) {
      lastDemoLegRef.current = null;
      demoProgressRef.current = 0;
    }
  }, [demoMode]);

  // ── Demo mode — simulates travel along the active leg only ───────────
  useEffect(() => {
    if (demoRef.current) { clearInterval(demoRef.current); demoRef.current = null; }
    if (!demoMode || !route) return;

    const activeStop = route.stops[activeIdx];
    if (!activeStop || activeStop.status === "complete") return;

    const legGeo = activeStop.geometry ?? [];
    if (legGeo.length === 0) return;

    const legKey = activeStop.id;
    if (lastDemoLegRef.current !== legKey) {
      lastDemoLegRef.current = legKey;
      demoProgressRef.current = 0;
      prevPosRef.current = null;
    }

    let elapsedSec = demoProgressRef.current * demoLegDurationSec(activeStop, legGeo);
    const durationSec = demoLegDurationSec(activeStop, legGeo);

    const tick = (r: RouteDetail, idx: number) => {
      const pos = interpolatePath(legGeo, demoProgressRef.current);
      handleGps(pos, headingFromPath(legGeo, demoProgressRef.current), r, idx);
      void processDemoStopActions(pos, r, idx, demoProgressRef.current >= 1);
    };

    tick(route, activeIdx);

    demoRef.current = setInterval(() => {
      const r = routeRef.current;
      const idx = activeIdxRef.current;
      if (!r) return;

      const stop = r.stops[idx];
      if (!stop || stop.status === "complete") {
        clearInterval(demoRef.current!);
        demoRef.current = null;
        return;
      }

      elapsedSec += (DEMO_TICK_MS / 1000) * demoSpeedRef.current;
      demoProgressRef.current = Math.min(elapsedSec / durationSec, 1);
      tick(r, idx);
    }, DEMO_TICK_MS);

    return () => { if (demoRef.current) { clearInterval(demoRef.current); demoRef.current = null; } };
  }, [demoMode, route, activeIdx, handleGps, processDemoStopActions]);

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
  const visibleAlerts = activeStop
    ? filterFutureNearbyAlerts(activeStop.alerts, activeStop.sequenceNumber, route.stops)
    : [];

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
          onClick={() => {
            setDemoMode((v) => {
              if (v) setDemoSpeed(1);
              return !v;
            });
          }}
          style={{
            background: demoMode ? "#da291c" : "rgba(255,255,255,.15)",
            color: "#fff", border: "none", borderRadius: 6,
            padding: ".35rem .75rem", fontWeight: 700, fontSize: ".8rem",
            cursor: "pointer", flexShrink: 0, minHeight: 36,
          }}
        >
          {demoMode ? "Stop" : "Demo"}
        </button>
        {demoMode && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {DEMO_SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => setDemoSpeed(speed)}
                style={{
                  background: demoSpeed === speed ? "#fff" : "rgba(255,255,255,.12)",
                  color: demoSpeed === speed ? "#004b87" : "#fff",
                  border: "none", borderRadius: 6,
                  padding: ".35rem .55rem", fontWeight: 800, fontSize: ".72rem",
                  cursor: "pointer", minHeight: 36, minWidth: 36,
                }}
              >
                {speed}×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Map (fills all remaining space above bottom card) ───────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <DeliveryMap
          stops={route.stops}
          driverPosition={driverPos}
          driverHeading={driverHeading}
          activeStopId={activeStop?.id}
          clusterMeters={route.clusterMeters}
          followDriver
          mapThemeId={themeId}
          style={{ width: "100%", height: "100%" }}
        />
        <MapThemeSelector
          themeId={themeId}
          onChange={setThemeId}
          variant="overlay"
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

          {/* Alerts (compact inline) — future stops only */}
          {visibleAlerts.length > 0 && (
            <div style={{ color: "#fbbf24", fontSize: "clamp(.72rem, 2.8vw, .85rem)", display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
              {visibleAlerts.map((a, i) => <span key={i}>⚠ {a}</span>)}
            </div>
          )}

          {/* Upcoming next stop preview */}
          {nextStop && (
            <div style={{ color: "#475569", fontSize: "clamp(.7rem, 2.5vw, .8rem)", borderTop: "1px solid #1e293b", paddingTop: ".4rem" }}>
              Next: #{nextStop.sequenceNumber} · {nextStop.packages[0]?.address ?? "?"}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: ".75rem", marginTop: ".25rem", flexWrap: "wrap", alignItems: "center" }}>
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

          {/* External navigation */}
          {activeStop.packages[0] && (
            <div style={{ marginTop: ".35rem" }}>
              <div style={{ color: "#64748b", fontSize: ".72rem", marginBottom: ".3rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
                Navigate
              </div>
              <NavigateButtons
                target={{
                  lat: activeStop.centroid.lat,
                  lng: activeStop.centroid.lng,
                  address: `${activeStop.packages[0].address}, ${activeStop.packages[0].city}, ${activeStop.packages[0].state} ${activeStop.packages[0].zip}`,
                }}
                size="sm"
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ flexShrink: 0, background: "#0f172a", borderTop: "2px solid #1e3a5f", padding: "1.5rem", textAlign: "center" }}>
          <div style={{ color: "#4ade80", fontWeight: 900, fontSize: "1.4rem" }}>All stops complete! 🎉</div>
        </div>
      )}
    </div>
  );
}
