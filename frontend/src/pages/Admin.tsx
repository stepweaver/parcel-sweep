import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ManifestSummary, type RouteSummary } from "../api";
import { PageShell } from "../components/PageShell";
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
  const [manifests, setManifests] = useState<ManifestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [routeData, manifestData] = await Promise.all([
        api.admin.routes(),
        api.manifests.list(),
      ]);
      setRoutes(sortRoutesForOps(routeData));
      setManifests(manifestData);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (showSpinner) setLoading(false);
    }
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
      await refresh(false);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    void refresh(true);
    const id = window.setInterval(() => { void refresh(false); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const activeRoutes = routes.filter((r) => r.status === "in_delivery");
  const remainingStops = activeRoutes.reduce((sum, r) => sum + r.remainingStops, 0);

  return (
    <PageShell
      title="Routes & Drivers"
      subtitle={
        <>
          Live fleet view
          {lastUpdated && (
            <span style={{ color: "var(--text-muted)", marginLeft: ".5rem" }}>
              · updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </>
      }
      documentTitle="Routes & Drivers"
      actions={
        <button className="btn-ghost" onClick={() => void refresh(true)} disabled={loading}>
          Refresh
        </button>
      }
    >
      {error && <div style={{ color: "#dc2626", marginBottom: "1rem" }}>Error: {error}</div>}
      {loading && routes.length === 0 && <div><span className="spinner" /> Loading…</div>}

      {!loading || routes.length > 0 ? (
        <>
          <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
            <div className="card stat-card">
              <div className="stat-value" style={{ color: activeRoutes.length > 0 ? "#da291c" : undefined }}>
                {activeRoutes.length}
              </div>
              <div className="stat-label">Drivers on Tour</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{remainingStops}</div>
              <div className="stat-label">Stops Remaining</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{routes.length}</div>
              <div className="stat-label">Active Routes</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Manifests</h2>
            {manifests.length === 0 ? (
              <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                No manifests yet. <Link to="/manifests/new">Import a manifest</Link>
              </div>
            ) : (
              <div>
                {manifests.map((m) => {
                  const manifestRoutes = routes.filter((r) => r.manifestId === m.id);
                  return (
                    <div key={m.id} className="list-row">
                      <Link to={`/manifests/${m.id}`} className="list-row__main" style={{ textDecoration: "none", color: "inherit" }}>
                        <strong>ZIP {m.zipCode}</strong>
                        <div className="list-row__sub">
                          {new Date(m.generatedAt).toLocaleString()}
                          {manifestRoutes.length > 0 && ` · ${manifestRoutes.length} route${manifestRoutes.length === 1 ? "" : "s"}`}
                        </div>
                      </Link>
                      <div className="list-row__meta" style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                        <span>{m.totalPackages} pkg</span>
                        <button
                          className="btn-ghost"
                          style={{ color: "#dc2626", fontSize: ".8rem", padding: ".25rem .5rem" }}
                          disabled={deletingId === m.id}
                          onClick={() => void handleDeleteManifest(m)}
                        >
                          {deletingId === m.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Drivers on Tour</h2>
            {routes.length === 0 ? (
              <div className="text-meta" style={{ textAlign: "center", padding: "1.5rem" }}>
                No routes yet. Plan routes from a manifest to assign drivers.
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
    </PageShell>
  );
}
