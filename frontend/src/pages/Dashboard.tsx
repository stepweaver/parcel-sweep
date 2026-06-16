import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { api, type ManifestSummary, type RouteSummary, type SundayDashboardResponse } from "../api";
import { PageShell } from "../components/PageShell";
import { WorkflowStepper } from "../components/WorkflowStepper";
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
  const [sunday, setSunday] = useState<SundayDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      api.manifests.list(),
      api.routes.list(),
      api.admin.sundayDashboard().catch(() => null),
    ])
      .then(([m, r, s]) => {
        setManifests(m);
        setRoutes(r);
        setSunday(s);
      });

  useEffect(() => {
    refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDeleteManifest = async (manifest: ManifestSummary) => {
    const manifestRoutes = routes.filter((r) => r.manifestId === manifest.id);
    const activeCount = manifestRoutes.filter((r) => r.status === "in_delivery").length;
    const routeNote = manifestRoutes.length
      ? `\n\nThis will also delete ${manifestRoutes.length} route${manifestRoutes.length === 1 ? "" : "s"}.`
      : "";
    const activeNote = activeCount
      ? `\n\nWarning: ${activeCount} route${activeCount === 1 ? " is" : "s are"} still in delivery.`
      : "";

    if (
      !confirm(
        `Delete manifest ZIP ${manifest.zipCode} (${manifest.totalPackages} packages)?${routeNote}${activeNote}\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(manifest.id);
    try {
      await api.manifests.delete(manifest.id);
      setManifests((prev) => prev.filter((m) => m.id !== manifest.id));
      setRoutes((prev) => prev.filter((r) => r.manifestId !== manifest.id));
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const totalPackages = manifests.reduce((s, m) => s + m.totalPackages, 0);
  const activeRoutes = routes.filter((r) => r.status === "in_delivery").length;
  const exceptionCount = sunday?.inException.length ?? 0;

  return (
    <PageShell
      title="Parcel Sweep"
      subtitle="Delivery Route Optimizer"
      documentTitle="Dashboard"
      actions={
        <>
          <NavLink to="/sunday" className="btn-primary">
            Sunday Hub
          </NavLink>
          <NavLink to="/manifests/new" className="btn-ghost">
            Import Manifest
          </NavLink>
        </>
      }
    >
      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && <div><span className="spinner" /> Loading…</div>}

      {!loading && (
        <>
          <section className="card sunday-hub-card" aria-labelledby="sunday-hub-heading" style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <h2 id="sunday-hub-heading" className="panel-title" style={{ marginBottom: ".35rem" }}>
                  Sunday Hub Operations
                </h2>
                <p className="text-muted" style={{ fontSize: ".85rem", margin: 0 }}>
                  Supervisor control tower for Amazon Sunday parcel delivery — manifests, routes, drivers, and exceptions.
                </p>
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <NavLink to="/sunday" className="btn-primary">Open Sunday Hub →</NavLink>
                <NavLink to="/manifests/new" className="btn-ghost">Import Sunday manifest →</NavLink>
              </div>
            </div>
            {sunday && (
              <div className="sunday-hub-card__stats" style={{ marginTop: "1rem" }}>
                <span><strong>{sunday.kpi.imported}</strong> imported</span>
                <span><strong>{sunday.kpi.validated}</strong> validated</span>
                <span><strong>{sunday.kpi.routed}</strong> routed</span>
                <span><strong>{sunday.kpi.delivered}</strong> delivered</span>
                <span><strong>{sunday.kpi.activeRouteCount}</strong> active routes</span>
                {exceptionCount > 0 && (
                  <span style={{ color: "#f59e0b" }}><strong>{exceptionCount}</strong> exceptions</span>
                )}
              </div>
            )}
          </section>

          <div style={{ marginBottom: "1.5rem" }}>
            <WorkflowStepper manifests={manifests} routes={routes} />
          </div>

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
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 className="panel-title">Manifests</h2>
                <Link to="/manifests/new" style={{ fontSize: ".85rem" }}>Import new</Link>
              </div>
              {manifests.length === 0 ? (
                <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                  No manifests yet.<br />
                  <Link to="/manifests/new">Import a Sunday manifest to get started.</Link>
                </div>
              ) : (
                <div>
                  {manifests.slice(0, 8).map((m) => {
                    const manifestRoutes = routes.filter((r) => r.manifestId === m.id);
                    const label = manifestRoutes.length === 1 && manifestRoutes[0]?.routeNumber
                      ? `Route ${manifestRoutes[0].routeNumber}`
                      : manifestRoutes.length > 1
                        ? `ZIP ${m.zipCode} · ${manifestRoutes.length} routes`
                        : `ZIP ${m.zipCode}`;

                    return (
                    <div key={m.id} className="list-row">
                      <Link
                        to={`/manifests/${m.id}`}
                        className="list-row__main"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <strong>{label}</strong>
                        <div className="list-row__sub">
                          {new Date(m.generatedAt).toLocaleString()}
                        </div>
                      </Link>
                      <div className="list-row__meta" style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                        <strong>{m.totalPackages}</strong> packages
                        <button
                          className="btn-ghost"
                          style={{ color: "#dc2626", fontSize: ".8rem", padding: ".25rem .5rem" }}
                          disabled={deletingId === m.id}
                          onClick={() => void handleDeleteManifest(m)}
                        >
                          {deletingId === m.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 className="panel-title">Routes</h2>
                <Link to="/admin" style={{ fontSize: ".85rem" }}>Routes &amp; Drivers →</Link>
              </div>
              {routes.length === 0 ? (
                <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                  No routes yet.<br />Import a manifest and plan routes to begin loading.
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
    </PageShell>
  );
}
