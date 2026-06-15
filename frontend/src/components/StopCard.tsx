import type { RouteStopDetail } from "../api";
import { filterFutureNearbyAlerts } from "../utils/nearbyAlerts";
import { NavigateButtons } from "./NavigateButtons";

interface StopCardProps {
  stop: RouteStopDetail;
  allStops?: RouteStopDetail[];
  isActive?: boolean;
  onArrive?: () => void;
  onComplete?: () => void;
}

const statusLabel: Record<string, string> = {
  pending: "Pending",
  arrived: "Arrived",
  complete: "Complete",
};

const statusColor: Record<string, string> = {
  pending: "#6b7280",
  arrived: "#f59e0b",
  complete: "#16a34a",
};

function formatDrive(seconds: number, miles: number): string {
  const mins = Math.round(seconds / 60);
  return `${miles} mi · ${mins} min`;
}

export function StopCard({ stop, allStops, isActive, onArrive, onComplete }: StopCardProps) {
  const totalPkgs = stop.packages.reduce((s, p) => s + p.packageCount, 0);
  const visibleAlerts = allStops
    ? filterFutureNearbyAlerts(stop.alerts, stop.sequenceNumber, allStops)
    : stop.alerts;

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${isActive ? "#da291c" : statusColor[stop.status] ?? "#ccc"}`,
        marginBottom: ".75rem",
        background: isActive ? "#fff8f8" : undefined,
      }}
    >
      <div className="stop-card__header">
        <span className="stop-card__title">
          #{stop.sequenceNumber} · {stop.packages[0]?.address ?? "Unknown address"}
          {stop.packages.length > 1 && (
            <span style={{ color: "#6b7280", fontWeight: 400, fontSize: ".85rem" }}>
              {" "}+{stop.packages.length - 1} more
            </span>
          )}
        </span>
        <span className="stop-card__status" style={{ color: statusColor[stop.status] }}>
          {statusLabel[stop.status]}
        </span>
      </div>

      <div style={{ color: "#6b7280", fontSize: ".85rem", marginBottom: ".4rem" }}>
        {stop.sequenceNumber === 1 ? "From depot" : formatDrive(stop.driveSecondsFromPrev, stop.driveMilesFromPrev)}
        {" · "}
        <strong>{totalPkgs}</strong> {totalPkgs === 1 ? "package" : "packages"}
      </div>

      <div className="text-wrap" style={{ fontSize: ".85rem", marginBottom: visibleAlerts.length ? ".4rem" : 0 }}>
        {stop.packages.map((p) => (
          <div key={p.id} style={{ color: "#374151" }}>
            {p.address} — <em>{p.recipientName}</em>
            {p.isGhost && (
              <span className="badge badge-ghost" style={{ marginLeft: ".4rem" }}>Ghost</span>
            )}
          </div>
        ))}
      </div>

      {visibleAlerts.length > 0 && (
        <div className="text-wrap" style={{ background: "#fffbeb", border: "1px solid #fde047", borderRadius: 6, padding: ".5rem .75rem", fontSize: ".82rem", color: "#92400e" }}>
          {visibleAlerts.map((a, i) => <div key={i}>⚠ {a}</div>)}
        </div>
      )}

      {stop.packages[0] && (
        <div style={{ marginTop: ".5rem" }}>
          <NavigateButtons
            target={{
              lat: stop.centroid.lat,
              lng: stop.centroid.lng,
              address: `${stop.packages[0].address}, ${stop.packages[0].city}, ${stop.packages[0].state} ${stop.packages[0].zip}`,
            }}
            size="sm"
          />
        </div>
      )}

      {(onArrive || onComplete) && stop.status !== "complete" && (
        <div style={{ display: "flex", gap: ".5rem", marginTop: ".75rem" }}>
          {onArrive && stop.status === "pending" && (
            <button className="btn-primary" style={{ fontSize: ".85rem", padding: ".35rem .9rem" }} onClick={onArrive}>
              Arrived
            </button>
          )}
          {onComplete && stop.status !== "pending" && (
            <button className="btn-success" style={{ fontSize: ".85rem", padding: ".35rem .9rem" }} onClick={onComplete}>
              All Delivered ✓
            </button>
          )}
        </div>
      )}
    </div>
  );
}
