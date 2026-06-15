import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APP_THEME_OPTIONS,
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  readStoredAppThemePreference,
  resolveAppTheme,
  type AppThemePreference,
  type ResolvedAppTheme,
} from "../utils/appTheme";

interface ThemeContextValue {
  preference: AppThemePreference;
  resolved: ResolvedAppTheme;
  setPreference: (preference: AppThemePreference) => void;
  options: typeof APP_THEME_OPTIONS;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppThemePreference>(readStoredAppThemePreference);
  const resolved = useMemo(() => resolveAppTheme(preference), [preference]);

  useEffect(() => {
    applyAppTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppTheme(resolveAppTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: AppThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, options: APP_THEME_OPTIONS }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within ThemeProvider");
  }
  return ctx;
}
