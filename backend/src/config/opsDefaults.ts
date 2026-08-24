/** Default capacity and timing targets for hub-and-spoke delivery operations. */

export const OPS_DEFAULTS = {
  maxPackagesPerRoute: 80,
  maxStopsPerRoute: 40,
  maxRouteDurationMinutes: 300,
  dwellSecondsPerStop: 120,
  loadWithinMinutes: 15,
  deliverWithinMinutes: 45,
  multiZipCodes: ["46614", "46628"],
  maxWeightOz: 1120,
  maxDimensionIn: 108,
  maxGirthIn: 130,
} as const;

export type OpsDefaults = typeof OPS_DEFAULTS;
