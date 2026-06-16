import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SundayDashboardResponse } from "../api";
import { PageShell } from "../components/PageShell";
import { routeStageHref } from "../utils/routeDisplay";

const POLL_MS = 15_000;

function demoRouteHref(data: SundayDashboardResponse): string | null {
  const delivery = data.activeRoutes.find((r) => r.status === "in_delivery");
  if (delivery) return `/routes/${delivery.routeId}/drive?demo=1`;
  const optimized = data.activeRoutes.find((r) => r.status === "optimized");
  if (optimized) return `/routes/${optimized.routeId}/drive?demo=1`;
  return null;
}

export function SundayDashboard() {
  const [data, setData] = useState<SundayDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const dash = await api.admin.sundayDashboard();
      setData(dash);
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

  const demoHref = data ? demoRouteHref(data) : null;

  return (
    <PageShell
      title="Sunday Hub Operations Dashboard"
      subtitle={
        <>
          HUB: {data?.hubId ?? "—"} {data?.hubZip ? `· ZIP ${data.hubZip}` : ""}
          {data?.dutTime ? ` · DUT ${data.dutTime}` : ""}
          {data?.operationDate ? ` · ${data.operationDate}` : ""}
        </>
      }
      documentTitle="Sunday Hub"
      actions={
        <>
          {lastUpdated && (
            <span className="page-header__meta">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="btn-ghost" onClick={() => void refresh(false)}>Refresh</button>
        </>
      }
    >
      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && !data && <span className="spinner" />}

      {data && (
        <>
          <section className="card sunday-quick-actions" aria-label="Quick actions" style={{ marginBottom: "1.5rem" }}>
            <h2 className="panel-title" style={{ marginBottom: ".75rem" }}>Quick Actions</h2>
            <div className="sunday-quick-actions__row">
              <Link to="/manifests/new" className="btn-primary">Import Manifest</Link>
              {data.activeManifestId ? (
                <Link to={`/manifests/${data.activeManifestId}`} className="btn-ghost">Review Holds</Link>
              ) : (
                <span className="btn-ghost" style={{ opacity: 0.5, pointerEvents: "none" }}>Review Holds</span>
              )}
              <Link to="/admin" className="btn-ghost">Fleet View</Link>
              {demoHref ? (
                <Link to={demoHref} className="btn-ghost">Run Driver Demo</Link>
              ) : (
                <span className="btn-ghost" style={{ opacity: 0.5, pointerEvents: "none" }} title="Create and optimize a route first">
                  Run Driver Demo
                </span>
              )}
            </div>
          </section>

          <section className="card sunday-projected-strip" aria-label="Projected versus actual" style={{ marginBottom: "1.5rem" }}>
            <h2 className="panel-title" style={{ marginBottom: ".75rem" }}>Projected vs. Actual</h2>
            <div className="sunday-kpi-strip">
              <div><strong>{data.kpi.routeCount}</strong><span>Routes planned</span></div>
              <div><strong>{data.kpi.imported}</strong><span>Parcels released</span></div>
              <div><strong>{data.kpi.loaded}</strong><span>Loaded</span></div>
              <div><strong>{data.kpi.delivered}</strong><span>Delivered</span></div>
              <div><strong>{data.kpi.activeRouteCount}</strong><span>On street</span></div>
              <div><strong>{data.inException.length}</strong><span>Exceptions</span></div>
            </div>
          </section>

          <div className="sunday-kpi-strip card" style={{ marginBottom: "1.5rem" }}>
            <div><strong>{data.kpi.imported}</strong><span>Imported</span></div>
            <div><strong>{data.kpi.validated}</strong><span>Validated</span></div>
            <div><strong>{data.kpi.routed}</strong><span>Routed</span></div>
            <div><strong>{data.kpi.loaded}</strong><span>Loaded</span></div>
            <div><strong>{data.kpi.delivered}</strong><span>Delivered</span></div>
            <div><strong>{data.kpi.attempted}</strong><span>Attempted</span></div>
            <div><strong>{data.kpi.rts}</strong><span>RTS</span></div>
          </div>

          {data.activeRoutes.length > 0 && (
            <section className="card" aria-label="Route readiness clocks" style={{ marginBottom: "1.5rem" }}>
              <h2 className="panel-title" style={{ marginBottom: ".75rem" }}>Route Readiness Clocks</h2>
              <p className="text-muted" style={{ fontSize: ".85rem", marginBottom: "1rem" }}>
                USPS Sunday targets: load within 15 minutes of begin tour · first delivery within 45 minutes.
              </p>
              <div className="readiness-clocks">
                {data.activeRoutes.map((r) => (
                  <div key={r.routeId} className={`readiness-clock ${r.loadTimerBreached || r.deliverTimerBreached ? "readiness-clock--breach" : ""}`}>
                    <div className="readiness-clock__header">
                      <strong>
                        Route {r.routeNumber ?? "—"} · {r.driverName}
                      </strong>
                      <span className="text-meta">{r.status}</span>
                    </div>
                    <div className="readiness-clock__row">
                      <span>DUT:</span> <strong>{r.dutTime ?? "—"}</strong>
                    </div>
                    <div className="readiness-clock__row">
                      <span>Load:</span>{" "}
                      {r.loadedAt ? (
                        <strong className={r.loadTimerBreached ? "text-danger" : ""}>
                          {r.loadElapsedMinutes ?? 0} / {r.loadWithinMinutes} min
                        </strong>
                      ) : (
                        <span className="text-muted">awaiting first scan</span>
                      )}
                    </div>
                    <div className="readiness-clock__row">
                      <span>Deliver:</span>{" "}
                      {r.beginTourAt ? (
                        <strong className={r.deliverTimerBreached ? "text-danger" : ""}>
                          {r.deliverElapsedMinutes ?? 0} / {r.deliverWithinMinutes} min
                        </strong>
                      ) : (
                        <span className="text-muted">not dispatched</span>
                      )}
                    </div>
                    <div className="readiness-clock__row">
                      <span>Progress:</span>{" "}
                      <strong>{r.deliveredCount} / {r.packageCount} delivered</strong>
                    </div>
                    <Link to={routeStageHref(r.routeId, r.status)} className="readiness-clock__link">
                      Open route →
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="sunday-tower grid-3">
            <section className="card sunday-lane sunday-lane--not-ready">
              <h2 className="panel-title">Not Ready</h2>
              {data.notReady.length === 0 ? (
                <p className="text-muted">No blockers</p>
              ) : (
                <ul className="sunday-lane__list">
                  {data.notReady.map((item, i) => (
                    <li key={i}>
                      <span className="sunday-lane__count">{item.count}</span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card sunday-lane sunday-lane--ready">
              <h2 className="panel-title">Ready to Dispatch</h2>
              {data.readyToDispatch.length === 0 ? (
                <p className="text-muted">No routes ready</p>
              ) : (
                <ul className="sunday-lane__list">
                  {data.readyToDispatch.map((r) => (
                    <li key={r.routeId}>
                      <Link to={`/routes/${r.routeId}/route`}>
                        Route {r.routeNumber ?? "—"} · {r.driverName} · {r.packageCount} pk
                      </Link>
                      {r.loadElapsedMinutes != null && (
                        <span className="text-meta"> · load {r.loadElapsedMinutes}m</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card sunday-lane sunday-lane--exception">
              <h2 className="panel-title">In Exception</h2>
              {data.inException.length === 0 ? (
                <p className="text-muted">No active exceptions</p>
              ) : (
                <ul className="sunday-lane__list">
                  {data.inException.map((item, i) => (
                    <li key={i}>
                      {item.routeId ? (
                        <Link to={`/routes/${item.routeId}/load`}>{item.label}</Link>
                      ) : (
                        item.label
                      )}
                      {item.detail && <span className="text-meta"> · {item.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </PageShell>
  );
}
