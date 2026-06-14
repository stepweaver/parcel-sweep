import { Router, Request, Response, NextFunction } from "express";
import { getDb } from "../db/index.js";
import { queryOne, exec } from "../db/helpers.js";
import { PackageRow, PackageDetail } from "../types/index.js";

export const packagesRouter = Router();

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

/** GET /api/packages/:id */
packagesRouter.get("/:id", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDb();
    const pkg = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), String(req.params["id"]));
    if (!pkg) { res.status(404).json({ error: "Package not found." }); return; }
    res.json(toPackageDetail(pkg));
  } catch (err) { next(err); }
});

/** PUT /api/packages/:id/deliver */
packagesRouter.put("/:id/deliver", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const changes = exec(
      db.prepare(`UPDATE packages SET status = 'delivered', delivered_at = ? WHERE id = ?`),
      now, String(req.params["id"])
    );
    if (changes === 0) { res.status(404).json({ error: "Package not found." }); return; }
    const pkg = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), String(req.params["id"]))!;
    res.json(toPackageDetail(pkg));
  } catch (err) { next(err); }
});

/** PUT /api/packages/:id/address  — update address for ghost packages */
packagesRouter.put("/:id/address", (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { address, city, state, zip, lat, lng, recipientName } = req.body as {
      address?: string; city?: string; state?: string; zip?: string;
      lat?: number; lng?: number; recipientName?: string;
    };

    const db = getDb();
    const pkg = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), String(req.params["id"]));
    if (!pkg) { res.status(404).json({ error: "Package not found." }); return; }
    if (!pkg.is_ghost) { res.status(409).json({ error: "Only ghost packages can have address overridden." }); return; }

    exec(
      db.prepare(`
        UPDATE packages
        SET address = COALESCE(?, address),
            city = COALESCE(?, city),
            state = COALESCE(?, state),
            zip = COALESCE(?, zip),
            lat = COALESCE(?, lat),
            lng = COALESCE(?, lng),
            recipient_name = COALESCE(?, recipient_name)
        WHERE id = ?
      `),
      address ?? null, city ?? null, state ?? null, zip ?? null,
      lat ?? null, lng ?? null, recipientName ?? null, pkg.id
    );

    const updated = queryOne<PackageRow>(db.prepare(`SELECT * FROM packages WHERE id = ?`), pkg.id)!;
    res.json(toPackageDetail(updated));
  } catch (err) { next(err); }
});
