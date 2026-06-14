import type { LoadOrderItem } from "../api";

interface LoadOrderListProps {
  items: LoadOrderItem[];
  source: "optimized" | "preview";
  compact?: boolean;
}

export function LoadOrderList({ items, source, compact = false }: LoadOrderListProps) {
  if (items.length === 0) {
    return (
      <div style={{ color: "#9ca3af", textAlign: "center", padding: "1.5rem" }}>
        No load order available yet.
      </div>
    );
  }

  return (
    <div>
      {source === "preview" && (
        <div style={{
          background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6,
          padding: ".6rem .85rem", fontSize: ".82rem", color: "#1e40af", marginBottom: ".75rem",
        }}>
          Preview based on full manifest. Load <strong>first item at the back</strong> of the truck;
          last item delivers first.
        </div>
      )}

      <div style={{ maxHeight: compact ? 320 : 480, overflowY: "auto" }}>
        {items.map((item) => (
          <div
            key={`${item.loadPosition}-${item.deliverySequence}`}
            style={{
              display: "flex",
              gap: ".75rem",
              alignItems: "flex-start",
              padding: compact ? ".5rem 0" : ".65rem 0",
              borderBottom: "1px solid var(--border)",
              opacity: item.loaded ? 1 : 0.75,
            }}
          >
            <div style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: item.loaded ? "#16a34a" : "#004b87",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: ".85rem",
            }}>
              {item.loadPosition}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: compact ? ".85rem" : ".95rem", wordBreak: "break-word" }}>
                {item.address}
                {item.packages.length > 1 && (
                  <span style={{ color: "#6b7280", fontWeight: 400, fontSize: ".8rem" }}>
                    {" "}+{item.packages.length - 1} addr
                  </span>
                )}
              </div>
              <div style={{ color: "#6b7280", fontSize: ".78rem", marginTop: ".15rem" }}>
                Delivers stop #{item.deliverySequence}
                {" · "}
                {item.packages.reduce((s, p) => s + p.packageCount, 0)} pkg
                {item.loaded ? " · ✓ loaded" : " · pending scan"}
              </div>
              {!compact && item.packages.map((p) => (
                <div key={p.id} style={{ fontSize: ".78rem", color: "#374151", fontFamily: "monospace" }}>
                  {p.trackingNumber.slice(0, 10)}… — {p.recipientName}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
