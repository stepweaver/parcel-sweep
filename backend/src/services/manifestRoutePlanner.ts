import { fetchLegMetrics } from "./matrixBuilder.js";
import { planRouteFromPackages, PlannedStop } from "./routePlanner.js";
import { PackageRow, RouteRow, LatLng, RouteProposal, RouteProposalStop } from "../types/index.js";

const METERS_PER_MILE = 1609.344;
const DEFAULT_MAX_PACKAGES = 80;
const DEFAULT_MAX_STOPS = 40;

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

function resequenceStops(stops: PlannedStop[]): RouteProposalStop[] {
  return stops.map((stop, idx) => ({
    sequenceNumber: idx + 1,
    clusterId: stop.clusterId,
    centroid: stop.centroid,
    driveSecondsFromPrev: stop.driveSecondsFromPrev,
    driveMilesFromPrev: stop.driveMilesFromPrev,
    alerts: stop.alerts,
    packageIds: stop.packageIds,
  }));
}

async function buildProposal(
  index: number,
  stops: PlannedStop[],
  depot: LatLng,
  osrmBaseUrl: string
): Promise<RouteProposal> {
  const packageIds = stops.flatMap((s) => s.packageIds);
  const driveSeconds = stops.reduce((sum, s) => sum + s.driveSecondsFromPrev, 0);
  const driveMiles = stops.reduce((sum, s) => sum + s.driveMilesFromPrev, 0);

  const lastStop = stops[stops.length - 1];
  let returnDriveSeconds = 0;
  let returnDriveMiles = 0;

  if (lastStop) {
    const returnLeg = await fetchLegMetrics(lastStop.centroid, depot, osrmBaseUrl);
    returnDriveSeconds = Math.round(returnLeg.durationSeconds);
    returnDriveMiles =
      Math.round((returnLeg.distanceMeters / METERS_PER_MILE) * 100) / 100;
  }

  return {
    proposalId: `proposal_${index + 1}`,
    label: `Driver ${index + 1}`,
    stopCount: stops.length,
    packageCount: packageIds.length,
    estimatedDriveSeconds: driveSeconds,
    estimatedDriveMiles: Math.round(driveMiles * 100) / 100,
    returnDriveSeconds,
    returnDriveMiles,
    stops: resequenceStops(stops),
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
    alertMeters: number;
    driverCount: number;
    maxPackagesPerRoute: number;
    maxStopsPerRoute: number;
  };
  summary: {
    totalPackages: number;
    totalStops: number;
    proposalCount: number;
    unassignedPackages: number;
    alreadyAssignedPackages: number;
  };
  proposals: RouteProposal[];
}> {
  const valid = packages.filter((p) => p.lat !== 0 && p.lng !== 0 && p.is_ghost === 0);
  if (valid.length === 0) {
    throw new Error("No geocoded packages on this manifest to plan routes.");
  }

  const alreadyAssigned = valid.filter((p) => p.assigned_route_id).length;
  const planPackages = valid.filter((p) => !p.assigned_route_id);
  if (planPackages.length === 0) {
    throw new Error("All packages on this manifest are already assigned to routes.");
  }

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
  const maxPackages = options.maxPackagesPerRoute ?? DEFAULT_MAX_PACKAGES;
  const maxStops = options.maxStopsPerRoute ?? DEFAULT_MAX_STOPS;

  let chunks = splitStopsByDriverCount(plan.stops, driverCount);

  // Optional safety caps — may produce more routes than drivers if limits are exceeded
  if (options.maxPackagesPerRoute !== undefined || options.maxStopsPerRoute !== undefined) {
    chunks = chunks.flatMap((chunk) => splitStopsIntoChunks(chunk, maxPackages, maxStops));
  }

  const proposals = await Promise.all(
    chunks.map((chunk, idx) => buildProposal(idx, chunk, plan.depot, osrmBaseUrl))
  );

  return {
    start: {
      address: syntheticRoute.start_address,
      lat: syntheticRoute.start_lat!,
      lng: syntheticRoute.start_lng!,
    },
    settings: {
      clusterMeters: syntheticRoute.cluster_meters,
      alertMeters: syntheticRoute.alert_meters,
      driverCount,
      maxPackagesPerRoute: maxPackages,
      maxStopsPerRoute: maxStops,
    },
    summary: {
      totalPackages: planPackages.length,
      totalStops: plan.stops.length,
      proposalCount: proposals.length,
      unassignedPackages: planPackages.length,
      alreadyAssignedPackages: alreadyAssigned,
    },
    proposals,
  };
}
