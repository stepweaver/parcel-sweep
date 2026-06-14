import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index.js";
import { queryAll, queryOne, exec } from "../db/helpers.js";
import {
  generateManifest,
  getManifestWithPackages,
} from "../services/manifestGenerator.js";
import { proposeRoutesForManifest } from "../services/manifestRoutePlanner.js";
import { buildRouteSummaries } from "../services/routeSummaries.js";
import {
  ManifestRow,
  PackageRow,
  PackageDetail,
  ManifestSummary,
  RouteProposal,
  RouteRow,
} from "../types/index.js";

export const manifestsRouter = Router();

function toPackageDetail(p: PackageRow): PackageDetail {
  return {
    id: p.id,
    manifestId: p.manifest_id,
    assignedRouteId: p.assigned_route_id,
    trackingNumber: p.tracking_number,
    recipientName: p.recipient_name,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    lat: p.lat,
    lng: p.lng,
    packageCount: p.package_count,
    serviceType: p.service_type,
    weightOz: p.weight_oz,
    status: p.status,
    isGhost: p.is_ghost === 1,
    createdAt: p.created_at,
    scannedAt: p.scanned_at,
    deliveredAt: p.delivered_at,
  };
}

function toManifestSummary(m: ManifestRow): ManifestSummary {
  return {
    id: m.id,
    zipCode: m.zip_code,
    generatedAt: m.generated_at,
    totalPackages: m.total_packages,
    status: m.status,
  };
}

