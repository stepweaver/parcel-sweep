import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type PackageDetail, type RouteDetail, type LoadOrderResponse } from "../api";
import { ScannerInput } from "../components/ScannerInput";
import { PackageList } from "../components/PackageList";
import { LoadOrderList } from "../components/LoadOrderList";
import { SessionSettings } from "../components/SessionSettings";

interface ScanResult {
  isGhost: boolean;
  message: string;
  address: string;
}

export function LoadingDock() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [manifestPackages, setManifestPackages] = useState<PackageDetail[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadOrder, setLoadOrder] = useState<LoadOrderResponse | null>(null);
  const [loadOrderLoading, setLoadOrderLoading] = useState(false);
  const [loadOrderError, setLoadOrderError] = useState<string | null>(null);

  const loadRoute = async (routeId: string) => {
    const r = await api.routes.get(routeId);
    setRoute(r);
    const { packages } = await api.manifests.get(r.manifestId);
    setManifestPackages(packages);
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
    const { packages } = await api.manifests.get(updated.manifestId);
    setManifestPackages(packages);
    if (id) void fetchLoadOrder(id);
  };

  const handleOptimize = async () => {
    if (!id) return;
    setOptimizing(true);
    try {
      await api.routes.optimize(id);
      navigate(`/routes/${id}/route`);
    } catch (e) {
      alert(`Optimization failed: ${(e as Error).message}`);
    } finally {
      setOptimizing(false);
    }
  };

  if (loading) return <div className="page"><span className="spinner" /> Loading…</div>;
  if (error) return <div className="page" style={{ color: "#dc2626" }}>Error: {error}</div>;
  if (!route) return null;

  const loadedPackages = manifestPackages.filter((p) => ["loaded", "in_route"].includes(p.status));
  const pendingPackages = manifestPackages.filter((p) => p.status === "pending");
  const ghostPackages = manifestPackages.filter((p) => p.isGhost);

  const isLoading = route.status === "loading";

  return (
    <div className="page">
      <div className="page-header">
        <Link to={`/manifests/${route.manifestId}`}>← Manifest</Link>
        <div>
          <div className="page-title">Loading Dock</div>
          <div className="text-wrap" style={{ color: "#6b7280", fontSize: ".85rem" }}>
            {route.driverName} · {route.startAddress}
          </div>
        </div>
        <div className="page-header__actions">
          <span className="page-header__meta">
            {loadedPackages.length} loaded
          </span>
          <button
            className="btn-primary"
            disabled={optimizing || loadedPackages.length === 0}
            onClick={handleOptimize}
          >
            {optimizing ? <><span className="spinner" /> Optimizing…</> : "Optimize Route →"}
          </button>
        </div>
      </div>

      {isLoading && (
        <SessionSettings route={route} onUpdated={handleSessionUpdated} />
      )}

      {isLoading && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: ".75rem" }} className="panel-title">Scanner</div>
          <ScannerInput onScan={handleScan} disabled={scanning} />
          {scanHistory.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
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
          <h2 className="panel-title" style={{ marginBottom: "1rem" }}>
            Manifest ({pendingPackages.length} remaining)
          </h2>
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
    </div>
  );
}
