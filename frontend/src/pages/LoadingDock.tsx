import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type PackageDetail, type RouteDetail } from "../api";
import { ScannerInput } from "../components/ScannerInput";
import { PackageList } from "../components/PackageList";

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

  const loadRoute = async (routeId: string) => {
    const r = await api.routes.get(routeId);
    setRoute(r);
    const { packages } = await api.manifests.get(r.manifestId);
    setManifestPackages(packages);
  };

  useEffect(() => {
    if (!id) return;
    loadRoute(id).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
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
          <div style={{ color: "#6b7280", fontSize: ".85rem" }}>
            {route.driverName} · {route.startAddress}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: ".75rem", alignItems: "center" }}>
          <span style={{ color: "#6b7280", fontSize: ".9rem" }}>
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
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: ".75rem", fontSize: "1rem" }}>Scanner</div>
          <ScannerInput onScan={handleScan} disabled={scanning} />
          {scanHistory.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              {scanHistory.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: ".4rem .6rem",
                    borderRadius: 6,
                    marginBottom: ".3rem",
                    background: r.isGhost ? "#fffbeb" : "#f0fdf4",
                    borderLeft: `4px solid ${r.isGhost ? "#f59e0b" : "#16a34a"}`,
                    fontSize: ".88rem",
                  }}
                >
                  {r.isGhost ? "⚠ " : "✓ "}{r.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid-2">
        {/* Left — manifest packages to scan */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>
            Manifest ({pendingPackages.length} remaining)
          </h2>
          <PackageList
            packages={pendingPackages}
            onScan={isLoading ? handleScanClick : undefined}
            showScanButton={isLoading}
            emptyMessage="All packages scanned!"
          />
        </div>

        {/* Right — scanned packages */}
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>
              Loaded ({loadedPackages.length} packages)
            </h2>
            <PackageList packages={loadedPackages} emptyMessage="Scan packages to add them here." />
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
                <div key={p.id} style={{ fontFamily: "monospace", fontSize: ".8rem", padding: ".3rem 0", borderBottom: "1px solid var(--border)" }}>
                  {p.trackingNumber}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
