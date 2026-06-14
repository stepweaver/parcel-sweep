import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ManifestSummary, type RouteSummary } from "../api";

const statusColor: Record<string, string> = {
  loading: "#f59e0b",
  optimized: "#3b82f6",
  in_delivery: "#da291c",
  complete: "#16a34a",
};

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
          <div style={{ color: "#6b7280", fontSize: ".9rem" }}>Delivery Route Optimizer</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: ".75rem" }}>
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
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Manifests</h2>
                <Link to="/manifests/new" style={{ fontSize: ".85rem" }}>+ New</Link>
              </div>
              {manifests.length === 0 ? (
                <div style={{ color: "#9ca3af", textAlign: "center", padding: "1.5rem" }}>
                  No manifests yet.<br />
                  <Link to="/manifests/new">Generate one to get started.</Link>
                </div>
              ) : (
                <div>
                  {manifests.slice(0, 8).map((m) => (
                    <Link
                      key={m.id}
                      to={`/manifests/${m.id}`}
                      style={{ display: "flex", justifyContent: "space-between", padding: ".6rem .2rem", borderBottom: "1px solid var(--border)", color: "inherit", textDecoration: "none" }}
                    >
                      <div>
                        <strong>ZIP {m.zipCode}</strong>
                        <div style={{ color: "#6b7280", fontSize: ".8rem" }}>
                          {new Date(m.generatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong>{m.totalPackages}</strong> packages
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Routes panel */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Routes</h2>
              </div>
              {routes.length === 0 ? (
                <div style={{ color: "#9ca3af", textAlign: "center", padding: "1.5rem" }}>
                  No routes yet.<br />Generate a manifest and start loading.
                </div>
              ) : (
                <div>
                  {routes.slice(0, 8).map((r) => (
                    <Link
                      key={r.id}
                      to={r.status === "in_delivery" || r.status === "optimized" ? `/routes/${r.id}/drive` : `/routes/${r.id}/load`}
                      style={{ display: "flex", justifyContent: "space-between", padding: ".6rem .2rem", borderBottom: "1px solid var(--border)", color: "inherit", textDecoration: "none" }}
                    >
                      <div>
                        <strong>{r.driverName}</strong>
                        <div style={{ color: "#6b7280", fontSize: ".8rem" }}>
                          {r.startAddress.slice(0, 35)}…
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ color: statusColor[r.status] ?? "#6b7280", fontWeight: 700, fontSize: ".85rem" }}>
                          {r.status}
                        </span>
                        <div style={{ color: "#6b7280", fontSize: ".8rem" }}>{r.stopCount} stops</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
