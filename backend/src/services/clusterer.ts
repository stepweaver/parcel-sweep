import { Cluster, GeocodedStop, LatLng } from "../types/index.js";

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Haversine formula — returns the great-circle distance in metres between
 * two GPS coordinates.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function computeCentroid(stops: GeocodedStop[]): LatLng {
  const lat = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
  const lng = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
  return { lat, lng };
}

/**
 * Greedy radius-based clustering.
 *
 * Algorithm:
 * 1. Iterate stops in input order.
 * 2. For each unassigned stop, try to find an existing cluster whose
 *    *current centroid* is within `clusterMeters`.
 * 3. If found, add the stop to the nearest such cluster and recompute
 *    its centroid.
 * 4. Otherwise, open a new cluster seeded by this stop.
 *
 * This produces compact geographic clusters without requiring a fixed
 * number of centres (unlike k-means) while being O(n²) — fast enough
 * for typical delivery manifests of a few hundred stops.
 */
export function clusterStops(
  stops: GeocodedStop[],
  clusterMeters: number
): Cluster[] {
  const clusters: Array<{ stops: GeocodedStop[]; centroid: LatLng }> = [];

  for (const stop of stops) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      const dist = haversineMeters(stop, clusters[i].centroid);
      if (dist <= clusterMeters && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      clusters[bestIdx].stops.push(stop);
      clusters[bestIdx].centroid = computeCentroid(clusters[bestIdx].stops);
    } else {
      clusters.push({ stops: [stop], centroid: { lat: stop.lat, lng: stop.lng } });
    }
  }

  return clusters.map((c, idx) => ({
    clusterId: `cluster_${idx + 1}`,
    centroid: c.centroid,
    stops: c.stops,
    totalPackages: c.stops.reduce((sum, s) => sum + s.packageCount, 0),
  }));
}

/** OSRM public table service accepts at most ~100 coordinates per request. */
export const MAX_ROUTE_CLUSTERS = 90;

/**
 * Cluster stops, automatically widening the radius until the cluster count
 * fits within OSRM (or caller) limits.
 */
export function clusterStopsWithLimit(
  stops: GeocodedStop[],
  clusterMeters: number,
  maxClusters: number = MAX_ROUTE_CLUSTERS
): { clusters: Cluster[]; effectiveClusterMeters: number } {
  let effective = clusterMeters;
  let clusters = clusterStops(stops, effective);

  while (clusters.length > maxClusters && effective < 8000) {
    effective = Math.min(Math.ceil(effective * 1.5), 8000);
    clusters = clusterStops(stops, effective);
  }

  if (clusters.length > maxClusters) {
    throw new Error(
      `Manifest has too many distinct stops (${clusters.length}) to optimize at once. ` +
        "Try fewer packages or split across more drivers."
    );
  }

  if (effective > clusterMeters) {
    console.log(
      `[route] Raised cluster radius ${clusterMeters}m → ${effective}m (${clusters.length} clusters)`
    );
  }

  return { clusters, effectiveClusterMeters: effective };
}
