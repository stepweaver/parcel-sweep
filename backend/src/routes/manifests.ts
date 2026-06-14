import { Router, Request, Response, NextFunction } from "express";
import { getDb } from "../db/index.js";
import { queryAll, queryOne, exec } from "../db/helpers.js";
import {
  generateManifest,
  getManifestWithPackages,
} from "../services/manifestGenerator.js";
import { ManifestRow, PackageRow, PackageDetail, ManifestSummary } from "../types/index.js";

export const manifestsRouter = Router();

function toPackageDetail(p: PackageRow): PackageDetail {
  return {
    id: p.id,
    manifestId: p.manifest_id,
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
