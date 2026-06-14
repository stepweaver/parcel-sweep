import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, type RouteDetail, type LoadOrderResponse } from "../api";
import { DeliveryMap } from "../components/DeliveryMap";
import { StopCard } from "../components/StopCard";
import { LoadOrderList } from "../components/LoadOrderList";
import { ExportButtons } from "../components/NavigateButtons";
import { googleMapsFullRouteUrl, openExternal } from "../utils/navigationLinks";

export function RouteView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadOrder, setLoadOrder] = useState<LoadOrderResponse | null>(null);
  const [showLoadOrder, setShowLoadOrder] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.routes.get(id)
      .then(setRoute)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    api.routes.loadOrder(id).then(setLoadOrder).catch(() => {});
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
  const canExport = route.stops.length > 0;

  const openFullRouteInGoogle = () => {
    if (!route.startLat || !route.startLng) return;
    const url = googleMapsFullRouteUrl(
      { lat: route.startLat, lng: route.startLng, address: route.startAddress },
      route.stops.map((s) => s.centroid)
    );
    openExternal(url);
  };

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
          className="btn-danger page-header__actions"
          onClick={handleStart}
          disabled={starting || route.status !== "optimized"}
        >
          {starting ? <><span className="spinner" /> Starting…</> : "Start Delivery 🚚"}
        </button>
      </div>

      {/* Export + navigation toolbar */}
      <div className="card route-toolbar" style={{ marginBottom: "1.5rem" }}>
        <div className="route-toolbar__section">
          <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: ".35rem" }}>Export route</div>
          <ExportButtons routeId={route.id} disabled={!canExport} />
        </div>
        <div className="route-toolbar__section route-toolbar__section--bordered">
          <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: ".35rem" }}>External GPS</div>
          <button
            className="btn-primary"
            style={{ fontSize: ".85rem" }}
            disabled={!canExport || route.startLat == null}
            onClick={openFullRouteInGoogle}
          >
            Open full route in Google Maps
          </button>
        </div>
        <div className="route-toolbar__spacer">
          <button
            className="btn-ghost"
            style={{ fontSize: ".85rem" }}
            onClick={() => setShowLoadOrder((v) => !v)}
          >
            {showLoadOrder ? "Hide" : "Show"} truck load order
          </button>
        </div>
      </div>

      {showLoadOrder && loadOrder && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 className="panel-title" style={{ marginBottom: ".75rem" }}>Truck Load Order (reverse delivery sequence)</h2>
          <LoadOrderList items={loadOrder.items} source={loadOrder.source} />
        </div>
      )}

      {/* Summary cards */}
      <div className="grid-3" style={{ marginBottom: "1.5rem" }}>
        <div className="card stat-card"><div className="stat-value">{route.stops.length}</div><div className="stat-label">Stops</div></div>
        <div className="card stat-card"><div className="stat-value">{totalMiles}</div><div className="stat-label">Total Miles</div></div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: alertStops > 0 ? "#f59e0b" : undefined }}>{alertStops}</div>
          <div className="stat-label">Alert Stops</div>
        </div>
      </div>

      <div className="route-split">
        {/* Stop list */}
        <div className="route-split__stops">
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
        <div className="route-split__map">
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
