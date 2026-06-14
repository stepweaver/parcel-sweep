import type { PackageDetail } from "../api";

interface PackageListProps {
  packages: PackageDetail[];
  onScan?: (pkg: PackageDetail) => void;
  showScanButton?: boolean;
  emptyMessage?: string;
}

const statusBadge: Record<string, string> = {
  pending: "badge-pending",
  loaded: "badge-loaded",
  in_route: "badge-in_route",
  delivered: "badge-delivered",
};

export function PackageList({ packages, onScan, showScanButton, emptyMessage = "No packages." }: PackageListProps) {
  if (packages.length === 0) {
    return <div style={{ color: "#9ca3af", textAlign: "center", padding: "2rem" }}>{emptyMessage}</div>;
  }

  return (
    <div className="package-list">
      {packages.map((p) => (
        <div key={p.id} className={`package-row${p.isGhost ? " package-row--ghost" : ""}`}>
          <div className="package-row__main">
            <div className="package-row__top">
              <span className="package-row__tracking">{p.trackingNumber}</span>
              {p.isGhost && <span className="badge badge-ghost">Ghost</span>}
            </div>
            <div className="package-row__recipient">{p.recipientName}</div>
            <div className="package-row__address">
              {p.address}
              <span className="package-row__city">{p.city}, {p.state} {p.zip}</span>
            </div>
          </div>
          <div className="package-row__meta">
            <span className="package-row__service">{p.serviceType}</span>
            <span className={`badge ${statusBadge[p.status] ?? "badge-pending"}`}>
              {p.status}
            </span>
            {showScanButton && p.status === "pending" && onScan && (
              <button
                className="btn-primary package-row__scan"
                onClick={() => onScan(p)}
              >
                Scan
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
