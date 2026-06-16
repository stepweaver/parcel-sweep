import { getDb } from "../db/index.js";
import { queryAll, queryOne } from "../db/helpers.js";
import { SUNDAY_DEFAULTS } from "../config/sundayDefaults.js";
import { buildRouteSummaries } from "./routeSummaries.js";
import { toManifestSummary } from "./packageMappers.js";
import { ManifestRow, PackageRow, SundayDashboardResponse } from "../types/index.js";
import { parseValidationReasons } from "./packageMappers.js";

export function buildSundayDashboard(): SundayDashboardResponse {
  const db = getDb();

  const activeManifest = queryOne<ManifestRow>(
    db.prepare(`
      SELECT * FROM manifests
      WHERE status = 'active'
      ORDER BY generated_at DESC
      LIMIT 1
    `)
  );

  const manifestId = activeManifest?.id ?? null;
  let packages: PackageRow[] = [];
  if (manifestId) {
    packages = queryAll<PackageRow>(
      db.prepare(`SELECT * FROM packages WHERE manifest_id = ?`),
      manifestId
    );
  }

  const allPackages = manifestId ? packages : queryAll<PackageRow>(db.prepare(`SELECT * FROM packages`));
  const routes = buildRouteSummaries().filter((r) => !manifestId || r.manifestId === manifestId);

  const heldByReason: Record<string, number> = {};
  for (const p of allPackages) {
    if (p.quarantine_status === "hold" || p.validation_status === "hold" || p.validation_status === "duplicate") {
      for (const reason of parseValidationReasons(p.validation_reasons)) {
        heldByReason[reason] = (heldByReason[reason] ?? 0) + 1;
      }
    }
  }

  const notReady: SundayDashboardResponse["notReady"] = [];
  for (const [reason, count] of Object.entries(heldByReason)) {
    notReady.push({
      type: "package_hold",
      label: reason.replace(/_/g, " ").toLowerCase(),
      count,
      manifestId: manifestId ?? undefined,
    });
  }

  const unassignedRoutes = routes.filter(
    (r) => r.status === "loading" && !r.driverName?.trim()
  );
  if (unassignedRoutes.length) {
    notReady.push({
      type: "missing_driver",
      label: "routes missing driver assignment",
      count: unassignedRoutes.length,
    });
  }

  const readyToDispatch: SundayDashboardResponse["readyToDispatch"] = routes
    .filter((r) => r.status === "optimized" && (r.loadedPackageCount ?? 0) > 0)
    .map((r) => ({
      routeId: r.id,
      routeNumber: r.routeNumber,
      driverName: r.driverName,
      packageCount: r.loadedPackageCount ?? 0,
      manifestId: r.manifestId,
      dutTime: activeManifest?.dut_time ?? null,
      loadElapsedMinutes: r.loadElapsedMinutes ?? null,
      deliverElapsedMinutes: r.deliverElapsedMinutes ?? null,
      loadWithinMinutes: SUNDAY_DEFAULTS.loadWithinMinutes,
      deliverWithinMinutes: SUNDAY_DEFAULTS.deliverWithinMinutes,
      loadTimerBreached: r.loadTimerBreached ?? false,
      deliverTimerBreached: r.deliverTimerBreached ?? false,
    }));

  const inException: SundayDashboardResponse["inException"] = [];

  const ghosts = allPackages.filter((p) => p.is_ghost === 1);
  if (ghosts.length) {
    inException.push({
      type: "ghost",
      label: `${ghosts.length} ghost package(s) unresolved`,
      manifestId: manifestId ?? undefined,
    });
  }

  for (const r of routes.filter((rt) => rt.status === "in_delivery")) {
    if (r.loadTimerBreached) {
      inException.push({
        type: "load_timer",
        label: `Route ${r.routeNumber ?? r.id.slice(0, 8)} load exceeded ${SUNDAY_DEFAULTS.loadWithinMinutes}m`,
        routeId: r.id,
        detail: `${r.loadElapsedMinutes ?? "?"} min`,
      });
    }
    if (r.deliverTimerBreached) {
      inException.push({
        type: "deliver_timer",
        label: `Route ${r.routeNumber ?? r.id.slice(0, 8)} not delivering within ${SUNDAY_DEFAULTS.deliverWithinMinutes}m`,
        routeId: r.id,
        detail: `${r.deliverElapsedMinutes ?? "?"} min since begin tour`,
      });
    }
    if ((r.loadedPackageCount ?? 0) === 0 && r.remainingStops > 0) {
      inException.push({
        type: "no_scans",
        label: `Route ${r.routeNumber ?? r.id.slice(0, 8)} no loaded packages`,
        routeId: r.id,
      });
    }
  }

  const routed = allPackages.filter((p) => p.assigned_route_id).length;
  const loaded = allPackages.filter((p) => p.status === "loaded" || p.status === "in_route").length;
  const delivered = allPackages.filter((p) => p.status === "delivered").length;
  const validated = allPackages.filter(
    (p) => p.validation_status === "verified" || p.validation_status === "warning" || p.quarantine_status === "released"
  ).length;

  const activeRouteCount = routes.filter((r) => r.status === "in_delivery").length;

  const activeRoutes: SundayDashboardResponse["activeRoutes"] = routes
    .filter((r) => ["loading", "optimized", "in_delivery"].includes(r.status))
    .map((r) => {
      const routePackages = allPackages.filter((p) => p.assigned_route_id === r.id);
      return {
        routeId: r.id,
        routeNumber: r.routeNumber,
        driverName: r.driverName,
        status: r.status,
        dutTime: activeManifest?.dut_time ?? null,
        loadedAt: r.loadedAt ?? null,
        beginTourAt: r.beginTourAt ?? null,
        loadElapsedMinutes: r.loadElapsedMinutes ?? null,
        deliverElapsedMinutes: r.deliverElapsedMinutes ?? null,
        loadWithinMinutes: SUNDAY_DEFAULTS.loadWithinMinutes,
        deliverWithinMinutes: SUNDAY_DEFAULTS.deliverWithinMinutes,
        loadTimerBreached: r.loadTimerBreached ?? false,
        deliverTimerBreached: r.deliverTimerBreached ?? false,
        packageCount: routePackages.length,
        deliveredCount: routePackages.filter((p) => p.status === "delivered").length,
        manifestId: r.manifestId,
      };
    });

  return {
    hubId: activeManifest?.hub_id ?? null,
    hubZip: activeManifest?.zip_code ?? null,
    dutTime: activeManifest?.dut_time ?? null,
    operationDate: activeManifest?.operation_date ?? null,
    activeManifestId: manifestId,
    kpi: {
      imported: allPackages.length,
      validated,
      routed,
      loaded,
      delivered,
      attempted: 0,
      rts: 0,
      routeCount: routes.length,
      activeRouteCount,
    },
    notReady,
    readyToDispatch,
    inException,
    activeRoutes,
  };
}

export function manifestHasBlockingHolds(manifestId: string): { blocked: boolean; count: number } {
  const row = queryOne<{ cnt: number }>(
    getDb().prepare(`
      SELECT COUNT(*) as cnt FROM packages
      WHERE manifest_id = ?
        AND (quarantine_status = 'hold' OR validation_status IN ('hold', 'duplicate'))
    `),
    manifestId
  );
  const count = row?.cnt ?? 0;
  return { blocked: count > 0, count };
}
