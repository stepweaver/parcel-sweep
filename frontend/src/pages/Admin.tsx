import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RouteSummary } from "../api";
import {
  formatDriveEta,
  routeHref,
  routeStatusColor,
  routeStatusLabel,
  routeStopsLabel,
  routeSubline,
  sortRoutesForOps,
} from "../utils/routeDisplay";

const POLL_MS = 15_000;

export function Admin() {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await api.admin.routes();
      setRoutes(sortRoutesForOps(data));
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const id = window.setInterval(() => { void refresh(false); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const activeRoutes = routes.filter((r) => r.status === "in_delivery");
  const remainingStops = activeRoutes.reduce((sum, r) => sum + r.remainingStops, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Operations</div>
          <div className="page-subtitle">
            Live fleet view
            {lastUpdated && (
              <span style={{ color: "var(--text-muted)", marginLeft: ".5rem" }}>
                · updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn-ghost" onClick={() => void refresh(true)} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && routes.length === 0 && <div><span className="spinner" /> Loading…</div>}

      {!loading || routes.length > 0 ? (
        <>
          <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
            <div className="card stat-card">
              <div className="stat-value" style={{ color: activeRoutes.length > 0 ? "#da291c" : undefined }}>
                {activeRoutes.length}
              </div>
              <div className="stat-label">Active Drivers</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{remainingStops}</div>
              <div className="stat-label">Stops Remaining</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{routes.length}</div>
              <div className="stat-label">Total Routes</div>
            </div>
          </div>

          <div className="card">
            <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Drivers</h2>
            {routes.length === 0 ? (
              <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                No routes yet.
              </div>
            ) : (
              <div>
                {routes.map((r) => {
                  const driveEta = r.status === "in_delivery"
                    ? formatDriveEta(r.nextStopDriveSeconds, r.nextStopDriveMiles)
                    : null;
                  const subline = routeSubline(r);

                  return (
                    <Link key={r.id} to={routeHref(r)} className="list-row">
                      <div className="list-row__main">
                        <strong>{r.driverName}</strong>
                        {subline && <div className="list-row__sub">{subline}</div>}
                        {driveEta && (
                          <div className="list-row__sub" style={{ color: "var(--text-label)" }}>
                            {driveEta} drive
                          </div>
                        )}
                      </div>
                      <div className="list-row__meta">
                        <span
                          className="list-row__status"
                          style={{ color: routeStatusColor[r.status] ?? "#6b7280" }}
                        >
                          {routeStatusLabel[r.status] ?? r.status}
                        </span>
                        <div className="list-row__meta-sub">{routeStopsLabel(r)}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
