import axios from "axios";
import { Cluster, LatLng, LegMetrics } from "../types/index.js";

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
  });

  if (response.data.code !== "Ok") {
    throw new Error(`OSRM table request failed: ${response.data.code}`);
  }

  return response.data.durations;
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
  });

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
