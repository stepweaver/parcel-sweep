import { getDb } from "../db/index.js";
import { queryAll } from "../db/helpers.js";
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

  return rows.map((r) => {
    const inDelivery = r.status === "in_delivery";
    const next = inDelivery ? nextStopByRoute.get(r.id) : undefined;

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
    };
  });
}
