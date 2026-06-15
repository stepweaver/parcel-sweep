export const APP_THEME_STORAGE_KEY = "parcel-sweep-app-theme";

export type AppThemePreference = "light" | "dark" | "system";
export type ResolvedAppTheme = "light" | "dark";

export const APP_THEME_OPTIONS: { id: AppThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function isAppThemePreference(value: string): value is AppThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveAppTheme(preference: AppThemePreference): ResolvedAppTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function readStoredAppThemePreference(): AppThemePreference {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (stored && isAppThemePreference(stored)) return stored;
  } catch {
    /* private browsing / blocked storage */
  }
  return "system";
}

export function applyAppTheme(resolved: ResolvedAppTheme): void {
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0a0f14" : "#004b87");
}