/** POST /api/manifests/generate */
manifestsRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { zipCode, count } = req.body as { zipCode?: string; count?: number };

      if (!zipCode || !/^\d{5}$/.test(zipCode)) {
        res.status(400).json({ error: "zipCode must be a 5-digit US ZIP code." });
        return;
      }

      const packageCount = Math.min(Math.max(Number(count) || 30, 1), 200);
      console.log(`Generating manifest for ZIP ${zipCode}, ${packageCount} packages…`);

      const manifestId = await generateManifest(zipCode, packageCount);
      const manifest = getManifestWithPackages(manifestId)!;

      res.status(201).json({
        manifest: toManifestSummary(manifest),
        packages: manifest.packages.map(toPackageDetail),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/manifests */
manifestsRouter.get("/", (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDb();
    const rows = queryAll<ManifestRow & { package_count: number }>(
      db.prepare(
        `SELECT m.*, COUNT(p.id) as package_count
         FROM manifests m
         LEFT JOIN packages p ON p.manifest_id = m.id
         GROUP BY m.id
         ORDER BY m.generated_at DESC`
      )
    );
    res.json(rows.map((m) => ({ ...toManifestSummary(m), totalPackages: m.package_count })));
  } catch (err) {
    next(err);
  }
});

/** GET /api/manifests/:id/routes */
manifestsRouter.get("/:id/routes", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const manifestId = String(req.params["id"]);
    const manifest = queryOne<ManifestRow>(
      getDb().prepare(`SELECT id FROM manifests WHERE id = ?`),
      manifestId
    );
    if (!manifest) {
      res.status(404).json({ error: "Manifest not found." });
      return;
    }
    const summaries = buildRouteSummaries().filter((r) => r.manifestId === manifestId);
    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

/** POST /api/manifests/:id/propose-routes */
manifestsRouter.post(
  "/:id/propose-routes",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const manifestId = String(req.params["id"]);
      const manifest = getManifestWithPackages(manifestId);
      if (!manifest) {
        res.status(404).json({ error: "Manifest not found." });
        return;
      }

      const {
        startAddress,
        clusterMeters,
        alertMeters,
        driverCount,
        maxPackagesPerRoute,
        maxStopsPerRoute,
      } = req.body as {
        startAddress?: string;
        clusterMeters?: number;
        alertMeters?: number;
        driverCount?: number;
        maxPackagesPerRoute?: number;
        maxStopsPerRoute?: number;
      };

      if (!startAddress?.trim()) {
        res.status(400).json({ error: "startAddress is required." });
        return;
      }

      const parsedDriverCount = Number(driverCount);
      if (!Number.isFinite(parsedDriverCount) || parsedDriverCount < 1) {
        res.status(400).json({ error: "driverCount must be at least 1." });
        return;
      }

      const result = await proposeRoutesForManifest(manifestId, manifest.packages, {
        startAddress: startAddress.trim(),
        clusterMeters,
        alertMeters,
        driverCount: parsedDriverCount,
        maxPackagesPerRoute,
        maxStopsPerRoute,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/manifests/:id/routes/from-proposal */
manifestsRouter.post(
  "/:id/routes/from-proposal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const manifestId = String(req.params["id"]);
      const {
        startAddress,
        driverName = "Driver",
        routeNumber,
        vehicleId,
        clusterMeters = 50,
        alertMeters = 120,
        proposal,
      } = req.body as {
        startAddress: string;
        driverName?: string;
        routeNumber: string;
        vehicleId?: string;
        clusterMeters?: number;
        alertMeters?: number;
        proposal: RouteProposal;
      };

      if (!startAddress?.trim()) {
        res.status(400).json({ error: "startAddress is required." });
        return;
      }
      const trimmedRouteNumber = routeNumber?.trim();
      if (!trimmedRouteNumber) {
        res.status(400).json({ error: "routeNumber is required." });
        return;
      }
      if (!proposal?.packageIds?.length) {
        res.status(400).json({ error: "proposal with packageIds is required." });
        return;
      }

      const db = getDb();
      const manifest = queryOne<ManifestRow>(
        db.prepare(`SELECT id FROM manifests WHERE id = ?`),
        manifestId
      );
      if (!manifest) {
        res.status(404).json({ error: "Manifest not found." });
        return;
      }

      const packageRows = queryAll<PackageRow>(
        db.prepare(`SELECT * FROM packages WHERE id IN (${proposal.packageIds.map(() => "?").join(",")})`),
        ...proposal.packageIds
      );

      if (packageRows.length !== proposal.packageIds.length) {
        res.status(400).json({ error: "One or more packages in the proposal were not found." });
        return;
      }

      for (const pkg of packageRows) {
        if (pkg.manifest_id !== manifestId) {
          res.status(400).json({ error: "Proposal includes packages from another manifest." });
          return;
        }
        if (pkg.assigned_route_id) {
          res.status(409).json({
            error: `Package ${pkg.tracking_number} is already assigned to another route.`,
          });
          return;
        }
      }

      const { resolveAddressCoords } = await import("../services/geocoder.js");
      let startLat: number | null = null;
      let startLng: number | null = null;
      try {
        const coords = await resolveAddressCoords(startAddress.trim());
        startLat = coords.lat;
        startLng = coords.lng;
      } catch (err) {
        console.warn(
          "[manifest] Could not geocode depot on route create:",
          err instanceof Error ? err.message : err
        );
      }

      const routeId = uuidv4();
      const now = new Date().toISOString();

      exec(
        db.prepare(`
          INSERT INTO routes
            (id, manifest_id, route_number, driver_name, vehicle_id, status, start_address,
             start_lat, start_lng, cluster_meters, alert_meters, created_at)
          VALUES (?, ?, ?, ?, ?, 'loading', ?, ?, ?, ?, ?, ?)
        `),
        routeId,
        manifestId,
        trimmedRouteNumber,
        driverName.trim() || "Driver",
        vehicleId ?? null,
        startAddress.trim(),
        startLat,
        startLng,
        clusterMeters,
        alertMeters,
        now
      );

      const assignPkg = db.prepare(
        `UPDATE packages SET assigned_route_id = ? WHERE id = ? AND manifest_id = ? AND assigned_route_id IS NULL`
      );
      for (const pkgId of proposal.packageIds) {
        const changes = exec(assignPkg, routeId, pkgId, manifestId);
        if (changes === 0) {
          exec(db.prepare(`DELETE FROM routes WHERE id = ?`), routeId);
          res.status(409).json({ error: "A package was assigned to another route during creation." });
          return;
        }
      }

      const route = queryOne<RouteRow>(db.prepare(`SELECT * FROM routes WHERE id = ?`), routeId)!;
      res.status(201).json({
        id: route.id,
        manifestId: route.manifest_id,
        routeNumber: route.route_number,
        driverName: route.driver_name,
        status: route.status,
        startAddress: route.start_address,
        assignedPackageCount: proposal.packageIds.length,
        proposalId: proposal.proposalId,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/manifests/:id */
manifestsRouter.get("/:id", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const manifest = getManifestWithPackages(String(req.params["id"]));
    if (!manifest) {
      res.status(404).json({ error: "Manifest not found." });
      return;
    }
    res.json({
      manifest: toManifestSummary(manifest),
      packages: manifest.packages.map(toPackageDetail),
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/manifests/:id */
manifestsRouter.delete("/:id", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDb();
    const changes = exec(db.prepare(`DELETE FROM manifests WHERE id = ?`), String(req.params["id"]));
    if (changes === 0) {
      res.status(404).json({ error: "Manifest not found." });
      return;
    }
    res.json({ deleted: req.params["id"] });
  } catch (err) {
    next(err);
  }
});
