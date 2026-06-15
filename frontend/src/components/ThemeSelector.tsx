import { useAppTheme } from "../context/ThemeProvider";
import { isAppThemePreference } from "../utils/appTheme";

interface ThemeSelectorProps {
  /** Compact styling for drive-mode overlays and tight nav rows. */
  variant?: "default" | "compact" | "overlay";
  className?: string;
}

export function ThemeSelector({ variant = "default", className = "" }: ThemeSelectorProps) {
  const { preference, setPreference, options } = useAppTheme();

  return (
    <label className={`theme-select theme-select--${variant} ${className}`.trim()}>
      <span className="theme-select__label">Theme</span>
      <select
        className="theme-select__control"
        value={preference}
        aria-label="Color theme"
        onChange={(e) => {
          const next = e.target.value;
          if (isAppThemePreference(next)) setPreference(next);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
