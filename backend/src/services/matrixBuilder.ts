import axios from "axios";
import { haversineMeters } from "./clusterer.js";
import { Cluster, LatLng, LegMetrics } from "../types/index.js";

const AVG_DRIVE_MPH = 25;
const METERS_PER_MILE = 1609.344;

interface OsrmTableResponse {
  code: string;
  durations: number[][];
  distances?: number[][];
}

interface OsrmRouteResponse {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    geometry?: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
}

/**
 * Build the coordinate string expected by OSRM: "lng,lat;lng,lat;..."
 */
function toOsrmCoords(points: LatLng[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(";");
}

/**
 * Fetch a duration matrix from the OSRM Table service for all nodes
 * (depot + cluster centroids).
 *
 * Returns an NxN matrix where matrix[i][j] is the drive duration in seconds
 * from node i to node j.  Index 0 is always the depot (start address).
 */
export async function buildDurationMatrix(
  depot: LatLng,
  clusters: Cluster[],
  osrmBaseUrl: string
): Promise<number[][]> {
  const points: LatLng[] = [depot, ...clusters.map((c) => c.centroid)];
  const coords = toOsrmCoords(points);

  const url = `${osrmBaseUrl}/table/v1/driving/${coords}`;
  const response = await axios.get<OsrmTableResponse>(url, {
    params: { annotations: "duration" },
    timeout: 60_000,
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`OSRM table HTTP ${response.status} (${clusters.length} clusters)`);
  }

  if (response.data.code !== "Ok") {
    throw new Error(`OSRM table request failed: ${response.data.code}`);
  }

  return response.data.durations;
}

/** Estimate drive durations from straight-line distance at typical city speeds. */
export function buildHaversineDurationMatrix(
  depot: LatLng,
  clusters: Cluster[]
): number[][] {
  const points: LatLng[] = [depot, ...clusters.map((c) => c.centroid)];
  const n = points.length;
  const metersPerSecond = (AVG_DRIVE_MPH * METERS_PER_MILE) / 3600;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      matrix[i][j] = haversineMeters(points[i], points[j]) / metersPerSecond;
    }
  }

  return matrix;
}

export async function buildDurationMatrixWithFallback(
  depot: LatLng,
  clusters: Cluster[],
  osrmBaseUrl: string
): Promise<{ matrix: number[][]; source: "osrm" | "haversine" }> {
  try {
    const matrix = await buildDurationMatrix(depot, clusters, osrmBaseUrl);
    return { matrix, source: "osrm" };
  } catch (err) {
    console.warn(
      "[route] OSRM table unavailable, using haversine estimate:",
      err instanceof Error ? err.message : err
    );
    return { matrix: buildHaversineDurationMatrix(depot, clusters), source: "haversine" };
  }
}

/**
 * Fetch the actual driving distance and GeoJSON geometry between two points
 * using the OSRM Route service.
 */
export async function fetchLegMetrics(
  from: LatLng,
  to: LatLng,
  osrmBaseUrl: string
): Promise<LegMetrics> {
  const coords = toOsrmCoords([from, to]);
  const url = `${osrmBaseUrl}/route/v1/driving/${coords}`;

  const response = await axios.get<OsrmRouteResponse>(url, {
    params: { overview: "full", geometries: "geojson" },
    timeout: 30_000,
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`OSRM route HTTP ${response.status}`);
  }

  if (response.data.code !== "Ok" || response.data.routes.length === 0) {
    throw new Error(`OSRM route request failed: ${response.data.code}`);
  }

  const route = response.data.routes[0];
  return {
    durationSeconds: route.duration,
    distanceMeters: route.distance,
    geometry: route.geometry?.coordinates ?? undefined,
  };
}

export async function fetchLegMetricsWithFallback(
  from: LatLng,
  to: LatLng,
  osrmBaseUrl: string
): Promise<LegMetrics> {
  try {
    return await fetchLegMetrics(from, to, osrmBaseUrl);
  } catch (err) {
    const distanceMeters = haversineMeters(from, to);
    const durationSeconds = (distanceMeters / METERS_PER_MILE / AVG_DRIVE_MPH) * 3600;
    return { durationSeconds, distanceMeters };
  }
}
