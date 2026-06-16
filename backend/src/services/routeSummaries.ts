import { getDb } from "../db/index.js";
import { queryAll } from "../db/helpers.js";
import { SUNDAY_DEFAULTS } from "../config/sundayDefaults.js";
import { RouteRow, RouteSummary } from "../types/index.js";

interface RouteListRow extends RouteRow {
  stop_count: number;
  remaining_stops: number;
}

interface NextStopRow {
  route_id: string;
  drive_seconds_from_prev: number;
  drive_miles_from_prev: number;
  address: string;
  city: string;
  state: string;
  zip: string;
}

function formatStopAddress(row: Pick<NextStopRow, "address" | "city" | "state" | "zip">): string {
  return `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
}

/** Fleet list shape — includes next active stop for routes in delivery. */
export function buildRouteSummaries(): RouteSummary[] {
  const db = getDb();

  const rows = queryAll<RouteListRow>(
    db.prepare(`
      SELECT
        r.*,
        COUNT(DISTINCT rs.id) AS stop_count,
        COUNT(DISTINCT CASE WHEN rs.status != 'complete' THEN rs.id END) AS remaining_stops
      FROM routes r
      LEFT JOIN route_stops rs ON rs.route_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `)
  );

  const nextStopRows = queryAll<NextStopRow>(
    db.prepare(`
      SELECT
        rs.route_id,
        rs.drive_seconds_from_prev,
        rs.drive_miles_from_prev,
        p.address,
        p.city,
        p.state,
        p.zip
      FROM route_stops rs
      INNER JOIN (
        SELECT route_id, MIN(sequence_number) AS min_seq
        FROM route_stops
        WHERE status != 'complete'
        GROUP BY route_id
      ) nxt ON nxt.route_id = rs.route_id AND nxt.min_seq = rs.sequence_number
      INNER JOIN route_stop_packages rsp ON rsp.route_stop_id = rs.id
      INNER JOIN packages p ON p.id = rsp.package_id
      INNER JOIN routes r ON r.id = rs.route_id AND r.status = 'in_delivery'
      ORDER BY rs.route_id, p.address ASC
    `)
  );

  const nextStopByRoute = new Map<string, NextStopRow>();
  for (const row of nextStopRows) {
    if (!nextStopByRoute.has(row.route_id)) {
      nextStopByRoute.set(row.route_id, row);
    }
  }

  const loadedCounts = queryAll<{ route_id: string; cnt: number }>(
    db.prepare(`
      SELECT assigned_route_id as route_id, COUNT(*) as cnt
      FROM packages
      WHERE assigned_route_id IS NOT NULL AND status IN ('loaded', 'in_route')
      GROUP BY assigned_route_id
    `)
  );
  const loadedByRoute = new Map(loadedCounts.map((r) => [r.route_id, r.cnt]));

  return rows.map((r) => {
    const inDelivery = r.status === "in_delivery";
    const next = inDelivery ? nextStopByRoute.get(r.id) : undefined;

    const now = Date.now();
    let loadElapsedMinutes: number | null = null;
    let deliverElapsedMinutes: number | null = null;
    let loadTimerBreached = false;
    let deliverTimerBreached = false;

    if (r.loaded_at) {
      loadElapsedMinutes = Math.round((now - new Date(r.loaded_at).getTime()) / 60000);
      if (r.departed_at) {
        loadElapsedMinutes = Math.round(
          (new Date(r.departed_at).getTime() - new Date(r.loaded_at).getTime()) / 60000
        );
        loadTimerBreached = loadElapsedMinutes > SUNDAY_DEFAULTS.loadWithinMinutes;
      }
    }

    if (r.begin_tour_at && r.status === "in_delivery") {
      deliverElapsedMinutes = Math.round((now - new Date(r.begin_tour_at).getTime()) / 60000);
      const completedStops = r.stop_count - r.remaining_stops;
      if (completedStops === 0 && deliverElapsedMinutes > SUNDAY_DEFAULTS.deliverWithinMinutes) {
        deliverTimerBreached = true;
      }
    }

    return {
      id: r.id,
      manifestId: r.manifest_id,
      routeNumber: r.route_number,
      driverName: r.driver_name,
      status: r.status,
      startAddress: r.start_address,
      createdAt: r.created_at,
      optimizedAt: r.optimized_at,
      stopCount: r.stop_count,
      remainingStops: r.remaining_stops,
      nextStopAddress: next ? formatStopAddress(next) : null,
      nextStopDriveSeconds: next?.drive_seconds_from_prev ?? null,
      nextStopDriveMiles: next?.drive_miles_from_prev ?? null,
      beginTourAt: r.begin_tour_at ?? null,
      loadedAt: r.loaded_at ?? null,
      departedAt: r.departed_at ?? null,
      loadElapsedMinutes,
      deliverElapsedMinutes,
      loadTimerBreached,
      deliverTimerBreached,
      loadedPackageCount: loadedByRoute.get(r.id) ?? 0,
    };
  });
}
