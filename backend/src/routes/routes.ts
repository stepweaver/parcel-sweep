import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { Server as SocketServer } from "socket.io";
import { getDb } from "../db/index.js";
import { queryAll, queryOne, exec } from "../db/helpers.js";
import { haversineMeters } from "../services/clusterer.js";
import { planRouteFromPackages, resolveDepot } from "../services/routePlanner.js";
import { buildGpx, buildKml, buildCsv } from "../services/routeExporter.js";
import {
  PackageRow,
  RouteRow,
  RouteStopRow,
  RouteDetail,
  RouteStopDetail,
  PackageDetail,
  LoadOrderResponse,
  LoadOrderItem,
} from "../types/index.js";


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
  router.post("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      const { resolveAddressCoords } = await import("../services/geocoder.js");
      let startLat: number | null = null;
      let startLng: number | null = null;
      try {
        const coords = await resolveAddressCoords(startAddress.trim());
        startLat = coords.lat;
        startLng = coords.lng;
        console.log(`[route] Depot geocoded via ${coords.source} on create`);
      } catch (err) {
        console.warn(
          "[route] Could not geocode depot on create:",
          err instanceof Error ? err.message : err
        );
      }

      const routeId = uuidv4();
      exec(
        db.prepare(`
          INSERT INTO routes
            (id, manifest_id, driver_name, vehicle_id, status, start_address,
             start_lat, start_lng, cluster_meters, alert_meters, created_at)
          VALUES (?, ?, ?, ?, 'loading', ?, ?, ?, ?, ?, ?)
        `),
        routeId, manifestId, driverName, vehicleId ?? null, startAddress.trim(),
        startLat, startLng, clusterMeters, alertMeters, new Date().toISOString()
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

  function buildLoadOrderFromDetail(detail: RouteDetail, source: "optimized" | "preview"): LoadOrderResponse {
    const totalStops = detail.stops.length;
    const items: LoadOrderItem[] = [...detail.stops]
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
      .map((stop, idx) => ({
        loadPosition: idx + 1,
        deliverySequence: stop.sequenceNumber,
        stopId: stop.id,
        address: stop.packages[0]?.address ?? "Unknown address",
        packages: stop.packages,
        loaded: stop.packages.every((p) => ["loaded", "in_route", "delivered"].includes(p.status)),
      }));
    return { source, totalStops, items };
  }

  async function buildLoadOrderPreview(route: RouteRow): Promise<LoadOrderResponse> {
    const db = getDb();
    const packages = queryAll<PackageRow>(
      db.prepare(`
        SELECT * FROM packages
        WHERE manifest_id = ? AND lat != 0 AND lng != 0 AND is_ghost = 0
      `),
      route.manifest_id
    );
    if (packages.length === 0) {
      throw new Error("No geocoded packages on this manifest to plan load order.");
    }

    const plan = await planRouteFromPackages(route, packages);
    const pkgById = new Map(packages.map((p) => [p.id, p]));

    const stops: RouteStopDetail[] = plan.stops.map((s) => ({
      id: `preview-${s.sequenceNumber}`,
      routeId: route.id,
      sequenceNumber: s.sequenceNumber,
      clusterId: s.clusterId,
      centroid: s.centroid,
      driveSecondsFromPrev: s.driveSecondsFromPrev,
      driveMilesFromPrev: s.driveMilesFromPrev,
      alerts: s.alerts,
      geometry: s.geometry,
      status: "pending" as const,
      arrivedAt: null,
      completedAt: null,
      packages: s.packageIds
        .map((id) => pkgById.get(id))
        .filter((p): p is PackageRow => p != null)
        .map(toPackageDetail),
    }));

    return buildLoadOrderFromDetail(
      {
        id: route.id,
        manifestId: route.manifest_id,
        driverName: route.driver_name,
        vehicleId: route.vehicle_id,
        status: route.status,
        startAddress: route.start_address,
        startLat: route.start_lat,
        startLng: route.start_lng,
        clusterMeters: route.cluster_meters,
        alertMeters: route.alert_meters,
        createdAt: route.created_at,
        optimizedAt: route.optimized_at,
        completedAt: route.completed_at,
        stops,
      },
      "preview"
    );
  }

  // ── GET /api/routes/:id/load-order ───────────────────────
  router.get("/:id/load-order", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const routeId = String(req.params["id"]);
      const detail = buildRouteDetail(routeId);
      if (!detail) { res.status(404).json({ error: "Route not found." }); return; }

      if (detail.stops.length > 0) {
        res.json(buildLoadOrderFromDetail(detail, "optimized"));
        return;
      }

      const db = getDb();
      const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId)!;
      const preview = await buildLoadOrderPreview(route);
      res.json(preview);
    } catch (err) { next(err); }
  });

  // ── GET /api/routes/:id/export/:format ─────────────────────
  router.get("/:id/export/:format", (req: Request, res: Response, next: NextFunction): void => {
    try {
      const format = String(req.params["format"]).toLowerCase();
      const detail = buildRouteDetail(String(req.params["id"]));
      if (!detail) { res.status(404).json({ error: "Route not found." }); return; }
      if (detail.stops.length === 0) {
        res.status(422).json({ error: "Route must be optimized before export." }); return;
      }

      const filename = `route-${detail.id.slice(0, 8)}`;
      if (format === "gpx") {
        res.setHeader("Content-Type", "application/gpx+xml");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.gpx"`);
        res.send(buildGpx(detail));
        return;
      }
      if (format === "kml") {
        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.kml"`);
        res.send(buildKml(detail));
        return;
      }
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
        res.send(buildCsv(detail));
        return;
      }
      res.status(400).json({ error: "Format must be gpx, kml, or csv." });
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

        const depot = await resolveDepot(route);
        if (!route.start_lat || !route.start_lng) {
          exec(db.prepare(`UPDATE routes SET start_lat = ?, start_lng = ? WHERE id = ?`), depot.lat, depot.lng, route.id);
        }

        const plan = await planRouteFromPackages(route, packages);
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

        for (const stop of plan.stops) {
          const stopId = uuidv4();
          exec(
            insertStop,
            stopId, route.id, stop.sequenceNumber, stop.clusterId,
            stop.centroid.lat, stop.centroid.lng,
            stop.driveSecondsFromPrev, stop.driveMilesFromPrev,
            JSON.stringify(stop.alerts),
            stop.geometry ? JSON.stringify(stop.geometry) : null
          );
          for (const pkgId of stop.packageIds) {
            exec(linkPkg, stopId, pkgId);
            exec(db.prepare(`UPDATE packages SET status = 'in_route' WHERE id = ?`), pkgId);
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
