/** Station and driver defaults for South Bend operations. */

/** Future role-based landing: "/" for general ops, "/sunday" for supervisor role. */
export const DEFAULT_LANDING = "/" as const;

export interface StationPreset {
  id: string;
  name: string;
  address: string;
  /** Approximate coordinates for autocomplete biasing. */
  coords: { lat: number; lng: number };
}

export const STATIONS: StationPreset[] = [
  {
    id: "chippewa",
    name: "Chippewa",
    address: "4015 S Main St, South Bend, IN 46614",
    coords: { lat: 41.6520, lng: -86.2511 },
  },
  {
    id: "mckinley",
    name: "McKinley Ave",
    address: "3800 McKinley Ave, South Bend, IN 46628",
    coords: { lat: 41.7012, lng: -86.2638 },
  },
];

export const DEFAULT_STATION = STATIONS[0];

/** Default service area for autocomplete biasing (South Bend operations). */
export const SERVICE_AREA = {
  city: "South Bend",
  state: "IN",
  center: { lat: 41.6764, lng: -86.252 },
} as const;

export const DEFAULT_DRIVER_NAMES = ["Driver 1", "Driver 2", "Driver 3"];

export const SUNDAY_DEFAULTS = {
  maxRouteDurationMinutes: 300,
  maxPackagesPerRoute: 80,
  maxStopsPerRoute: 40,
  loadWithinMinutes: 15,
  deliverWithinMinutes: 45,
  multiZipCodes: ["46614", "46628"],
} as const;

const DRIVER_STORAGE_KEY = "parcel-sweep:recent-drivers";

export function getRecentDrivers(): string[] {
  try {
    const raw = localStorage.getItem(DRIVER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_DRIVER_NAMES];
    const parsed = JSON.parse(raw) as string[];
    return parsed.length > 0 ? parsed : [...DEFAULT_DRIVER_NAMES];
  } catch {
    return [...DEFAULT_DRIVER_NAMES];
  }
}

export function rememberDriver(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const recent = getRecentDrivers().filter((d) => d !== trimmed);
  recent.unshift(trimmed);
  localStorage.setItem(DRIVER_STORAGE_KEY, JSON.stringify(recent.slice(0, 8)));
}
