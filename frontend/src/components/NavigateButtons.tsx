import type { CSSProperties } from "react";
import {
  googleMapsStopUrl,
  wazeStopUrl,
  appleMapsStopUrl,
  openExternal,
  type NavTarget,
} from "../utils/navigationLinks";

interface NavigateButtonsProps {
  target: NavTarget;
  size?: "sm" | "md";
  showLabels?: boolean;
}

const BTN: CSSProperties = {
  border: "1px solid var(--border)",
  background: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 700,
  color: "#004b87",
};

export function NavigateButtons({ target, size = "md", showLabels = true }: NavigateButtonsProps) {
  const pad = size === "sm" ? ".25rem .55rem" : ".4rem .75rem";
  const fontSize = size === "sm" ? ".75rem" : ".85rem";

  const buttons = [
    { label: "Google", url: googleMapsStopUrl(target) },
    { label: "Waze", url: wazeStopUrl(target) },
    { label: "Apple", url: appleMapsStopUrl(target) },
  ];

  return (
    <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          style={{ ...BTN, padding: pad, fontSize }}
          onClick={() => openExternal(b.url)}
          title={`Navigate with ${b.label} Maps`}
        >
          {showLabels ? b.label : "→"}
        </button>
      ))}
    </div>
  );
}

interface ExportButtonsProps {
  routeId: string;
  disabled?: boolean;
}

export function ExportButtons({ routeId, disabled }: ExportButtonsProps) {
  const formats = [
    { fmt: "gpx", label: "GPX" },
    { fmt: "kml", label: "KML" },
    { fmt: "csv", label: "CSV" },
  ] as const;

  return (
    <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
      {formats.map(({ fmt, label }) => (
        <a
          key={fmt}
          href={disabled ? undefined : `/api/routes/${routeId}/export/${fmt}`}
          download
          style={{
            ...BTN,
            padding: ".4rem .75rem",
            fontSize: ".85rem",
            textDecoration: "none",
            pointerEvents: disabled ? "none" : undefined,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
