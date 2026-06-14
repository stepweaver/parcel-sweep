import { useCallback, useState } from "react";
import {
  DEFAULT_MAP_THEME_ID,
  getMapTheme,
  isMapThemeId,
  MAP_THEMES,
  type MapTheme,
  type MapThemeId,
} from "../utils/mapThemes";

const STORAGE_KEY = "parcel-sweep-map-theme";

function readStoredThemeId(): MapThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isMapThemeId(stored)) return stored;
  } catch {
    /* private browsing / blocked storage */
  }
  return DEFAULT_MAP_THEME_ID;
}

export function useMapTheme() {
  const [themeId, setThemeIdState] = useState<MapThemeId>(readStoredThemeId);

  const setThemeId = useCallback((id: MapThemeId) => {
    setThemeIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const theme: MapTheme = getMapTheme(themeId);

  return { themeId, theme, setThemeId, themes: MAP_THEMES };
}
