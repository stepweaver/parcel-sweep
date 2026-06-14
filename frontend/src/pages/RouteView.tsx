import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type RouteDetail } from "../api";
import { DeliveryMap } from "../components/DeliveryMap";
import { StopCard } from "../components/StopCard";

export function RouteView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.routes.get(id)
      .then(setRoute)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStart = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.routes.start(id);
      navigate(`/routes/${id}/drive`);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
      setStarting(false);
    }
  };

  if (loading) return <div className="page"><span className="spinner" /> Loading…</div>;
  if (error) return <div className="page" style={{ color: "#dc2626" }}>Error: {error}</div>;
  if (!route) return null;

  const totalDriveMin = Math.round(route.stops.reduce((s, stop) => s + stop.driveSecondsFromPrev, 0) / 60);
  const totalMiles = Math.round(route.stops.reduce((s, stop) => s + stop.driveMilesFromPrev, 0) * 10) / 10;
  const totalPkgs = route.stops.reduce((s, stop) => s + stop.packages.reduce((ss, p) => ss + p.packageCount, 0), 0);
  const alertStops = route.stops.filter((s) => s.alerts.length > 0).length;

  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: "wrap", gap: ".75rem" }}>
        <Link to={`/routes/${id}/load`}>← Loading Dock</Link>
        <div>
          <div className="page-title">Route Plan</div>
          <div style={{ color: "#6b7280", fontSize: ".85rem" }}>
            {route.driverName} · {route.stops.length} stops · {totalPkgs} packages
          </div>
        </div>
        <button
          className="btn-danger"
          style={{ marginLeft: "auto" }}
          onClick={handleStart}
          disabled={starting || route.status !== "optimized"}
        >
          {starting ? <><span className="spinner" /> Starting…</> : "Start Delivery 🚚"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
        <div className="card stat-card"><div className="stat-value">{route.stops.length}</div><div className="stat-label">Stops</div></div>
        <div className="card stat-card"><div className="stat-value">{totalMiles}</div><div className="stat-label">Total Miles</div></div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: alertStops > 0 ? "#f59e0b" : undefined }}>{alertStops}</div>
          <div className="stat-label">Alert Stops</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "1rem", alignItems: "start" }}>
        {/* Stop list */}
        <div style={{ overflowY: "auto", maxHeight: "72vh" }}>
          {/* Depot card */}
          <div className="card" style={{ marginBottom: ".75rem", borderLeft: "4px solid #6b7280" }}>
            <strong>#0 · DEPOT</strong>
            <div style={{ color: "#6b7280", fontSize: ".85rem" }}>{route.startAddress}</div>
          </div>
          {route.stops.map((stop) => (
            <StopCard key={stop.id} stop={stop} />
          ))}
          <div style={{ color: "#6b7280", fontSize: ".85rem", textAlign: "center", padding: "1rem" }}>
            Est. {totalDriveMin} min · {totalMiles} miles total driving
          </div>
        </div>

        {/* Map */}
        <div style={{ height: "72vh", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
          <DeliveryMap
            stops={route.stops}
            clusterMeters={route.clusterMeters}
            style={{ height: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}
