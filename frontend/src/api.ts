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
  assignedRouteId: string | null;
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
  routeNumber: string | null;
  driverName: string;
  vehicleId: string | null;
  status: "loading" | "optimized" | "in_delivery" | "complete";
  startAddress: string;
  startLat: number | null;
  startLng: number | null;
  clusterMeters: number;
  alertMeters: number;
  returnDriveSeconds: number;
  returnDriveMiles: number;
  createdAt: string;
  optimizedAt: string | null;
  completedAt: string | null;
  stops: RouteStopDetail[];
}

export interface RouteSummary {
  id: string;
  manifestId: string;
  routeNumber: string | null;
  driverName: string;
  status: string;
  startAddress: string;
  createdAt: string;
  optimizedAt: string | null;
  stopCount: number;
  remainingStops: number;
  nextStopAddress: string | null;
  nextStopDriveSeconds: number | null;
  nextStopDriveMiles: number | null;
}

export interface LoadOrderItem {
  loadPosition: number;
  deliverySequence: number;
  stopId: string | null;
  address: string;
  packages: PackageDetail[];
  loaded: boolean;
}

export interface LoadOrderResponse {
  source: "optimized" | "preview";
  totalStops: number;
  items: LoadOrderItem[];
}

export interface RouteProposalStop {
  sequenceNumber: number;
  clusterId: string;
  centroid: { lat: number; lng: number };
  driveSecondsFromPrev: number;
  driveMilesFromPrev: number;
  alerts: string[];
  packageIds: string[];
}

export interface RouteProposal {
  proposalId: string;
  label: string;
  stopCount: number;
  packageCount: number;
  estimatedDriveSeconds: number;
  estimatedDriveMiles: number;
  returnDriveSeconds: number;
  returnDriveMiles: number;
  stops: RouteProposalStop[];
  packageIds: string[];
}

export interface ProposeRoutesResponse {
  start: { address: string; lat: number; lng: number };
  settings: {
    clusterMeters: number;
    alertMeters: number;
    driverCount: number;
    maxPackagesPerRoute: number;
    maxStopsPerRoute: number;
  };
  summary: {
    totalPackages: number;
    totalStops: number;
    proposalCount: number;
    unassignedPackages: number;
    alreadyAssignedPackages: number;
  };
  proposals: RouteProposal[];
}

export interface CreatedRouteFromProposal {
  id: string;
  manifestId: string;
  routeNumber: string | null;
  driverName: string;
  status: string;
  startAddress: string;
  assignedPackageCount: number;
  proposalId: string;
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
    routes: (id: string) => apiFetch<RouteSummary[]>(`/api/manifests/${id}/routes`),
    proposeRoutes: (id: string, data: {
      startAddress: string;
      driverCount: number;
      clusterMeters?: number;
      alertMeters?: number;
      maxPackagesPerRoute?: number;
      maxStopsPerRoute?: number;
    }) =>
      apiFetch<ProposeRoutesResponse>(`/api/manifests/${id}/propose-routes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    createRouteFromProposal: (id: string, data: {
      startAddress: string;
      routeNumber: string;
      driverName?: string;
      vehicleId?: string;
      clusterMeters?: number;
      alertMeters?: number;
      proposal: RouteProposal;
    }) =>
      apiFetch<CreatedRouteFromProposal>(`/api/manifests/${id}/routes/from-proposal`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },

  routes: {
    list: () => apiFetch<RouteSummary[]>("/api/routes"),
    get: (id: string) => apiFetch<RouteDetail>(`/api/routes/${id}`),
    create: (data: {
      manifestId: string;
      startAddress: string;
      routeNumber: string;
      driverName?: string;
      vehicleId?: string;
      clusterMeters?: number;
      alertMeters?: number;
    }) => apiFetch<RouteDetail>("/api/routes", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: {
      driverName?: string;
      startAddress?: string;
      manifestId?: string;
    }) => apiFetch<RouteDetail>(`/api/routes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    unload: (id: string, packageId: string) =>
      apiFetch<{ success: boolean; packageId: string }>(
        `/api/routes/${id}/unload`,
        { method: "POST", body: JSON.stringify({ packageId }) }
      ),
    removePackage: (routeId: string, packageId: string) =>
      apiFetch<{ success: boolean; packageId: string }>(
        `/api/routes/${routeId}/packages/${packageId}`,
        { method: "DELETE" }
      ),
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
    loadOrder: (id: string) =>
      apiFetch<LoadOrderResponse>(`/api/routes/${id}/load-order`),
    exportUrl: (id: string, format: "gpx" | "kml" | "csv") =>
      `/api/routes/${id}/export/${format}`,
  },

  admin: {
    routes: () => apiFetch<RouteSummary[]>("/api/admin/routes"),
  },
};
