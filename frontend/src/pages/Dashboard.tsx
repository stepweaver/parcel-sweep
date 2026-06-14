import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ManifestSummary, type RouteSummary } from "../api";
import {
  routeHref,
  routeStatusColor,
  routeStatusLabel,
  routeStopsLabel,
  routeSubline,
} from "../utils/routeDisplay";

export function Dashboard() {
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.manifests.list(), api.routes.list()])
      .then(([m, r]) => { setManifests(m); setRoutes(r); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const totalPackages = manifests.reduce((s, m) => s + m.totalPackages, 0);
  const activeRoutes = routes.filter((r) => r.status === "in_delivery").length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Parcel Sweep</div>
          <div className="page-subtitle">Delivery Route Optimizer</div>
        </div>
        <div className="page-header__actions">
          <Link to="/manifests/new">
            <button className="btn-primary">+ Generate Manifest</button>
          </Link>
        </div>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && <div><span className="spinner" /> Loading…</div>}

      {!loading && (
        <>
          <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
            <div className="card stat-card">
              <div className="stat-value">{manifests.length}</div>
              <div className="stat-label">Manifests</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{totalPackages}</div>
              <div className="stat-label">Total Packages</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value" style={{ color: activeRoutes > 0 ? "#da291c" : undefined }}>
                {activeRoutes}
              </div>
              <div className="stat-label">Active Routes</div>
            </div>
          </div>

          <div className="grid-2">
            {/* Manifests panel */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 className="panel-title">Manifests</h2>
                <Link to="/manifests/new" style={{ fontSize: ".85rem" }}>+ New</Link>
              </div>
              {manifests.length === 0 ? (
                <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                  No manifests yet.<br />
                  <Link to="/manifests/new">Generate one to get started.</Link>
                </div>
              ) : (
                <div>
                  {manifests.slice(0, 8).map((m) => {
                    const routeForManifest = routes.find((r) => r.manifestId === m.id);
                    const label = routeForManifest?.routeNumber
                      ? `Route ${routeForManifest.routeNumber}`
                      : `ZIP ${m.zipCode}`;

                    return (
                    <Link
                      key={m.id}
                      to={`/manifests/${m.id}`}
                      className="list-row"
                    >
                      <div className="list-row__main">
                        <strong>{label}</strong>
                        <div className="list-row__sub">
                          {new Date(m.generatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="list-row__meta">
                        <strong>{m.totalPackages}</strong> packages
                      </div>
                    </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Routes panel */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 className="panel-title">Routes</h2>
                <Link to="/admin" style={{ fontSize: ".85rem" }}>Ops view →</Link>
              </div>
              {routes.length === 0 ? (
                <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                  No routes yet.<br />Generate a manifest and start loading.
                </div>
              ) : (
                <div>
                  {routes.slice(0, 8).map((r) => {
                    const subline = routeSubline(r);

                    return (
                      <Link
                        key={r.id}
                        to={routeHref(r)}
                        className="list-row"
                      >
                        <div className="list-row__main">
                          <strong>{r.driverName}</strong>
                          {subline && <div className="list-row__sub">{subline}</div>}
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
          </div>
        </>
      )}
    </div>
  );
}
