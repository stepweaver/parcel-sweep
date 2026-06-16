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
import { importManifestFromCsv, csvTemplate } from "../services/csvImporter.js";
import { writeAuditEvent } from "../services/auditService.js";
import { summarizeValidation } from "../services/manifestValidator.js";
import { toPackageDetail, toManifestSummary } from "../services/packageMappers.js";
import {
  ManifestRow,
  PackageRow,
  RouteProposal,
  RouteRow,
} from "../types/index.js";

export const manifestsRouter = Router();

/** GET /api/manifests/import/template */
manifestsRouter.get("/import/template", (_req: Request, res: Response): void => {
  res.type("text/csv").send(csvTemplate());
});

/** POST /api/manifests/import */
manifestsRouter.post(
  "/import",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { csv, hubZip, hubId, operationDate, dutTime, actor } = req.body as {
        csv?: string;
        hubZip?: string;
        hubId?: string;
        operationDate?: string;
        dutTime?: string;
        actor?: string;
      };

      if (!csv?.trim()) {
        res.status(400).json({ error: "csv text is required." });
        return;
      }
      if (!hubZip || !/^\d{5}$/.test(hubZip)) {
        res.status(400).json({ error: "hubZip must be a 5-digit ZIP." });
        return;
      }

      const result = await importManifestFromCsv(csv, {
        hubZip,
        hubId,
        operationDate,
        dutTime,
        actor,
      });

      const manifest = getManifestWithPackages(result.manifestId)!;
      res.status(201).json({
        manifest: toManifestSummary(manifest),
        packages: manifest.packages.map(toPackageDetail),
        summary: result.summary,
        rowCount: result.rowCount,
        rejectedCount: result.rejectedCount,
      });
    } catch (err) {
      next(err);
    }
  }
);

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

/** GET /api/manifests/:id/validation */
manifestsRouter.get("/:id/validation", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const manifest = getManifestWithPackages(String(req.params["id"]));
    if (!manifest) {
      res.status(404).json({ error: "Manifest not found." });
      return;
    }
    const summary = summarizeValidation(
      manifest.packages.map((p) => ({
        validationStatus: p.validation_status ?? "verified",
        quarantineStatus: p.quarantine_status ?? "none",
      }))
    );
    res.json({
      manifest: toManifestSummary(manifest),
      summary,
      packages: manifest.packages.map(toPackageDetail),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/manifests/:id/packages/:packageId/override */
manifestsRouter.post(
  "/:id/packages/:packageId/override",
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const manifestId = String(req.params["id"]);
      const packageId = String(req.params["packageId"]);
      const { reason, actor } = req.body as { reason?: string; actor?: string };

      if (!reason?.trim()) {
        res.status(400).json({ error: "Supervisor override reason is required." });
        return;
      }

      const db = getDb();
      const pkg = queryOne<PackageRow>(
        db.prepare(`SELECT * FROM packages WHERE id = ? AND manifest_id = ?`),
        packageId,
        manifestId
      );
      if (!pkg) {
        res.status(404).json({ error: "Package not found." });
        return;
      }

      const before = {
        validationStatus: pkg.validation_status,
        quarantineStatus: pkg.quarantine_status,
      };
      const now = new Date().toISOString();
      const supervisor = actor?.trim() || "supervisor";

      exec(
        db.prepare(`
          UPDATE packages
          SET quarantine_status = 'released',
              validation_status = CASE WHEN validation_status = 'duplicate' THEN 'warning' ELSE validation_status END,
              override_note = ?,
              override_by = ?,
              override_at = ?
          WHERE id = ?
        `),
        reason.trim(),
        supervisor,
        now,
        packageId
      );

      writeAuditEvent({
        entityType: "package",
        entityId: packageId,
        action: "supervisor_override",
        actor: supervisor,
        before,
        after: { quarantineStatus: "released", overrideNote: reason.trim() },
        reason: reason.trim(),
      });

      const updated = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), packageId)!;
      res.json({ package: toPackageDetail(updated) });
    } catch (err) {
      next(err);
    }
  }
);

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
        maxRouteDurationMinutes,
        sundayMode,
      } = req.body as {
        startAddress?: string;
        clusterMeters?: number;
        alertMeters?: number;
        driverCount?: number;
        maxPackagesPerRoute?: number;
        maxStopsPerRoute?: number;
        maxRouteDurationMinutes?: number;
        sundayMode?: boolean;
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
        maxRouteDurationMinutes,
        sundayMode: sundayMode !== false,
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
      const uniquePackageIds = [...new Set(proposal?.packageIds ?? [])];
      if (!uniquePackageIds.length) {
        res.status(400).json({ error: "proposal with packageIds is required." });
        return;
      }

      if (proposal.durationFeasible === false) {
        res.status(409).json({
          error: "Cannot create route from infeasible proposal.",
          reasons: proposal.infeasibilityReasons,
        });
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
        db.prepare(`SELECT * FROM packages WHERE id IN (${uniquePackageIds.map(() => "?").join(",")})`),
        ...uniquePackageIds
      );

      if (packageRows.length !== uniquePackageIds.length) {
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
        if (pkg.quarantine_status === "hold" || pkg.validation_status === "hold" || pkg.validation_status === "duplicate") {
          res.status(409).json({
            error: `Package ${pkg.tracking_number} is on hold and cannot be routed without override.`,
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
             start_lat, start_lng, cluster_meters, alert_meters, sunday_mode, created_at)
          VALUES (?, ?, ?, ?, ?, 'loading', ?, ?, ?, ?, ?, 1, ?)
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
      for (const pkgId of uniquePackageIds) {
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
        assignedPackageCount: uniquePackageIds.length,
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

/** DELETE /api/manifests/:id — removes manifest, its routes, and all packages */
manifestsRouter.delete("/:id", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDb();
    const manifestId = String(req.params["id"]);

    const manifest = queryOne<ManifestRow>(
      db.prepare(`SELECT id FROM manifests WHERE id = ?`),
      manifestId
    );
    if (!manifest) {
      res.status(404).json({ error: "Manifest not found." });
      return;
    }

    db.exec("BEGIN");
    try {
      exec(db.prepare(`DELETE FROM routes WHERE manifest_id = ?`), manifestId);
      const changes = exec(db.prepare(`DELETE FROM manifests WHERE id = ?`), manifestId);
      if (changes === 0) {
        db.exec("ROLLBACK");
        res.status(404).json({ error: "Manifest not found." });
        return;
      }
      db.exec("COMMIT");
      res.json({ deleted: manifestId });
    } catch (inner) {
      db.exec("ROLLBACK");
      throw inner;
    }
  } catch (err) {
    next(err);
  }
});
