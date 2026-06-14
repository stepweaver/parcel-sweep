import { MAP_THEMES, type MapThemeId } from "../utils/mapThemes";

interface MapThemeSelectorProps {
  themeId: MapThemeId;
  onChange: (id: MapThemeId) => void;
  /** Compact styling for drive-mode map overlay. */
  variant?: "default" | "overlay";
  className?: string;
}

export function MapThemeSelector({
  themeId,
  onChange,
  variant = "default",
  className = "",
}: MapThemeSelectorProps) {
  return (
    <label className={`map-theme-select map-theme-select--${variant} ${className}`.trim()}>
      <span className="map-theme-select__label">Map style</span>
      <select
        className="map-theme-select__control"
        value={themeId}
        aria-label="Map style"
        onChange={(e) => {
          const next = e.target.value;
          if (MAP_THEMES.some((t) => t.id === next)) {
            onChange(next as MapThemeId);
          }
        }}
      >
        {MAP_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
