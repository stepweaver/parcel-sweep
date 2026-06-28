import { Router, Request, Response, NextFunction } from "express";
import { geocodeAll } from "../services/geocoder.js";
import { clusterStops } from "../services/clusterer.js";
import { buildDurationMatrix, fetchLegMetrics } from "../services/matrixBuilder.js";
import { optimizeRoute } from "../services/routeOptimizer.js";
import { generateAlerts } from "../services/alertGenerator.js";
import {
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  RouteStep,
} from "../types/index.js";

const METERS_PER_MILE = 1609.344;
const DEFAULT_CLUSTER_METERS = 50;
const DEFAULT_ALERT_METERS = 120;

export const optimizeRouteRouter = Router();

optimizeRouteRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as OptimizeRouteRequest;

      // --- Validate request ---
      if (!body.startAddress || typeof body.startAddress !== "string") {
        res.status(400).json({ error: "startAddress is required." });
        return;
      }
      if (!Array.isArray(body.stops) || body.stops.length === 0) {
        res.status(400).json({ error: "stops must be a non-empty array." });
        return;
      }
      for (const stop of body.stops) {
        if (!stop.address || typeof stop.address !== "string") {
          res.status(400).json({ error: "Each stop must have an address string." });
          return;
        }
      }

      const clusterMeters = body.clusterMeters ?? DEFAULT_CLUSTER_METERS;
      const alertMeters = body.alertMeters ?? DEFAULT_ALERT_METERS;

      const osrmBaseUrl =
        process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org";

      // --- 1. Geocode all addresses (Google if configured, else OpenStreetMap) ---
      //        If pre-resolved start coordinates are supplied, use them for the depot
      //        (avoids a round-trip geocode for the start point).
      const { start: geocodedStart, stops: geocodedStops } = await geocodeAll(
        body.startAddress,
        body.stops
      );
      const start = body.startCoords
        ? { ...geocodedStart, lat: body.startCoords.lat, lng: body.startCoords.lng }
        : geocodedStart;

      // --- 2. Cluster stops by proximity ---
      const clusters = clusterStops(geocodedStops, clusterMeters);

      if (clusters.length === 0) {
        res.status(422).json({ error: "No clusters could be formed from the provided stops." });
        return;
      }

      // --- 3. Build OSRM duration matrix (depot + all cluster centroids) ---
      const durationMatrix = await buildDurationMatrix(start, clusters, osrmBaseUrl);

      // --- 4. Optimise visit order ---
      const orderedClusterIndices = optimizeRoute(durationMatrix);
      const orderedClusters = orderedClusterIndices.map((i) => clusters[i]);

      // --- 5. Fetch per-leg metrics for the final ordered route ---
      //        We do this sequentially to be polite to the public OSRM instance.
      const legMetrics = await Promise.all(
        orderedClusters.map(async (cluster, stepIdx) => {
          const from =
            stepIdx === 0
              ? { lat: start.lat, lng: start.lng }
              : orderedClusters[stepIdx - 1].centroid;
          return fetchLegMetrics(from, cluster.centroid, osrmBaseUrl);
        })
      );

      // --- 6. Generate nearby-package alerts per cluster ---
      const alertsPerCluster = generateAlerts(orderedClusters, alertMeters);

      // --- 7. Build response ---
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
