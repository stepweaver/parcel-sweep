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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tracking #</th>
            <th>Recipient</th>
            <th>Address</th>
            <th>Service</th>
            <th>Status</th>
            {showScanButton && <th></th>}
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={p.id} className={p.isGhost ? "alert-row" : ""}>
              <td style={{ fontFamily: "monospace", fontSize: ".8rem" }}>
                {p.trackingNumber.slice(0, 8)}…
                {p.isGhost && <span className="badge badge-ghost" style={{ marginLeft: ".4rem" }}>Ghost</span>}
              </td>
              <td>{p.recipientName}</td>
              <td>{p.address}<br /><span style={{ color: "#6b7280", fontSize: ".8rem" }}>{p.city}, {p.state} {p.zip}</span></td>
              <td style={{ fontSize: ".8rem" }}>{p.serviceType}</td>
              <td>
                <span className={`badge ${statusBadge[p.status] ?? "badge-pending"}`}>
                  {p.status}
                </span>
              </td>
              {showScanButton && (
                <td>
                  {p.status === "pending" && onScan && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: ".8rem", padding: ".25rem .6rem" }}
                      onClick={() => onScan(p)}
                    >
                      Scan
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
