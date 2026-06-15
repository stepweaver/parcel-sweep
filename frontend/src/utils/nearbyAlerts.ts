import type { RouteStopDetail } from "../api";

/** Keep only nearby alerts that reference packages at later stops in the route. */
export function filterFutureNearbyAlerts(
  alerts: string[],
  fromSequenceNumber: number,
  allStops: RouteStopDetail[],
): string[] {
  if (!alerts.length) return [];

  const futureAddressNeedles = new Set<string>();
  for (const stop of allStops) {
    if (stop.sequenceNumber <= fromSequenceNumber) continue;
    for (const pkg of stop.packages) {
      futureAddressNeedles.add(`${pkg.address}, ${pkg.city}, ${pkg.state} ${pkg.zip}`);
      futureAddressNeedles.add(pkg.address);
    }
  }

  if (futureAddressNeedles.size === 0) return [];

  return alerts.filter((alert) =>
    [...futureAddressNeedles].some((addr) => alert.includes(addr)),
  );
}
