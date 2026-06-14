import { clusterStops } from "./clusterer.js";
import { buildDurationMatrix, fetchLegMetrics } from "./matrixBuilder.js";
import { optimizeRoute } from "./routeOptimizer.js";
import { generateAlerts } from "./alertGenerator.js";
import {
  Cluster,
  GeocodedStop,
  LatLng,
  LegMetrics,
  PackageRow,
  RouteRow,
} from "../types/index.js";

const METERS_PER_MILE = 1609.344;

export interface PlannedStop {
  sequenceNumber: number;
  clusterId: string;
  centroid: LatLng;
  driveSecondsFromPrev: number;
  driveMilesFromPrev: number;
  alerts: string[];
  geometry: [number, number][] | null;
  packageIds: string[];
}

export interface RoutePlanResult {
  depot: LatLng;
  stops: PlannedStop[];
}

function packagesToGeocodedStops(packages: PackageRow[]): GeocodedStop[] {
  return packages.map((p) => ({
    address: `${p.address}, ${p.city}, ${p.state} ${p.zip}`,
    packageCount: p.package_count,
    lat: p.lat,
    lng: p.lng,
  }));
}

function matchPackagesToCluster(
  cluster: Cluster,
  packages: PackageRow[]
): PackageRow[] {
  const matched = new Set<string>();
  for (const stop of cluster.stops) {
    const addrPrefix = stop.address.split(",")[0].toLowerCase().trim();
    for (const p of packages) {
      if (matched.has(p.id)) continue;
      const full = `${p.address}, ${p.city}, ${p.state} ${p.zip}`.toLowerCase();
      if (
        p.address.toLowerCase().trim() === addrPrefix ||
        full.includes(addrPrefix)
      ) {
        matched.add(p.id);
      }
    }
  }
  return packages.filter((p) => matched.has(p.id));
}

/**
 * Resolve depot coordinates, geocoding the start address when needed.
 */
export async function resolveDepot(route: RouteRow): Promise<LatLng> {
  if (route.start_lat && route.start_lng) {
    return { lat: route.start_lat, lng: route.start_lng };
  }
  const { resolveAddressCoords } = await import("./geocoder.js");
  const { lat, lng, source } = await resolveAddressCoords(route.start_address);
  console.log(`[route] Geocoded depot via ${source}: ${route.start_address}`);
  return { lat, lng };
}

/**
 * Compute an optimized stop sequence from packages without persisting to DB.
 */
export async function planRouteFromPackages(
  route: RouteRow,
  packages: PackageRow[]
): Promise<RoutePlanResult> {
  const valid = packages.filter((p) => p.lat !== 0 && p.lng !== 0);
  if (valid.length === 0) {
    throw new Error("No packages with valid coordinates.");
  }

  const osrmBaseUrl = process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org";
  const depot = await resolveDepot(route);
  const geocodedStops = packagesToGeocodedStops(valid);
  const clusters = clusterStops(geocodedStops, route.cluster_meters);
  const durationMatrix = await buildDurationMatrix(depot, clusters, osrmBaseUrl);
  const orderedIndices = optimizeRoute(durationMatrix);
  const orderedClusters = orderedIndices.map((i) => clusters[i]);

  const legMetrics = await Promise.all(
    orderedClusters.map(async (cluster, stepIdx) => {
      const from = stepIdx === 0 ? depot : orderedClusters[stepIdx - 1].centroid;
      return fetchLegMetrics(from, cluster.centroid, osrmBaseUrl);
    })
  );

  const alertsPerCluster = generateAlerts(orderedClusters, route.alert_meters);

  const stops: PlannedStop[] = orderedClusters.map((cluster, i) => {
    const metrics: LegMetrics = legMetrics[i];
    const matched = matchPackagesToCluster(cluster, valid);
    return {
      sequenceNumber: i + 1,
      clusterId: cluster.clusterId,
      centroid: cluster.centroid,
      driveSecondsFromPrev: Math.round(metrics.durationSeconds),
      driveMilesFromPrev:
        Math.round((metrics.distanceMeters / METERS_PER_MILE) * 100) / 100,
      alerts: alertsPerCluster[i],
      geometry: metrics.geometry ?? null,
      packageIds: matched.map((p) => p.id),
    };
  });

  return { depot, stops };
}
