import { fetchLegMetricsWithFallback } from "./matrixBuilder.js";
import { planRouteFromPackages, PlannedStop } from "./routePlanner.js";
import { PackageRow, RouteRow, LatLng, RouteProposal, RouteProposalStop } from "../types/index.js";
import { SUNDAY_DEFAULTS } from "../config/sundayDefaults.js";
import { packageIsRoutable } from "./packageMappers.js";

const METERS_PER_MILE = 1609.344;

export interface ProposeRoutesOptions {
  startAddress: string;
  startLat?: number | null;
  startLng?: number | null;
  clusterMeters?: number;
  alertMeters?: number;
  /** Split the optimized sequence into this many routes (one per available driver). */
  driverCount: number;
  maxPackagesPerRoute?: number;
  maxStopsPerRoute?: number;
  maxRouteDurationMinutes?: number;
  sundayMode?: boolean;
  dwellSecondsPerStop?: number;
}

function buildSyntheticRoute(
  manifestId: string,
  options: ProposeRoutesOptions
): RouteRow {
  return {
    id: "preview",
    manifest_id: manifestId,
    route_number: null,
    driver_name: "",
    vehicle_id: null,
    status: "loading",
    start_address: options.startAddress.trim(),
    start_lat: options.startLat ?? null,
    start_lng: options.startLng ?? null,
    cluster_meters: options.clusterMeters ?? 50,
    alert_meters: options.alertMeters ?? 120,
    return_drive_seconds: 0,
    return_drive_miles: 0,
    created_at: new Date().toISOString(),
    optimized_at: null,
    completed_at: null,
  };
}

function splitStopsByDriverCount(stops: PlannedStop[], driverCount: number): PlannedStop[][] {
  if (stops.length === 0) return [];

  const routeCount = Math.max(1, Math.min(Math.floor(driverCount), stops.length));
  if (routeCount === 1) return [stops];

  const chunks: PlannedStop[][] = [];
  const baseSize = Math.floor(stops.length / routeCount);
  const remainder = stops.length % routeCount;

  let idx = 0;
  for (let route = 0; route < routeCount; route++) {
    const size = baseSize + (route < remainder ? 1 : 0);
    chunks.push(stops.slice(idx, idx + size));
    idx += size;
  }

  return chunks;
}

