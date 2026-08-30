/**
 * Quick Route delivery-stop service area.
 *
 * Distinct from OPS_DEFAULTS.multiZipCodes (manifest routing), which currently
 * includes 46614 and 46628. Delivery stops in this phase are limited to South
 * Bend 46613 and 46614. Start/depot addresses may still be outside this area.
 */
export const QUICK_ROUTE_SERVICE_AREA = {
  city: "South Bend",
  state: "IN",
  zipCodes: ["46613", "46614"] as const,
  center: { lat: 41.6555, lng: -86.2505 },
  /** Envelope covering 46613/46614 with a small margin. Excludes Fort Wayne, Chicago, etc. */
  bounds: {
    minLat: 41.615,
    maxLat: 41.688,
    minLng: -86.305,
    maxLng: -86.205,
  },
} as const;

export type QuickRouteZip = (typeof QUICK_ROUTE_SERVICE_AREA.zipCodes)[number];

export const QUICK_ROUTE_ZIP_SET: ReadonlySet<string> = new Set(
  QUICK_ROUTE_SERVICE_AREA.zipCodes
);

/** Photon bbox: minLon,minLat,maxLon,maxLat */
export const QUICK_ROUTE_PHOTON_BBOX = [
  QUICK_ROUTE_SERVICE_AREA.bounds.minLng,
  QUICK_ROUTE_SERVICE_AREA.bounds.minLat,
  QUICK_ROUTE_SERVICE_AREA.bounds.maxLng,
  QUICK_ROUTE_SERVICE_AREA.bounds.maxLat,
].join(",");

/** Nominatim viewbox: left,top,right,bottom */
export const QUICK_ROUTE_NOMINATIM_VIEWBOX = [
  QUICK_ROUTE_SERVICE_AREA.bounds.minLng,
  QUICK_ROUTE_SERVICE_AREA.bounds.maxLat,
  QUICK_ROUTE_SERVICE_AREA.bounds.maxLng,
  QUICK_ROUTE_SERVICE_AREA.bounds.minLat,
].join(",");
