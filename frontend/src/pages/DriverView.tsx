import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { api, type RouteDetail, type RouteStopDetail } from "../api";
import { DeliveryMap } from "../components/DeliveryMap";
import { MapThemeSelector } from "../components/MapThemeSelector";
import { ThemeSelector } from "../components/ThemeSelector";
import { AlertBanner, BlockingAlertOverlay, type ActiveAlert, type BlockingAlert } from "../components/AlertBanner";
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

function isValidPos(pos: { lat: number; lng: number }): boolean {
  return Number.isFinite(pos.lat) && Number.isFinite(pos.lng)
    && Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180;
}

// ── Demo path interpolation ───────────────────────────────────────────────
function interpolatePath(geo: [number, number][], t: number): { lat: number; lng: number } | null {
  if (geo.length === 0) return null;
  if (geo.length === 1) return { lat: geo[0][1], lng: geo[0][0] };
  const dists = [0];
  for (let i = 1; i < geo.length; i++) {
    const dx = geo[i][0] - geo[i - 1][0], dy = geo[i][1] - geo[i - 1][1];
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = dists[dists.length - 1];
  if (total === 0) return { lat: geo[0][1], lng: geo[0][0] };
  const target = t * total;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= target) {
      const segLen = dists[i] - dists[i - 1];
      if (segLen === 0) return { lat: geo[i][1], lng: geo[i][0] };
      const f = (target - dists[i - 1]) / segLen;
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

type RouteState = "IDLE" | "EN_ROUTE" | "ARRIVED_BLOCKED" | "SERVICING_CLUSTER";
const SNOOZE_MS = 2 * 60 * 1000;

function isStopAvailable(
  stop: RouteStopDetail,
  completed: Set<string>,
  skipped: Set<string>,
): boolean {
  return stop.status !== "complete" && !completed.has(stop.clusterId) && !skipped.has(stop.clusterId);
}

function findNextStopIndex(
  r: RouteDetail,
  completed: Set<string>,
  skipped: Set<string>,
): number {
  return r.stops.findIndex((s) => isStopAvailable(s, completed, skipped));
}

function findStopByClusterId(r: RouteDetail, clusterId: string): RouteStopDetail | undefined {
  return r.stops.find((s) => s.clusterId === clusterId);
}

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
  if (!from || !to) return 0;
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
  const [routeState, setRouteState] = useState<RouteState>("IDLE");
  const [blockingAlert, setBlockingAlert] = useState<BlockingAlert | null>(null);
  const [lockedClusterId, setLockedClusterId] = useState<string | null>(null);
  const [completedClusterIds, setCompletedClusterIds] = useState<Set<string>>(() => new Set());
  const [skippedClusterIds, setSkippedClusterIds] = useState<Set<string>>(() => new Set());

  const [demoMode, setDemoMode] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState<DemoSpeed>(1);
  const demoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoProgressRef = useRef(0);
  const demoSpeedRef = useRef<DemoSpeed>(1);
  const lastDemoLegRef = useRef<string | null>(null);
  demoSpeedRef.current = demoSpeed;
  const routeRef = useRef<RouteDetail | null>(null);
  const activeIdxRef = useRef(0);
  const routeStateRef = useRef<RouteState>("IDLE");
  const blockingAlertRef = useRef<BlockingAlert | null>(null);
  const lockedClusterIdRef = useRef<string | null>(null);
  const completedClusterIdsRef = useRef<Set<string>>(new Set());
  const skippedClusterIdsRef = useRef<Set<string>>(new Set());
  const snoozeUntilRef = useRef(0);
  routeRef.current = route;
  activeIdxRef.current = activeIdx;
  routeStateRef.current = routeState;
  blockingAlertRef.current = blockingAlert;
  lockedClusterIdRef.current = lockedClusterId;
  completedClusterIdsRef.current = completedClusterIds;
  skippedClusterIdsRef.current = skippedClusterIds;

  // Track which alert zones have already fired (keyed by `${stopId}:${zone}`)
  const firedZonesRef = useRef<Set<string>>(new Set());

  // GPS ping throttle — only POST to server every 5 seconds
  const lastPingRef = useRef(0);

  const refreshRoute = useCallback(async () => {
    if (!id) return;
    const r = await api.routes.get(id);
    routeRef.current = r;
    setRoute(r);
    if (!lockedClusterIdRef.current) {
      const next = findNextStopIndex(r, completedClusterIdsRef.current, skippedClusterIdsRef.current);
      if (next >= 0) {
        activeIdxRef.current = next;
        setActiveIdx(next);
        routeStateRef.current = "EN_ROUTE";
        setRouteState("EN_ROUTE");
      } else {
        routeStateRef.current = "IDLE";
        setRouteState("IDLE");
      }
    }
    if (r.status === "complete") setRouteComplete(true);
  }, [id]);

  const loadRoute = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.routes.get(id);
      routeRef.current = r;
      setRoute(r);
      if (r.status === "complete") setRouteComplete(true);
      const next = findNextStopIndex(r, completedClusterIdsRef.current, skippedClusterIdsRef.current);
      activeIdxRef.current = next >= 0 ? next : 0;
      setActiveIdx(next >= 0 ? next : 0);
      routeStateRef.current = next >= 0 ? "EN_ROUTE" : "IDLE";
      setRouteState(next >= 0 ? "EN_ROUTE" : "IDLE");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fireAlert = useCallback((alert: ActiveAlert) => {
    if (blockingAlertRef.current) return;
    setActiveAlert(alert);
    notifyProximityAlert(alert);
  }, []);

  const fireBlockingAlert = useCallback((stop: RouteStopDetail) => {
    const alert: BlockingAlert = {
      id: uuidv4(),
      clusterId: stop.clusterId,
      level: "arriving",
      lines: [
        `Stop #${stop.sequenceNumber}`,
        stop.packages[0]?.address ?? "Unknown address",
        `${stop.packages.reduce((s, p) => s + p.packageCount, 0)} package(s)`,
      ],
    };
    blockingAlertRef.current = alert;
    setBlockingAlert(alert);
    notifyProximityAlert({ id: alert.id, level: "arriving", lines: alert.lines });
  }, []);

  const clearClusterLock = useCallback(() => {
    lockedClusterIdRef.current = null;
    setLockedClusterId(null);
    blockingAlertRef.current = null;
    setBlockingAlert(null);
    snoozeUntilRef.current = 0;
  }, []);

  const advanceToNextCluster = useCallback((r: RouteDetail) => {
    clearClusterLock();
    firedZonesRef.current = new Set();
    const next = findNextStopIndex(r, completedClusterIdsRef.current, skippedClusterIdsRef.current);
    if (next >= 0) {
      activeIdxRef.current = next;
      setActiveIdx(next);
      routeStateRef.current = "EN_ROUTE";
      setRouteState("EN_ROUTE");
      demoProgressRef.current = 0;
      lastDemoLegRef.current = null;
    } else {
      routeStateRef.current = "IDLE";
      setRouteState("IDLE");
    }
  }, [clearClusterLock]);

  const lockCluster = useCallback((stop: RouteStopDetail) => {
    if (lockedClusterIdRef.current === stop.clusterId && blockingAlertRef.current) return;

    lockedClusterIdRef.current = stop.clusterId;
    setLockedClusterId(stop.clusterId);
    const idx = routeRef.current?.stops.findIndex((s) => s.id === stop.id) ?? -1;
    if (idx >= 0) {
      activeIdxRef.current = idx;
      setActiveIdx(idx);
    }
    routeStateRef.current = "ARRIVED_BLOCKED";
    setRouteState("ARRIVED_BLOCKED");
    fireBlockingAlert(stop);
  }, [fireBlockingAlert]);

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

  // ── Proximity engine ────────────────────────────────────────────────────
  const checkProximity = useCallback((pos: { lat: number; lng: number }, r: RouteDetail, currentIdx: number) => {
    const locked = lockedClusterIdRef.current;
    const state = routeStateRef.current;
    const blocking = blockingAlertRef.current;
    const completed = completedClusterIdsRef.current;
    const skipped = skippedClusterIdsRef.current;

    if (locked) {
      const lockedStop = findStopByClusterId(r, locked);
      if (!lockedStop) return;

      const dist = haversine(pos, lockedStop.centroid);

      if (
        dist > ZONE_ARRIVING
        && isStopAvailable(lockedStop, completed, skipped)
        && !firedZonesRef.current.has(`${locked}:departing`)
      ) {
        firedZonesRef.current.add(`${locked}:departing`);
        fireAlert({
          id: uuidv4(),
          level: "warning",
          lines: [
            "You are leaving an unfinished package cluster.",
            lockedStop.packages[0]?.address ?? "Unknown address",
          ],
        });
      } else if (dist <= ZONE_ARRIVING) {
        firedZonesRef.current.delete(`${locked}:departing`);
      }

      if (
        !blocking
        && state === "SERVICING_CLUSTER"
        && snoozeUntilRef.current > 0
        && Date.now() >= snoozeUntilRef.current
        && dist <= ZONE_ARRIVING
        && isStopAvailable(lockedStop, completed, skipped)
      ) {
        snoozeUntilRef.current = 0;
        routeStateRef.current = "ARRIVED_BLOCKED";
        setRouteState("ARRIVED_BLOCKED");
        fireBlockingAlert(lockedStop);
      }
      return;
    }

    if (blocking) return;

    const pendingStops = r.stops.filter((s) => isStopAvailable(s, completed, skipped));
    const currentStop = r.stops[currentIdx] ?? pendingStops[0];
    if (!currentStop || !isStopAvailable(currentStop, completed, skipped)) return;

    const dist = haversine(pos, currentStop.centroid);
    const sid = currentStop.id;

    if (dist <= ZONE_ARRIVING && state === "EN_ROUTE") {
      lockCluster(currentStop);
      return;
    }

    if (state !== "EN_ROUTE") return;

    if (dist < ZONE_ALERT && !firedZonesRef.current.has(`${sid}:alert`)) {
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

    const alertMeters = r.alertMeters;
    for (const stop of pendingStops) {
      if (stop === currentStop) continue;
      if (currentStop && stop.sequenceNumber <= currentStop.sequenceNumber) continue;
      const nearbyDist = haversine(pos, stop.centroid);
      if (nearbyDist < alertMeters && !firedZonesRef.current.has(`${stop.id}:nearby`)) {
        firedZonesRef.current.add(`${stop.id}:nearby`);
        fireAlert({
          id: uuidv4(),
          level: "nearby",
          lines: [
            `${fmtDist(nearbyDist)} away · Stop #${stop.sequenceNumber}`,
            stop.packages[0]?.address ?? "Unknown address",
            `${stop.packages.reduce((s, p) => s + p.packageCount, 0)} pkg(s) — consider delivering now`,
          ],
        });
        break;
      }
    }
  }, [fireAlert, fireBlockingAlert, lockCluster]);

  // ── Unified GPS handler ────────────────────────────────────────────────
  const handleGps = useCallback((
    pos: { lat: number; lng: number },
    gpsHeading: number | undefined,
    r: RouteDetail | null,
    currIdx: number,
  ) => {
    if (!isValidPos(pos)) return;

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
      }).catch(() => { /* non-critical telemetry */ });
    }
  }, [id, checkProximity]);

  // ── Initial load + socket ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;

    void loadRoute();

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
  }, [id, loadRoute, refreshRoute]);

  // Real GPS — paused during demo so simulated path is not overwritten
  useEffect(() => {
    if (!id || demoMode || !navigator.geolocation) return;

    let watchId: number | null = null;
    let cancelled = false;

    const onPosition = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const rawHeading = pos.coords.heading;
      const heading = rawHeading != null && Number.isFinite(rawHeading) ? rawHeading : undefined;
      handleGps(
        { lat: latitude, lng: longitude },
        heading,
        routeRef.current,
        activeIdxRef.current,
      );
    };

    const startWatch = () => {
      if (watchId != null || cancelled) return;
      watchId = navigator.geolocation.watchPosition(
        onPosition,
        () => { /* permission denied — use Demo Mode */ },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
      );
    };

    if ("permissions" in navigator) {
      void navigator.permissions.query({ name: "geolocation" }).then((status) => {
        if (cancelled) return;
        if (status.state === "granted") startWatch();
        status.onchange = () => {
          if (status.state === "granted") startWatch();
          else if (watchId != null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
          }
        };
      }).catch(() => startWatch());
    } else {
      startWatch();
    }

    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
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
      if (!pos) return;
      handleGps(pos, headingFromPath(legGeo, demoProgressRef.current), r, idx);
    };

    tick(route, activeIdx);

    demoRef.current = setInterval(() => {
      if (blockingAlertRef.current) return;

      const r = routeRef.current;
      const idx = activeIdxRef.current;
      if (!r) return;

      const stop = r.stops[idx];
      if (!stop || !isStopAvailable(stop, completedClusterIdsRef.current, skippedClusterIdsRef.current)) {
        clearInterval(demoRef.current!);
        demoRef.current = null;
        return;
      }

      elapsedSec += (DEMO_TICK_MS / 1000) * demoSpeedRef.current;
      demoProgressRef.current = Math.min(elapsedSec / durationSec, 1);
      tick(r, idx);
    }, DEMO_TICK_MS);

    return () => { if (demoRef.current) { clearInterval(demoRef.current); demoRef.current = null; } };
  }, [demoMode, route, activeIdx, handleGps]);

  // ── Stop actions ──────────────────────────────────────────────────────
  const handleBlockingAcknowledge = useCallback(async () => {
    if (!id || !route) return;
    const clusterId = lockedClusterIdRef.current;
    if (!clusterId) return;
    const stop = findStopByClusterId(route, clusterId);
    if (!stop) return;

    blockingAlertRef.current = null;
    setBlockingAlert(null);
    routeStateRef.current = "SERVICING_CLUSTER";
    setRouteState("SERVICING_CLUSTER");
    snoozeUntilRef.current = 0;

    if (stop.status === "pending") {
      await api.routes.stopArrive(id, stop.id);
      await refreshRoute();
    }
  }, [id, route, refreshRoute]);

  const handleBlockingComplete = useCallback(async () => {
    if (!id || !route) return;
    const clusterId = lockedClusterIdRef.current;
    if (!clusterId) return;
    const stop = findStopByClusterId(route, clusterId);
    if (!stop) return;

    await api.routes.stopComplete(id, stop.id);
    const nextCompleted = new Set(completedClusterIdsRef.current);
    nextCompleted.add(clusterId);
    completedClusterIdsRef.current = nextCompleted;
    setCompletedClusterIds(nextCompleted);

    await refreshRoute();
    const r = routeRef.current ?? route;
    advanceToNextCluster(r);
  }, [id, route, refreshRoute, advanceToNextCluster]);

  const handleBlockingSkip = useCallback(() => {
    if (!route) return;
    const clusterId = lockedClusterIdRef.current;
    if (!clusterId) return;

    const nextSkipped = new Set(skippedClusterIdsRef.current);
    nextSkipped.add(clusterId);
    skippedClusterIdsRef.current = nextSkipped;
    setSkippedClusterIds(nextSkipped);

    advanceToNextCluster(route);
  }, [route, advanceToNextCluster]);

  const handleBlockingSnooze = useCallback(() => {
    blockingAlertRef.current = null;
    setBlockingAlert(null);
    routeStateRef.current = "SERVICING_CLUSTER";
    setRouteState("SERVICING_CLUSTER");
    snoozeUntilRef.current = Date.now() + SNOOZE_MS;
  }, []);

  const handleArrive = async (stop: RouteStopDetail) => {
    if (!id) return;
    await api.routes.stopArrive(id, stop.id);
    lockedClusterIdRef.current = stop.clusterId;
    setLockedClusterId(stop.clusterId);
    blockingAlertRef.current = null;
    setBlockingAlert(null);
    routeStateRef.current = "SERVICING_CLUSTER";
    setRouteState("SERVICING_CLUSTER");
    const idx = route?.stops.findIndex((s) => s.id === stop.id) ?? -1;
    if (idx >= 0) {
      activeIdxRef.current = idx;
      setActiveIdx(idx);
    }
    await refreshRoute();
  };

  const handleComplete = async (stop: RouteStopDetail) => {
    if (!id || !route) return;
    await api.routes.stopComplete(id, stop.id);
    const nextCompleted = new Set(completedClusterIdsRef.current);
    nextCompleted.add(stop.clusterId);
    completedClusterIdsRef.current = nextCompleted;
    setCompletedClusterIds(nextCompleted);
    await refreshRoute();
    const r = routeRef.current ?? route;
    advanceToNextCluster(r);
  };

  const handleSkip = (stop: RouteStopDetail) => {
    if (!route) return;
    const nextSkipped = new Set(skippedClusterIdsRef.current);
    nextSkipped.add(stop.clusterId);
    skippedClusterIdsRef.current = nextSkipped;
    setSkippedClusterIds(nextSkipped);
    advanceToNextCluster(route);
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
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#7f1d1d", flexDirection: "column", gap: "1rem", padding: "1.5rem", textAlign: "center" }}>
        <div style={{ color: "#fca5a5", fontSize: "1.1rem" }}>Error: {error}</div>
        <div style={{ color: "#fecaca", fontSize: ".9rem", maxWidth: 320 }}>
          If the server was still starting, retry below. For blocked location access, use Demo mode after the route loads.
        </div>
        <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn-primary" onClick={() => void loadRoute()}>Retry</button>
          <Link to="/"><button className="btn-primary">Back</button></Link>
        </div>
      </div>
    );
  }
  if (!route) return null;

  const lockedStop = lockedClusterId
    ? route.stops.find((s) => s.clusterId === lockedClusterId)
    : null;
  const activeStop = lockedStop
    ?? route.stops[activeIdx]
    ?? route.stops.find((s) => isStopAvailable(s, completedClusterIds, skippedClusterIds))
    ?? null;
  const pendingStops = route.stops.filter((s) => isStopAvailable(s, completedClusterIds, skippedClusterIds));
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

      {/* ── Non-blocking proximity alerts ───────────────────────────── */}
      <AlertBanner alert={activeAlert} onDismiss={() => setActiveAlert(null)} />

      {/* ── Blocking arrival alert — requires explicit action ─────────── */}
      <BlockingAlertOverlay
        alert={blockingAlert}
        onAcknowledge={() => void handleBlockingAcknowledge()}
        onComplete={() => void handleBlockingComplete()}
        onSkip={handleBlockingSkip}
        onSnooze={handleBlockingSnooze}
      />

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
        <ThemeSelector variant="overlay" />
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
            {activeStop.status === "pending" && routeState !== "ARRIVED_BLOCKED" && (
              <button
                className="btn-primary"
                style={{ flex: 1, minHeight: 52, fontSize: "clamp(.9rem, 3.5vw, 1.05rem)", fontWeight: 800 }}
                onClick={() => void handleArrive(activeStop)}
              >
                Arrived
              </button>
            )}
            {(activeStop.status === "arrived" || routeState === "SERVICING_CLUSTER") && (
              <button
                className="btn-success"
                style={{ flex: 2, minHeight: 56, fontSize: "clamp(1rem, 4vw, 1.2rem)", fontWeight: 900, letterSpacing: ".03em" }}
                onClick={() => void handleComplete(activeStop)}
              >
                ✓ Delivered
              </button>
            )}
            {pendingStops.length > 1 && routeState !== "ARRIVED_BLOCKED" && (
              <button
                className="btn-ghost"
                style={{ flex: 1, minHeight: 52, fontSize: "clamp(.85rem, 3vw, 1rem)", color: "#94a3b8", borderColor: "#334155" }}
                onClick={() => handleSkip(activeStop)}
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
