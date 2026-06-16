import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type PackageDetail, type RouteDetail, type LoadOrderResponse } from "../api";
import { ScannerInput } from "../components/ScannerInput";
import { PackageList } from "../components/PackageList";
import { LoadOrderList } from "../components/LoadOrderList";
import { SessionSettings } from "../components/SessionSettings";
import { PageShell } from "../components/PageShell";

interface ScanResult {
  isGhost: boolean;
  message: string;
  address: string;
}

export function LoadingDock() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [routePackages, setRoutePackages] = useState<PackageDetail[]>([]);
  const [packagesScoped, setPackagesScoped] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [beginningTour, setBeginningTour] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadOrder, setLoadOrder] = useState<LoadOrderResponse | null>(null);
  const [loadOrderLoading, setLoadOrderLoading] = useState(false);
  const [loadOrderError, setLoadOrderError] = useState<string | null>(null);

  const loadRoute = async (routeId: string) => {
    const [r, { packages, scoped }] = await Promise.all([
      api.routes.get(routeId),
      api.routes.packages(routeId),
    ]);
    setRoute(r);
    setRoutePackages(packages);
    setPackagesScoped(scoped);
  };

  const fetchLoadOrder = async (routeId: string) => {
    setLoadOrderLoading(true);
    setLoadOrderError(null);
    try {
      const order = await api.routes.loadOrder(routeId);
      setLoadOrder(order);
    } catch (e) {
      setLoadOrderError((e as Error).message);
      setLoadOrder(null);
    } finally {
      setLoadOrderLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    loadRoute(id).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
    void fetchLoadOrder(id);
  }, [id]);

  const handleScan = async (trackingNumber: string) => {
    if (!id || scanning) return;
    setScanning(true);
    try {
      const result = await api.routes.scan(id, trackingNumber);
      setScanHistory((prev) => [{
        isGhost: result.isGhost,
        message: result.message,
        address: result.package.address,
      }, ...prev]);
      await loadRoute(id);
      void fetchLoadOrder(id);
    } catch (e) {
      setScanHistory((prev) => [{
        isGhost: true,
        message: `Error: ${(e as Error).message}`,
        address: "—",
      }, ...prev]);
    } finally {
      setScanning(false);
    }
  };

  const handleScanClick = async (pkg: PackageDetail) => {
    await handleScan(pkg.trackingNumber);
  };

  const handleRemovePackage = async (pkg: PackageDetail) => {
    if (!id) return;
    const label = pkg.isGhost ? "Remove this ghost package from the truck?" : "Remove this package from the truck?";
    if (!confirm(label)) return;
    try {
      if (pkg.isGhost) {
        await api.routes.removePackage(id, pkg.id);
      } else {
        await api.routes.unload(id, pkg.id);
      }
      await loadRoute(id);
      void fetchLoadOrder(id);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
  };

  const handleSessionUpdated = async (updated: RouteDetail) => {
    setRoute(updated);
    const { packages, scoped } = await api.routes.packages(updated.id);
    setRoutePackages(packages);
    setPackagesScoped(scoped);
    if (id) void fetchLoadOrder(id);
  };

  const handleBeginTour = async () => {
    if (!id) return;
    setBeginningTour(true);
    try {
      await api.routes.optimize(id);
      navigate(`/routes/${id}/route`);
    } catch (e) {
      alert(`Could not begin tour: ${(e as Error).message}`);
    } finally {
      setBeginningTour(false);
    }
  };

  if (loading) {
    return (
      <PageShell title="Loading Dock" documentTitle="Loading Dock">
        <span className="spinner" /> Loading…
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell title="Loading Dock" documentTitle="Loading Dock">
        <div style={{ color: "#dc2626" }}>Error: {error}</div>
      </PageShell>
    );
  }
  if (!route) return null;

  const loadedPackages = routePackages.filter((p) => ["loaded", "in_route"].includes(p.status));
  const pendingPackages = routePackages.filter((p) => p.status === "pending" && !p.isGhost);
  const ghostPackages = routePackages.filter((p) => p.isGhost);

  const isLoading = route.status === "loading";

  const loadElapsed = route.loadedAt
    ? Math.round((Date.now() - new Date(route.loadedAt).getTime()) / 60000)
    : null;

  return (
    <PageShell
      title="Loading Dock"
      documentTitle={`Loading Dock — ${route.driverName}`}
      backLink={<Link to={`/manifests/${route.manifestId}`}>← Manifest</Link>}
      subtitle={
        <span className="text-wrap">
          {route.driverName} · {route.startAddress}
        </span>
      }
      actions={
        <>
          <span className="page-header__meta">
            {loadedPackages.length} loaded
          </span>
          <button
            className="btn-primary"
            disabled={beginningTour || loadedPackages.length === 0}
            onClick={handleBeginTour}
          >
            {beginningTour ? <><span className="spinner" /> Preparing tour…</> : "Begin Tour →"}
          </button>
        </>
      }
    >

      {isLoading && route.dutTime && (
        <div className="card dispatch-timers" style={{ marginBottom: "1rem" }}>
          <div><strong>DUT:</strong> {route.dutTime}</div>
          {route.loadedAt && (
            <div>
              <strong>Load timer:</strong> {loadElapsed ?? 0} min
              {loadElapsed != null && route.loadWithinMinutes && loadElapsed > route.loadWithinMinutes && (
                <span style={{ color: "#dc2626", marginLeft: ".5rem" }}>
                  — exceeds {route.loadWithinMinutes}m target
                </span>
              )}
            </div>
          )}
          {!route.loadedAt && (
            <div className="text-muted">First scan starts the 15-minute load window</div>
          )}
        </div>
      )}

      {isLoading && (
        <SessionSettings route={route} onUpdated={handleSessionUpdated} />
      )}

      {isLoading && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: ".75rem" }} className="panel-title">Scanner</div>
          <ScannerInput onScan={handleScan} disabled={scanning} />
          {scanHistory.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: "auto" }} aria-live="polite" aria-relevant="additions">
              {scanHistory.map((r, i) => (
                <div
                  key={i}
                  className={r.isGhost ? "scan-result scan-result--warn" : "scan-result scan-result--ok"}
                >
                  {r.isGhost ? "⚠ " : "✓ "}{r.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h2 className="panel-title" style={{ marginBottom: ".35rem" }}>
            {packagesScoped ? "Your route" : "Manifest"} ({pendingPackages.length} to scan)
          </h2>
          {packagesScoped && (
            <div style={{ color: "#6b7280", fontSize: ".82rem", marginBottom: "1rem" }}>
              Packages assigned to {route.driverName}
              {route.routeNumber ? ` · Route ${route.routeNumber}` : ""}. Scan each one onto the truck.
            </div>
          )}
          <PackageList
            packages={pendingPackages}
            onScan={isLoading ? handleScanClick : undefined}
            showScanButton={isLoading}
            emptyMessage="All packages scanned!"
          />
        </div>

        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".75rem", gap: ".5rem", flexWrap: "wrap" }}>
              <h2 className="panel-title" style={{ margin: 0 }}>
                Truck Load Order
              </h2>
              <button
                className="btn-ghost"
                style={{ fontSize: ".8rem", padding: ".25rem .6rem" }}
                disabled={loadOrderLoading}
                onClick={() => id && void fetchLoadOrder(id)}
              >
                {loadOrderLoading ? "Updating…" : "Refresh"}
              </button>
            </div>
            <div style={{ color: "#6b7280", fontSize: ".82rem", marginBottom: ".75rem" }}>
              Load packages in this order — <strong>#1 goes deepest in the truck</strong>, last item is your first delivery.
            </div>
            {loadOrderError && (
              <div style={{ color: "#92400e", fontSize: ".85rem", marginBottom: ".75rem" }}>
                {loadOrderError}
              </div>
            )}
            {loadOrderLoading && !loadOrder ? (
              <span className="spinner" />
            ) : loadOrder ? (
              <LoadOrderList items={loadOrder.items} source={loadOrder.source} compact />
            ) : null}
          </div>

          <div className="card" style={{ marginBottom: "1rem" }}>
            <h2 className="panel-title" style={{ marginBottom: "1rem" }}>
              Loaded ({loadedPackages.length} packages)
            </h2>
            <PackageList
              packages={loadedPackages}
              onRemove={isLoading ? handleRemovePackage : undefined}
              showRemoveButton={isLoading}
              emptyMessage="Scan packages to add them here."
            />
          </div>

          {ghostPackages.length > 0 && (
            <div className="card" style={{ borderLeft: "4px solid #f59e0b" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: ".5rem", color: "#92400e" }}>
                ⚠ Ghost Packages ({ghostPackages.length})
              </h2>
              <div style={{ fontSize: ".85rem", color: "#92400e", marginBottom: ".75rem" }}>
                These tracking numbers were not found in the manifest. They will be included in the route at their best-estimated location.
              </div>
              {ghostPackages.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "monospace", fontSize: ".8rem", padding: ".3rem 0", borderBottom: "1px solid var(--border)" }}>
                  <span>{p.trackingNumber}</span>
                  {isLoading && (
                    <button
                      className="btn-ghost"
                      style={{ color: "#dc2626", fontSize: ".75rem", padding: ".15rem .4rem" }}
                      onClick={() => void handleRemovePackage(p)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