function splitStopsIntoChunks(
  stops: PlannedStop[],
  maxPackages: number,
  maxStops: number
): PlannedStop[][] {
  const chunks: PlannedStop[][] = [];
  let current: PlannedStop[] = [];
  let currentPackages = 0;

  for (const stop of stops) {
    const stopPackages = stop.packageIds.length;
    const wouldExceedPackages =
      current.length > 0 && currentPackages + stopPackages > maxPackages;
    const wouldExceedStops = current.length >= maxStops;

    if (wouldExceedPackages || wouldExceedStops) {
      chunks.push(current);
      current = [];
      currentPackages = 0;
    }

    current.push(stop);
    currentPackages += stopPackages;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

async function buildChunkStops(
  stops: PlannedStop[],
  depot: LatLng,
  osrmBaseUrl: string
): Promise<RouteProposalStop[]> {
  const metrics = await Promise.all(
    stops.map((stop, i) => {
      const from = i === 0 ? depot : stops[i - 1].centroid;
      return fetchLegMetricsWithFallback(from, stop.centroid, osrmBaseUrl);
    })
  );

  return stops.map((stop, i) => ({
    sequenceNumber: i + 1,
    clusterId: stop.clusterId,
    centroid: stop.centroid,
    driveSecondsFromPrev: Math.round(metrics[i].durationSeconds),
    driveMilesFromPrev:
      Math.round((metrics[i].distanceMeters / METERS_PER_MILE) * 100) / 100,
    alerts: stop.alerts,
    packageIds: stop.packageIds,
    geometry: metrics[i].geometry ?? null,
  }));
}

async function buildProposal(
  index: number,
  stops: PlannedStop[],
  depot: LatLng,
  osrmBaseUrl: string,
  limits: {
    maxPackages: number;
    maxStops: number;
    maxDurationMinutes: number;
    dwellSecondsPerStop: number;
  }
): Promise<RouteProposal> {
  const chunkStops = await buildChunkStops(stops, depot, osrmBaseUrl);
  const packageIds = [...new Set(chunkStops.flatMap((s) => s.packageIds))];
  const driveSeconds = chunkStops.reduce((sum, s) => sum + s.driveSecondsFromPrev, 0);
  const driveMiles = chunkStops.reduce((sum, s) => sum + s.driveMilesFromPrev, 0);

  const lastStop = chunkStops[chunkStops.length - 1];
  let returnDriveSeconds = 0;
  let returnDriveMiles = 0;
  let returnGeometry: [number, number][] | null = null;

  if (lastStop) {
    const returnLeg = await fetchLegMetricsWithFallback(lastStop.centroid, depot, osrmBaseUrl);
    returnDriveSeconds = Math.round(returnLeg.durationSeconds);
    returnDriveMiles =
      Math.round((returnLeg.distanceMeters / METERS_PER_MILE) * 100) / 100;
    returnGeometry = returnLeg.geometry ?? null;
  }

  const totalDriveSeconds = driveSeconds + returnDriveSeconds;
  const dwellSeconds = chunkStops.length * limits.dwellSecondsPerStop;
  const estimatedDurationMinutes = Math.round((totalDriveSeconds + dwellSeconds) / 60);

  const capacityPercent = Math.max(
    (packageIds.length / limits.maxPackages) * 100,
    (chunkStops.length / limits.maxStops) * 100
  );

  const infeasibilityReasons: string[] = [];
  if (packageIds.length > limits.maxPackages) {
    infeasibilityReasons.push(`Exceeds package cap (${packageIds.length}/${limits.maxPackages})`);
  }
  if (chunkStops.length > limits.maxStops) {
    infeasibilityReasons.push(`Exceeds stop cap (${chunkStops.length}/${limits.maxStops})`);
  }
  if (estimatedDurationMinutes > limits.maxDurationMinutes) {
    infeasibilityReasons.push(
      `Exceeds duration cap (${estimatedDurationMinutes}/${limits.maxDurationMinutes} min)`
    );
  }

  return {
    proposalId: `proposal_${index + 1}`,
    label: `Driver ${index + 1}`,
    stopCount: chunkStops.length,
    packageCount: packageIds.length,
    estimatedDriveSeconds: driveSeconds,
    estimatedDriveMiles: Math.round(driveMiles * 100) / 100,
    estimatedDurationMinutes,
    returnDriveSeconds,
    returnDriveMiles,
    returnGeometry,
    capacityPercent: Math.round(capacityPercent),
    durationFeasible: infeasibilityReasons.length === 0,
    infeasibilityReasons,
    stops: chunkStops,
    packageIds,
  };
}

export async function proposeRoutesForManifest(
  manifestId: string,
  packages: PackageRow[],
  options: ProposeRoutesOptions
): Promise<{
  start: { address: string; lat: number; lng: number };
  settings: {
    clusterMeters: number;
    effectiveClusterMeters: number;
    matrixSource: "osrm" | "haversine";
    alertMeters: number;
    driverCount: number;
    maxPackagesPerRoute: number;
    maxStopsPerRoute: number;
    maxRouteDurationMinutes: number;
    sundayMode: boolean;
  };
  summary: {
    totalPackages: number;
    totalStops: number;
    proposalCount: number;
    unassignedPackages: number;
    alreadyAssignedPackages: number;
    heldPackages: number;
    idleDrivers: number;
  };
  proposals: RouteProposal[];
}> {
  const heldCount = packages.filter((p) => !packageIsRoutable(p)).length;
  const valid = packages.filter((p) => packageIsRoutable(p));
  if (valid.length === 0) {
    throw new Error("No routable packages on this manifest. Resolve held rows first.");
  }

  const alreadyAssigned = valid.filter((p) => p.assigned_route_id).length;
  const planPackages = valid.filter((p) => !p.assigned_route_id);
  if (planPackages.length === 0) {
    throw new Error("All routable packages on this manifest are already assigned to routes.");
  }

  const sundayMode = options.sundayMode !== false;
  const maxPackages = options.maxPackagesPerRoute ?? SUNDAY_DEFAULTS.maxPackagesPerRoute;
  const maxStops = options.maxStopsPerRoute ?? SUNDAY_DEFAULTS.maxStopsPerRoute;
  const maxDurationMinutes = options.maxRouteDurationMinutes ?? SUNDAY_DEFAULTS.maxRouteDurationMinutes;
  const dwellSecondsPerStop = options.dwellSecondsPerStop ?? SUNDAY_DEFAULTS.dwellSecondsPerStop;

  const syntheticRoute = buildSyntheticRoute(manifestId, options);
  const osrmBaseUrl = process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org";

  if (!syntheticRoute.start_lat || !syntheticRoute.start_lng) {
    const { resolveAddressCoords } = await import("./geocoder.js");
    const coords = await resolveAddressCoords(syntheticRoute.start_address);
    syntheticRoute.start_lat = coords.lat;
    syntheticRoute.start_lng = coords.lng;
  }

  const plan = await planRouteFromPackages(syntheticRoute, planPackages);

  const driverCount = Math.max(1, Math.min(Math.floor(options.driverCount), 50));

  let chunks = splitStopsByDriverCount(plan.stops, driverCount);

  // Sunday mode always enforces capacity caps
  if (sundayMode || options.maxPackagesPerRoute !== undefined || options.maxStopsPerRoute !== undefined) {
    chunks = chunks.flatMap((chunk) => splitStopsIntoChunks(chunk, maxPackages, maxStops));
  }

  const limits = { maxPackages, maxStops, maxDurationMinutes, dwellSecondsPerStop };
  const proposals = await Promise.all(
    chunks.map((chunk, idx) => buildProposal(idx, chunk, plan.depot, osrmBaseUrl, limits))
  );

  const unassignedFromCaps = Math.max(0, planPackages.length - proposals.reduce((s, p) => s + p.packageCount, 0));
  const idleDrivers = Math.max(0, driverCount - proposals.length);

  return {
    start: {
      address: syntheticRoute.start_address,
      lat: syntheticRoute.start_lat!,
      lng: syntheticRoute.start_lng!,
    },
    settings: {
      clusterMeters: syntheticRoute.cluster_meters,
      effectiveClusterMeters: plan.effectiveClusterMeters,
      matrixSource: plan.matrixSource,
      alertMeters: syntheticRoute.alert_meters,
      driverCount,
      maxPackagesPerRoute: maxPackages,
      maxStopsPerRoute: maxStops,
      maxRouteDurationMinutes: maxDurationMinutes,
      sundayMode,
    },
    summary: {
      totalPackages: planPackages.length,
      totalStops: plan.stops.length,
      proposalCount: proposals.length,
      unassignedPackages: unassignedFromCaps,
      alreadyAssignedPackages: alreadyAssigned,
      heldPackages: heldCount,
      idleDrivers,
    },
    proposals,
  };
}
