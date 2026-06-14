import { Cluster } from "../types/index.js";
import { haversineMeters } from "./clusterer.js";

/**
 * For each cluster in the ordered route, check every stop that belongs to
 * a *different* cluster.  If any of those stops falls within `alertMeters`
 * of the current cluster's centroid, add a human-readable alert.
 *
 * Returns a parallel array of string arrays — one per cluster in the order
 * given by `orderedClusters`.
 */
export function generateAlerts(
  orderedClusters: Cluster[],
  alertMeters: number
): string[][] {
  return orderedClusters.map((current, idx) => {
    const alerts: string[] = [];
    const seenAddresses = new Set<string>();

    for (let other = 0; other < orderedClusters.length; other++) {
      if (other === idx) continue;

      const otherCluster = orderedClusters[other];

      for (const stop of otherCluster.stops) {
        const dist = haversineMeters(current.centroid, stop);

        if (dist <= alertMeters && !seenAddresses.has(stop.address)) {
          seenAddresses.add(stop.address);
          const distFormatted =
            dist < 1000
              ? `${Math.round(dist)} m`
              : `${(dist / 1000).toFixed(2)} km`;
          alerts.push(
            `Nearby package on same block: "${stop.address}" (${distFormatted} away, ${otherCluster.clusterId})`
          );
        }
      }
    }

    return alerts;
  });
}
