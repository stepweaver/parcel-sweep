import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { Server as SocketServer } from "socket.io";
import { getDb } from "../db/index.js";
import { queryAll, queryOne, exec } from "../db/helpers.js";
import { clusterStops } from "../services/clusterer.js";
import { buildDurationMatrix, fetchLegMetrics } from "../services/matrixBuilder.js";
import { optimizeRoute } from "../services/routeOptimizer.js";
import { generateAlerts } from "../services/alertGenerator.js";
import { haversineMeters } from "../services/clusterer.js";
import {
  PackageRow,
  RouteRow,
  RouteStopRow,
  RouteDetail,
  RouteStopDetail,
  PackageDetail,
  GeocodedStop,
} from "../types/index.js";

const METERS_PER_MILE = 1609.344;

export function createRoutesRouter(io: SocketServer): Router {
  const router = Router();

  // ── Helpers ──────────────────────────────────────────────

  function toPackageDetail(p: PackageRow): PackageDetail {
    return {
      id: p.id, manifestId: p.manifest_id, trackingNumber: p.tracking_number,
      recipientName: p.recipient_name, address: p.address, city: p.city,
      state: p.state, zip: p.zip, lat: p.lat, lng: p.lng,
      packageCount: p.package_count, serviceType: p.service_type,
      weightOz: p.weight_oz, status: p.status, isGhost: p.is_ghost === 1,
      createdAt: p.created_at, scannedAt: p.scanned_at, deliveredAt: p.delivered_at,
    };
  }

  function buildRouteDetail(routeId: string): RouteDetail | null {
    const db = getDb();
    const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId);
    if (!route) return null;

    const stops = queryAll<RouteStopRow>(
      db.prepare(`SELECT * FROM route_stops WHERE route_id = ? ORDER BY sequence_number ASC`), routeId
    );

    const stopDetails: RouteStopDetail[] = stops.map((stop) => {
      const pkgRows = queryAll<PackageRow>(
        db.prepare(`
          SELECT p.* FROM packages p
          JOIN route_stop_packages rsp ON rsp.package_id = p.id
          WHERE rsp.route_stop_id = ?
          ORDER BY p.address ASC
        `), stop.id
      );
      return {
        id: stop.id, routeId: stop.route_id,
        sequenceNumber: stop.sequence_number, clusterId: stop.cluster_id,
        centroid: { lat: stop.centroid_lat, lng: stop.centroid_lng },
        driveSecondsFromPrev: stop.drive_seconds_from_prev,
        driveMilesFromPrev: stop.drive_miles_from_prev,
        alerts: JSON.parse(stop.alerts) as string[],
        geometry: stop.geometry ? (JSON.parse(stop.geometry) as [number, number][]) : null,
        status: stop.status, arrivedAt: stop.arrived_at, completedAt: stop.completed_at,
        packages: pkgRows.map(toPackageDetail),
      };
    });

    return {
      id: route.id, manifestId: route.manifest_id, driverName: route.driver_name,
      vehicleId: route.vehicle_id, status: route.status, startAddress: route.start_address,
      startLat: route.start_lat, startLng: route.start_lng,
      clusterMeters: route.cluster_meters, alertMeters: route.alert_meters,
      createdAt: route.created_at, optimizedAt: route.optimized_at,
      completedAt: route.completed_at, stops: stopDetails,
    };
  }

  // ── GET /api/routes ───────────────────────────────────────
  router.get("/", (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const db = getDb();
      const rows = queryAll<RouteRow & { stop_count: number }>(
        db.prepare(`
          SELECT r.*, COUNT(DISTINCT rs.id) as stop_count
          FROM routes r
          LEFT JOIN route_stops rs ON rs.route_id = r.id
          GROUP BY r.id
          ORDER BY r.created_at DESC
        `)
      );
      res.json(rows.map((r) => ({
        id: r.id, manifestId: r.manifest_id, driverName: r.driver_name,
        status: r.status, startAddress: r.start_address, createdAt: r.created_at,
        optimizedAt: r.optimized_at, stopCount: r.stop_count,
      })));
    } catch (err) { next(err); }
  });

  // ── GET /api/routes/:id ───────────────────────────────────
  router.get("/:id", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const detail = buildRouteDetail(String(req.params["id"]));
      if (!detail) { res.status(404).json({ error: "Route not found." }); return; }
      res.json(detail);
    } catch (err) { next(err); }
  });

  // ── POST /api/routes ──────────────────────────────────────
  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const {
        manifestId, startAddress, driverName = "Driver",
        vehicleId, clusterMeters = 50, alertMeters = 120,
      } = req.body as {
        manifestId: string; startAddress: string; driverName?: string;
        vehicleId?: string; clusterMeters?: number; alertMeters?: number;
      };
      if (!manifestId || !startAddress) {
        res.status(400).json({ error: "manifestId and startAddress are required." }); return;
      }
      const db = getDb();
      const manifest = queryOne(db.prepare(`SELECT id FROM manifests WHERE id = ?`), manifestId);
      if (!manifest) { res.status(404).json({ error: "Manifest not found." }); return; }

      const routeId = uuidv4();
      exec(
        db.prepare(`
          INSERT INTO routes
            (id, manifest_id, driver_name, vehicle_id, status, start_address,
             cluster_meters, alert_meters, created_at)
          VALUES (?, ?, ?, ?, 'loading', ?, ?, ?, ?)
        `),
        routeId, manifestId, driverName, vehicleId ?? null, startAddress,
        clusterMeters, alertMeters, new Date().toISOString()
      );
      res.status(201).json(buildRouteDetail(routeId));
    } catch (err) { next(err); }
  });

  // ── POST /api/routes/:id/scan ─────────────────────────────
  router.post("/:id/scan", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { trackingNumber } = req.body as { trackingNumber?: string };
      if (!trackingNumber) { res.status(400).json({ error: "trackingNumber is required." }); return; }

      const db = getDb();
      const routeId = String(req.params["id"]);
      const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId);
      if (!route) { res.status(404).json({ error: "Route not found." }); return; }
      if (route.status !== "loading") {
        res.status(409).json({ error: "Route is no longer in loading state." }); return;
      }

      const now = new Date().toISOString();
      let pkg = queryOne<PackageRow>(
        db.prepare(`SELECT * FROM packages WHERE tracking_number = ? AND manifest_id = ?`),
        trackingNumber, route.manifest_id
      );
      let isGhost = false;

      if (!pkg) {
        isGhost = true;
        const ghostId = uuidv4();
        exec(
          db.prepare(`
            INSERT INTO packages
              (id, manifest_id, tracking_number, recipient_name, address,
               city, state, zip, lat, lng, package_count, service_type,
               weight_oz, status, is_ghost, created_at, scanned_at)
            VALUES (?, ?, ?, 'Unknown Recipient', 'Address Not Found',
                    'Unknown', 'IN', '00000', 0, 0, 1, 'Unknown', 0,
                    'loaded', 1, ?, ?)
          `),
          ghostId, route.manifest_id, trackingNumber, now, now
        );
        pkg = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), ghostId)!;
      } else {
        exec(
          db.prepare(`UPDATE packages SET status = 'loaded', scanned_at = ? WHERE id = ?`),
          now, pkg.id
        );
        pkg = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), pkg.id)!;
      }

      res.json({
        package: {
          id: pkg.id, trackingNumber: pkg.tracking_number,
          recipientName: pkg.recipient_name, address: pkg.address,
          city: pkg.city, status: pkg.status, isGhost,
        },
        isGhost,
        message: isGhost
          ? `⚠ Ghost package: "${trackingNumber}" not found in manifest. Added as unresolved.`
          : `Package scanned: ${pkg.address} — ${pkg.recipient_name}`,
      });
    } catch (err) { next(err); }
  });

  // ── POST /api/routes/:id/optimize ────────────────────────
  router.post(
    "/:id/optimize",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const db = getDb();
        const routeId = String(req.params["id"]);
        const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId);
        if (!route) { res.status(404).json({ error: "Route not found." }); return; }
        if (!["loading", "optimized"].includes(route.status)) {
          res.status(409).json({ error: `Cannot optimize a route with status "${route.status}".` }); return;
        }

        const packages = queryAll<PackageRow>(
          db.prepare(`
            SELECT * FROM packages
            WHERE manifest_id = ? AND status IN ('loaded', 'in_route')
              AND lat != 0 AND lng != 0
          `), route.manifest_id
        );
        if (packages.length === 0) {
          res.status(422).json({ error: "No packages with valid coordinates loaded onto this route." }); return;
        }

        const osrmBaseUrl = process.env.OSRM_BASE_URL ?? "http://router.project-osrm.org";
        let startLat = route.start_lat;
        let startLng = route.start_lng;

        if (!startLat || !startLng) {
          const googleApiKey = process.env.GOOGLE_GEOCODING_API_KEY;
          if (!googleApiKey) {
            res.status(500).json({ error: "GOOGLE_GEOCODING_API_KEY required to geocode start address." }); return;
          }
          const { geocodeAll } = await import("../services/geocoder.js");
          const { start } = await geocodeAll(route.start_address, [], googleApiKey);
          startLat = start.lat; startLng = start.lng;
          exec(db.prepare(`UPDATE routes SET start_lat = ?, start_lng = ? WHERE id = ?`), startLat, startLng, route.id);
        }

        const depot = { lat: startLat, lng: startLng };
        const geocodedStops: GeocodedStop[] = packages.map((p) => ({
          address: `${p.address}, ${p.city}, ${p.state} ${p.zip}`,
          packageCount: p.package_count, lat: p.lat, lng: p.lng,
        }));

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
        const now = new Date().toISOString();

        exec(db.prepare(`DELETE FROM route_stops WHERE route_id = ?`), route.id);
        exec(db.prepare(`UPDATE packages SET status = 'loaded' WHERE manifest_id = ? AND status = 'in_route'`), route.manifest_id);

        const insertStop = db.prepare(`
          INSERT INTO route_stops
            (id, route_id, sequence_number, cluster_id, centroid_lat, centroid_lng,
             drive_seconds_from_prev, drive_miles_from_prev, alerts, geometry, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `);
        const linkPkg = db.prepare(`
          INSERT OR IGNORE INTO route_stop_packages (route_stop_id, package_id) VALUES (?, ?)
        `);

        for (let i = 0; i < orderedClusters.length; i++) {
          const cluster = orderedClusters[i];
          const metrics = legMetrics[i];
          const stopId = uuidv4();
          const distMiles = Math.round((metrics.distanceMeters / METERS_PER_MILE) * 100) / 100;

          exec(
            insertStop,
            stopId, route.id, i + 1, cluster.clusterId,
            cluster.centroid.lat, cluster.centroid.lng,
            Math.round(metrics.durationSeconds), distMiles,
            JSON.stringify(alertsPerCluster[i]),
            metrics.geometry ? JSON.stringify(metrics.geometry) : null
          );

          for (const stop of cluster.stops) {
            const addrPrefix = stop.address.split(",")[0].toLowerCase().trim();
            const matchingPkgs = packages.filter((p) =>
              p.address.toLowerCase().trim() === addrPrefix ||
              `${p.address}, ${p.city}, ${p.state} ${p.zip}`.toLowerCase().includes(addrPrefix)
            );
            for (const mp of matchingPkgs) {
              exec(linkPkg, stopId, mp.id);
              exec(db.prepare(`UPDATE packages SET status = 'in_route' WHERE id = ?`), mp.id);
            }
          }
        }

        exec(db.prepare(`UPDATE routes SET status = 'optimized', optimized_at = ? WHERE id = ?`), now, route.id);
        res.json(buildRouteDetail(route.id));
      } catch (err) { next(err); }
    }
  );

  // ── POST /api/routes/:id/gps ──────────────────────────────
  router.post("/:id/gps", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { lat, lng, heading, speedMph } = req.body as {
        lat?: number; lng?: number; heading?: number; speedMph?: number;
      };
      if (lat === undefined || lng === undefined) {
        res.status(400).json({ error: "lat and lng are required." }); return;
      }

      const db = getDb();
      const routeId = String(req.params["id"]);
      const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId);
      if (!route) { res.status(404).json({ error: "Route not found." }); return; }

      const pingId = uuidv4();
      const now = new Date().toISOString();
      exec(
        db.prepare(`INSERT INTO gps_pings (id, route_id, lat, lng, heading, speed_mph, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
        pingId, route.id, lat, lng, heading ?? null, speedMph ?? null, now
      );

      const pingPayload = { lat, lng, heading, speedMph, recordedAt: now };
      io.to(`route:${route.id}`).emit("gps:update", pingPayload);

      const pendingStops = queryAll<RouteStopRow>(
        db.prepare(`SELECT * FROM route_stops WHERE route_id = ? AND status = 'pending' ORDER BY sequence_number ASC`),
        route.id
      );

      const proximityAlerts: string[] = [];
      for (const stop of pendingStops) {
        const dist = haversineMeters({ lat, lng }, { lat: stop.centroid_lat, lng: stop.centroid_lng });
        if (dist <= route.alert_meters) {
          const parsedAlerts = JSON.parse(stop.alerts) as string[];
          proximityAlerts.push(`Approaching Stop #${stop.sequence_number} in ${Math.round(dist)}m`);
          if (parsedAlerts.length > 0) proximityAlerts.push(...parsedAlerts);
        }
      }

      if (proximityAlerts.length > 0) {
        io.to(`route:${route.id}`).emit("alert:proximity", { alerts: proximityAlerts, lat, lng });
      }

      res.json({ pingId, proximityAlerts });
    } catch (err) { next(err); }
  });

  // ── PUT /api/routes/:id/stops/:stopId/complete ────────────
  router.put("/:id/stops/:stopId/complete", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const routeId = String(req.params["id"]);
      const stopId = String(req.params["stopId"]);

      exec(
        db.prepare(`UPDATE route_stops SET status = 'complete', completed_at = ? WHERE id = ? AND route_id = ?`),
        now, stopId, routeId
      );

      const pkgLinks = queryAll<{ package_id: string }>(
        db.prepare(`SELECT package_id FROM route_stop_packages WHERE route_stop_id = ?`), stopId
      );
      for (const link of pkgLinks) {
        exec(
          db.prepare(`UPDATE packages SET status = 'delivered', delivered_at = ? WHERE id = ?`),
          now, link.package_id
        );
      }

      io.to(`route:${routeId}`).emit("stop:completed", { stopId, completedAt: now });

      const remaining = queryOne<{ cnt: number }>(
        db.prepare(`SELECT COUNT(*) as cnt FROM route_stops WHERE route_id = ? AND status != 'complete'`),
        routeId
      )!;

      if (remaining.cnt === 0) {
        exec(db.prepare(`UPDATE routes SET status = 'complete', completed_at = ? WHERE id = ?`), now, routeId);
        io.to(`route:${routeId}`).emit("route:complete", { completedAt: now });
      }

      res.json({ success: true, remainingStops: remaining.cnt });
    } catch (err) { next(err); }
  });

  // ── PUT /api/routes/:id/stops/:stopId/arrive ──────────────
  router.put("/:id/stops/:stopId/arrive", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      exec(
        db.prepare(`UPDATE route_stops SET status = 'arrived', arrived_at = ? WHERE id = ? AND route_id = ?`),
        now, String(req.params["stopId"]), String(req.params["id"])
      );
      io.to(`route:${req.params["id"]}`).emit("stop:arrived", { stopId: req.params["stopId"], arrivedAt: now });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // ── PUT /api/routes/:id/start ─────────────────────────────
  router.put("/:id/start", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const db = getDb();
      const routeId = String(req.params["id"]);
      const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId);
      if (!route) { res.status(404).json({ error: "Route not found." }); return; }
      if (route.status !== "optimized") {
        res.status(409).json({ error: "Route must be optimized before starting delivery." }); return;
      }
      exec(db.prepare(`UPDATE routes SET status = 'in_delivery' WHERE id = ?`), route.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return router;
}
