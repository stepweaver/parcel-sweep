/** USPS Sunday operations defaults (hub-and-spoke, DRT-style). */

export const SUNDAY_DEFAULTS = {
  maxRouteDurationMinutes: 300,
  maxPackagesPerRoute: 80,
  maxStopsPerRoute: 40,
  dwellSecondsPerStop: 120,
  loadWithinMinutes: 15,
  deliverWithinMinutes: 45,
  multiZipCodes: ["46614", "46628"],
  maxWeightOz: 1120,
  maxDimensionIn: 108,
  maxGirthIn: 130,
} as const;

export type SundayDefaults = typeof SUNDAY_DEFAULTS;
