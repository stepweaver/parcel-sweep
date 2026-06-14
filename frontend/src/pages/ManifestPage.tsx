import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type ManifestSummary, type PackageDetail, type RouteSummary } from "../api";
import { PackageList } from "../components/PackageList";
import {
  DEFAULT_STATION,
  STATIONS,
  getRecentDrivers,
  rememberDriver,
} from "../config/operations";

export function ManifestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isNew = id === "new";

  const [zipCode, setZipCode] = useState("46614");
  const [count, setCount] = useState(40);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [manifest, setManifest] = useState<ManifestSummary | null>(null);
  const [packages, setPackages] = useState<PackageDetail[]>([]);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  const [stationId, setStationId] = useState(DEFAULT_STATION.id);
  const [customAddress, setCustomAddress] = useState("");
  const [driverName, setDriverName] = useState(() => getRecentDrivers()[0] ?? "Driver 1");
  const [routeNumber, setRouteNumber] = useState("");
  const [creating, setCreating] = useState(false);

  const selectedStation = STATIONS.find((s) => s.id === stationId);
  const startAddress = stationId === "custom"
    ? customAddress
    : (selectedStation?.address ?? DEFAULT_STATION.address);

  useEffect(() => {
    if (isNew || !id) return;
    Promise.all([api.manifests.get(id), api.routes.list()])
      .then(([{ manifest: m, packages: p }, r]) => {
        setManifest(m);
        setPackages(p);
        setRoutes(r);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const handleGenerate = async () => {
    setGenerating(true); setGenError(null);
    try {
      const { manifest: m, packages: p } = await api.manifests.generate(zipCode, count);
      navigate(`/manifests/${m.id}`);
      setManifest(m); setPackages(p);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleStartRoute = async () => {
    if (!manifest) return;
    setCreating(true);
    try {
      rememberDriver(driverName);
      const route = await api.routes.create({
        manifestId: manifest.id,
        startAddress,
        driverName,
        routeNumber: routeNumber.trim(),
      });
      navigate(`/routes/${route.id}/load`);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  if (isNew) {
    return (
      <div className="page">
        <div className="page-header">
          <Link to="/">← Dashboard</Link>
          <div className="page-title">Generate Manifest</div>
        </div>

        <div className="card" style={{ maxWidth: 480 }}>
          <h2 className="panel-title" style={{ marginBottom: "1rem" }}>
            Fetch real addresses from OpenStreetMap
          </h2>

          <label style={{ display: "block", marginBottom: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>ZIP Code</div>
            <input
              type="text"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              placeholder="5-digit ZIP"
              maxLength={5}
            />
          </label>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem" }}>Number of Packages (1–200)</div>
            <input
              type="number"
              value={count}
              min={1} max={200}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>

          {genError && (
            <div style={{ color: "#dc2626", marginBottom: ".75rem", fontSize: ".9rem" }}>{genError}</div>
          )}

          <button className="btn-primary" onClick={handleGenerate} disabled={generating || zipCode.length !== 5}>
            {generating ? <><span className="spinner" /> Fetching from OSM…</> : "Generate Manifest"}
          </button>

          <div className="text-muted" style={{ marginTop: "1rem", fontSize: ".82rem" }}>
            Uses the free Overpass / OpenStreetMap API. Generation may take 5–15 seconds.
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><span className="spinner" /> Loading…</div>;
  if (error) return <div className="page" style={{ color: "#dc2626" }}>Error: {error}</div>;
  if (!manifest) return null;

  const pendingCount = packages.filter((p) => p.status === "pending").length;
  const loadedCount = packages.filter((p) => ["loaded", "in_route"].includes(p.status)).length;
  const deliveredCount = packages.filter((p) => p.status === "delivered").length;
  const manifestRoute = routes.find((r) => r.manifestId === manifest.id);
  const manifestLabel = manifestRoute?.routeNumber
    ? `Route ${manifestRoute.routeNumber}`
    : `ZIP ${manifest.zipCode}`;

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/">← Dashboard</Link>
        <div>
          <div className="page-title">Manifest — {manifestLabel}</div>
          <div style={{ color: "#6b7280", fontSize: ".85rem" }}>
            {new Date(manifest.generatedAt).toLocaleString()} · {manifest.totalPackages} packages
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
        <div className="card stat-card"><div className="stat-value">{pendingCount}</div><div className="stat-label">Pending</div></div>
        <div className="card stat-card"><div className="stat-value">{loadedCount}</div><div className="stat-label">Loaded</div></div>
        <div className="card stat-card"><div className="stat-value">{deliveredCount}</div><div className="stat-label">Delivered</div></div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="panel-title" style={{ marginBottom: "1rem" }}>Start a Loading Session</h2>
        <div className="grid-2">
          <label>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Loading Dock / Station</div>
            <select value={stationId} onChange={(e) => setStationId(e.target.value)} style={{ width: "100%" }}>
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.address}</option>
              ))}
              <option value="custom">Custom address…</option>
            </select>
          </label>
          <label>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Driver Name</div>
            <input
              type="text"
              list="manifest-driver-suggestions"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
            <datalist id="manifest-driver-suggestions">
              {getRecentDrivers().map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Route Number</div>
            <input
              type="text"
              value={routeNumber}
              onChange={(e) => setRouteNumber(e.target.value)}
              placeholder="e.g. 401"
            />
          </label>
        </div>
        {stationId === "custom" && (
          <label style={{ display: "block", marginTop: ".75rem" }}>
            <div style={{ fontWeight: 600, marginBottom: ".25rem", fontSize: ".9rem" }}>Custom station address</div>
            <input
              type="text"
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder={DEFAULT_STATION.address}
            />
          </label>
        )}
        <button
          className="btn-primary"
          style={{ marginTop: "1rem" }}
          onClick={handleStartRoute}
          disabled={creating || !startAddress.trim() || !routeNumber.trim()}
        >
          {creating ? <><span className="spinner" /> Creating…</> : "Start Loading Session →"}
        </button>
      </div>

      <div className="card">
        <h2 className="panel-title" style={{ marginBottom: "1rem" }}>All Packages</h2>
        <PackageList packages={packages} />
      </div>
    </div>
  );
}
