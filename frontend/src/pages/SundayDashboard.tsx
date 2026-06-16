import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SundayDashboardResponse } from "../api";

const POLL_MS = 15_000;

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Sunday Operations Dashboard</div>
          <div className="page-subtitle">
            HUB: {data?.hubId ?? "—"} {data?.hubZip ? `· ZIP ${data.hubZip}` : ""}
            {data?.dutTime ? ` · DUT ${data.dutTime}` : ""}
            {data?.operationDate ? ` · ${data.operationDate}` : ""}
          </div>
        </div>
        <div className="page-header__actions">
          {lastUpdated && (
            <span className="page-header__meta">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="btn-ghost" onClick={() => void refresh(false)}>Refresh</button>
        </div>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && !data && <span className="spinner" />}

      {data && (
        <>
          <div className="sunday-kpi-strip card" style={{ marginBottom: "1.5rem" }}>
            <div><strong>{data.kpi.imported}</strong><span>Imported</span></div>
            <div><strong>{data.kpi.validated}</strong><span>Validated</span></div>
            <div><strong>{data.kpi.routed}</strong><span>Routed</span></div>
            <div><strong>{data.kpi.loaded}</strong><span>Loaded</span></div>
            <div><strong>{data.kpi.delivered}</strong><span>Delivered</span></div>
            <div><strong>{data.kpi.attempted}</strong><span>Attempted</span></div>
            <div><strong>{data.kpi.rts}</strong><span>RTS</span></div>
          </div>

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
    </div>
  );
}
