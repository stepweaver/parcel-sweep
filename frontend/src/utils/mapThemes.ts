export type MapThemeId =
  | "carto-voyager"
  | "carto-positron"
  | "carto-dark"
  | "osm"
  | "esri-satellite";

export interface MapTheme {
  id: MapThemeId;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Omit for single-host tile servers (e.g. Esri). */
  subdomains?: string;
}

export const DEFAULT_MAP_THEME_ID: MapThemeId = "carto-voyager";

export const MAP_THEMES: MapTheme[] = [
  {
    id: "carto-voyager",
    label: "CARTO Voyager",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd",
  },
  {
    id: "carto-positron",
    label: "CARTO Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd",
  },
  {
    id: "carto-dark",
    label: "CARTO Night",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd",
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    subdomains: "abc",
  },
  {
    id: "esri-satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    maxZoom: 19,
  },
];

const THEME_BY_ID = new Map(MAP_THEMES.map((t) => [t.id, t]));

export function isMapThemeId(value: string): value is MapThemeId {
  return THEME_BY_ID.has(value as MapThemeId);
}

export function getMapTheme(id: MapThemeId): MapTheme {
  return THEME_BY_ID.get(id) ?? THEME_BY_ID.get(DEFAULT_MAP_THEME_ID)!;
}
