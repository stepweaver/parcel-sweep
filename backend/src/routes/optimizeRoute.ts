import { Router, Request, Response, NextFunction } from "express";
import { geocodeStartAddress } from "../services/geocoder.js";
import { clusterStops } from "../services/clusterer.js";
import { buildDurationMatrix, fetchLegMetrics } from "../services/matrixBuilder.js";
import { optimizeRoute } from "../services/routeOptimizer.js";
import { generateAlerts } from "../services/alertGenerator.js";
import {
  GeocodedStop,
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  RouteStep,
} from "../types/index.js";
import {
  isValidStartCoords,
  validateVerifiedStopCoords,
} from "../services/quickRouteVerify.js";

const METERS_PER_MILE = 1609.344;
const DEFAULT_CLUSTER_METERS = 50;
const DEFAULT_ALERT_METERS = 120;

export const optimizeRouteRouter = Router();

export interface GeocodeStartFn {
  (address: string): Promise<GeocodedStop>;
}

export type PreparePointsResult =
  | { ok: true; start: GeocodedStop; stops: GeocodedStop[] }
  | { ok: false; status: number; error: string };

/**
 * Resolve start + stops for Quick Route.
 * Verified stops must already carry coordinates; they are never re-geocoded.
 */
export async function prepareOptimizePoints(
  body: OptimizeRouteRequest,
  geocodeStart: GeocodeStartFn = geocodeStartAddress
): Promise<PreparePointsResult> {
  if (!body.startAddress || typeof body.startAddress !== "string") {
    return { ok: false, status: 400, error: "startAddress is required." };
  }
  if (!Array.isArray(body.stops) || body.stops.length === 0) {
    return { ok: false, status: 400, error: "stops must be a non-empty array." };
  }

  const geocodedStops: GeocodedStop[] = [];
  for (const [index, stop] of body.stops.entries()) {
    if (!stop.address || typeof stop.address !== "string") {
      return { ok: false, status: 400, error: "Each stop must have an address string." };
    }
    if (stop.verificationStatus !== "verified") {
      return {
        ok: false,
        status: 422,
        error: `Stop ${index + 1} ("${stop.address}") is not verified. Resolve every stop before generating a route.`,
      };
    }
    const validated = validateVerifiedStopCoords(stop);
    if (!validated.ok) {
      return { ok: false, status: 422, error: validated.error };
    }
    geocodedStops.push({
      address: validated.stop.address,
      packageCount: stop.packageCount ?? 1,
      lat: validated.stop.lat,
      lng: validated.stop.lng,
    });
  }

  let start: GeocodedStop;
  if (isValidStartCoords(body.startCoords)) {
    start = {
      address: body.startAddress,
      packageCount: 0,
      lat: body.startCoords!.lat,
      lng: body.startCoords!.lng,
    };
  } else {
    start = await geocodeStart(body.startAddress);
  }

  return { ok: true, start, stops: geocodedStops };
}

optimizeRouteRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as OptimizeRouteRequest;

      const prepared = await prepareOptimizePoints(body);
      if (!prepared.ok) {
        res.status(prepared.status).json({ error: prepared.error });
        return;
      }
      const { start, stops: geocodedStops } = prepared;

      const clusterMeters = body.clusterMeters ?? DEFAULT_CLUSTER_METERS;
      const alertMeters = body.alertMeters ?? DEFAULT_ALERT_METERS;

      const osrmBaseUrl =
        process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org";

      const clusters = clusterStops(geocodedStops, clusterMeters);

      if (clusters.length === 0) {
        res.status(422).json({ error: "No clusters could be formed from the provided stops." });
        return;
      }

      const durationMatrix = await buildDurationMatrix(start, clusters, osrmBaseUrl);

      const orderedClusterIndices = optimizeRoute(durationMatrix);
      const orderedClusters = orderedClusterIndices.map((i) => clusters[i]);

      const legMetrics = await Promise.all(
        orderedClusters.map(async (cluster, stepIdx) => {
          const from =
            stepIdx === 0
              ? { lat: start.lat, lng: start.lng }
              : orderedClusters[stepIdx - 1].centroid;
          return fetchLegMetrics(from, cluster.centroid, osrmBaseUrl);
        })
      );

      const alertsPerCluster = generateAlerts(orderedClusters, alertMeters);

      const route: RouteStep[] = orderedClusters.map((cluster, i) => ({
        sequence: i + 1,
        clusterId: cluster.clusterId,
        driveSecondsFromPrevious: Math.round(legMetrics[i].durationSeconds),
        driveMilesFromPrevious:
          Math.round((legMetrics[i].distanceMeters / METERS_PER_MILE) * 100) / 100,
        centroid: cluster.centroid,
        stops: cluster.stops.map((s) => ({
          address: s.address,
          packageCount: s.packageCount,
          lat: s.lat,
          lng: s.lng,
        })),
        alerts: alertsPerCluster[i],
      }));

      const estimatedDriveSeconds = route.reduce(
        (sum, step) => sum + step.driveSecondsFromPrevious,
        0
      );
      const estimatedDriveMiles =
        Math.round(
          route.reduce((sum, step) => sum + step.driveMilesFromPrevious, 0) * 100
        ) / 100;
      const totalPackages = clusters.reduce((sum, c) => sum + c.totalPackages, 0);

      const responseBody: OptimizeRouteResponse = {
        start: {
          address: start.address,
          lat: start.lat,
          lng: start.lng,
        },
        settings: {
          clusterMeters,
          alertMeters,
        },
        summary: {
          totalInputStops: geocodedStops.length,
          totalClusters: clusters.length,
          totalPackages,
          estimatedDriveSeconds,
          estimatedDriveMiles,
        },
        route,
      };

      res.json(responseBody);
    } catch (err) {
      next(err);
    }
  }
);
