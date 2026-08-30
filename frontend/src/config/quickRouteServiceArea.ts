/** Quick Route delivery-stop service area. Distinct from OPS_DEFAULTS.multiZipCodes. */
export const QUICK_ROUTE_SERVICE_AREA = {
  city: "South Bend",
  state: "IN",
  zipCodes: ["46613", "46614"] as const,
  center: { lat: 41.6555, lng: -86.2505 },
} as const;

export const QUICK_ROUTE_ZIP_SET: ReadonlySet<string> = new Set(
  QUICK_ROUTE_SERVICE_AREA.zipCodes
);
