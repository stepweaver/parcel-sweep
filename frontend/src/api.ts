// Typed API helpers — all requests proxy through Vite to localhost:3000

export interface ManifestSummary {
  id: string;
  zipCode: string;
  generatedAt: string;
  totalPackages: number;
  status: string;
}

export interface PackageDetail {
  id: string;
  manifestId: string;
  trackingNumber: string;
  recipientName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  packageCount: number;
  serviceType: string;
  weightOz: number;
  status: "pending" | "scanned" | "loaded" | "in_route" | "delivered";
  isGhost: boolean;
  createdAt: string;
  scannedAt: string | null;
  deliveredAt: string | null;
}

export interface RouteStopDetail {
  id: string;
  routeId: string;
  sequenceNumber: number;
  clusterId: string;
  centroid: { lat: number; lng: number };
  driveSecondsFromPrev: number;
  driveMilesFromPrev: number;
  alerts: string[];
  geometry: [number, number][] | null;
  status: "pending" | "arrived" | "complete";
  arrivedAt: string | null;
  completedAt: string | null;
  packages: PackageDetail[];
}

export interface RouteDetail {
  id: string;
  manifestId: string;
  driverName: string;
  vehicleId: string | null;
  status: "loading" | "optimized" | "in_delivery" | "complete";
  startAddress: string;
  startLat: number | null;
  startLng: number | null;
  clusterMeters: number;
  alertMeters: number;
  createdAt: string;
  optimizedAt: string | null;
  completedAt: string | null;
  stops: RouteStopDetail[];
}

export interface RouteSummary {
  id: string;
  manifestId: string;
  driverName: string;
  status: string;
  startAddress: string;
  createdAt: string;
  optimizedAt: string | null;
  stopCount: number;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Manifests ────────────────────────────────────────────────

export const api = {
  manifests: {
    list: () => apiFetch<ManifestSummary[]>("/api/manifests"),
    get: (id: string) =>
      apiFetch<{ manifest: ManifestSummary; packages: PackageDetail[] }>(`/api/manifests/${id}`),
    generate: (zipCode: string, count: number) =>
      apiFetch<{ manifest: ManifestSummary; packages: PackageDetail[] }>("/api/manifests/generate", {
        method: "POST",
        body: JSON.stringify({ zipCode, count }),
      }),
    delete: (id: string) => apiFetch<{ deleted: string }>(`/api/manifests/${id}`, { method: "DELETE" }),
  },

  routes: {
    list: () => apiFetch<RouteSummary[]>("/api/routes"),
    get: (id: string) => apiFetch<RouteDetail>(`/api/routes/${id}`),
    create: (data: {
      manifestId: string;
      startAddress: string;
      driverName?: string;
      vehicleId?: string;
      clusterMeters?: number;
      alertMeters?: number;
    }) => apiFetch<RouteDetail>("/api/routes", { method: "POST", body: JSON.stringify(data) }),
    scan: (id: string, trackingNumber: string) =>
      apiFetch<{ package: PackageDetail; isGhost: boolean; message: string }>(
        `/api/routes/${id}/scan`,
        { method: "POST", body: JSON.stringify({ trackingNumber }) }
      ),
    optimize: (id: string) =>
      apiFetch<RouteDetail>(`/api/routes/${id}/optimize`, { method: "POST", body: "{}" }),
    start: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/routes/${id}/start`, { method: "PUT", body: "{}" }),
    stopArrive: (routeId: string, stopId: string) =>
      apiFetch<{ success: boolean }>(`/api/routes/${routeId}/stops/${stopId}/arrive`, { method: "PUT", body: "{}" }),
    stopComplete: (routeId: string, stopId: string) =>
      apiFetch<{ success: boolean; remainingStops: number }>(
        `/api/routes/${routeId}/stops/${stopId}/complete`,
        { method: "PUT", body: "{}" }
      ),
    gps: (routeId: string, data: { lat: number; lng: number; heading?: number; speedMph?: number }) =>
      apiFetch<{ pingId: string; proximityAlerts: string[] }>(
        `/api/routes/${routeId}/gps`,
        { method: "POST", body: JSON.stringify(data) }
      ),
  },
};
