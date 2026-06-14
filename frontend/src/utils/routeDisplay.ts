import type { RouteSummary } from "../api";

export const routeStatusColor: Record<string, string> = {
  loading: "#f59e0b",
  optimized: "#3b82f6",
  in_delivery: "#da291c",
  complete: "#16a34a",
};

export const routeStatusLabel: Record<string, string> = {
  loading: "Loading",
  optimized: "Optimized",
  in_delivery: "Active",
  complete: "Complete",
};

export function routeHref(r: RouteSummary): string {
  return r.status === "in_delivery" || r.status === "optimized"
    ? `/routes/${r.id}/drive`
    : `/routes/${r.id}/load`;
}

export function routeSubline(r: RouteSummary): string | null {
  if (r.status === "in_delivery" && r.nextStopAddress) {
    return r.nextStopAddress;
  }
  if (r.routeNumber) return `Route ${r.routeNumber}`;
  return null;
}

export function routeStopsLabel(r: RouteSummary): string {
  if (r.status === "in_delivery") {
    return `${r.remainingStops} left`;
  }
  if (r.status === "complete") {
    return "Done";
  }
  return `${r.stopCount} stops`;
}

export function formatDriveEta(seconds: number | null, miles: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  const time = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (miles != null && miles > 0) {
    return `${miles} mi · ${time}`;
  }
  return time;
}

const STATUS_ORDER: Record<string, number> = {
  in_delivery: 0,
  optimized: 1,
  loading: 2,
  complete: 3,
};

export function sortRoutesForOps(routes: RouteSummary[]): RouteSummary[] {
  return [...routes].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
