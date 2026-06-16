// Typed API helpers — all requests proxy through Vite to localhost:3000

export interface ManifestSummary {
  id: string;
  zipCode: string;
  generatedAt: string;
  totalPackages: number;
  status: string;
  source?: "synthetic" | "csv";
  hubId?: string | null;
  operationDate?: string | null;
  dutTime?: string | null;
  validationSummary?: Record<string, number> | null;
}

export interface PackageDetail {
  id: string;
  manifestId: string;
  assignedRouteId: string | null;
  trackingNumber: string;
  recipientName: string;
  address: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  packageCount: number;
  serviceType: string;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  hazmatFlag?: boolean;
  oversizeFlag?: boolean;
  sundayEligible?: boolean;
  podRequired?: boolean;
  deliveryNotes?: string | null;
  validationStatus?: "verified" | "warning" | "hold" | "duplicate";
  validationReasons?: string[];
  quarantineStatus?: "none" | "hold" | "released";
  overrideNote?: string | null;
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
  beginTourAt?: string | null;
  loadedAt?: string | null;
  departedAt?: string | null;
  dutTime?: string | null;
  loadWithinMinutes?: number;
  deliverWithinMinutes?: number;
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
  beginTourAt?: string | null;
  loadedAt?: string | null;
  departedAt?: string | null;
  loadElapsedMinutes?: number | null;
  deliverElapsedMinutes?: number | null;
  loadTimerBreached?: boolean;
  deliverTimerBreached?: boolean;
  loadedPackageCount?: number;
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

export interface RoutePackagesResponse {
  packages: PackageDetail[];
  scoped: boolean;
}

export interface RouteProposalStop {
  sequenceNumber: number;
  clusterId: string;
  centroid: { lat: number; lng: number };
  driveSecondsFromPrev: number;
  driveMilesFromPrev: number;
  alerts: string[];
  packageIds: string[];
  geometry: [number, number][] | null;
}

export interface RouteProposal {
  proposalId: string;
  label: string;
  stopCount: number;
  packageCount: number;
  estimatedDriveSeconds: number;
  estimatedDriveMiles: number;
  estimatedDurationMinutes: number;
  returnDriveSeconds: number;
  returnDriveMiles: number;
  returnGeometry: [number, number][] | null;
  capacityPercent: number;
  durationFeasible: boolean;
  infeasibilityReasons: string[];
  stops: RouteProposalStop[];
  packageIds: string[];
}

export interface ProposeRoutesResponse {
  start: { address: string; lat: number; lng: number };
  settings: {
    clusterMeters: number;
    effectiveClusterMeters: number;
    matrixSource: "osrm" | "haversine";
    alertMeters: number;
    driverCount: number;
    maxPackagesPerRoute: number;
    maxStopsPerRoute: number;
    maxRouteDurationMinutes: number;
    sundayMode: boolean;
  };
  summary: {
    totalPackages: number;
    totalStops: number;
    proposalCount: number;
    unassignedPackages: number;
    alreadyAssignedPackages: number;
    heldPackages: number;
    idleDrivers: number;
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

export interface ManifestValidationResponse {
  manifest: ManifestSummary;
  summary: Record<string, number>;
  packages: PackageDetail[];
}

export interface SundayDashboardResponse {
  hubId: string | null;
  hubZip: string | null;
  dutTime: string | null;
  operationDate: string | null;
  kpi: {
    imported: number;
    validated: number;
    routed: number;
    loaded: number;
    delivered: number;
    attempted: number;
    rts: number;
  };
  notReady: Array<{ type: string; label: string; count: number; manifestId?: string; routeId?: string }>;
  readyToDispatch: Array<{ routeId: string; routeNumber: string | null; driverName: string; packageCount: number; manifestId: string }>;
  inException: Array<{ type: string; label: string; routeId?: string; manifestId?: string; detail?: string }>;
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_FETCH_ATTEMPTS = 6;
const RETRY_BASE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...options?.headers },
        ...options,
      });

      if (!res.ok) {
        if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_FETCH_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_MS * (attempt + 1));
          continue;
        }
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      const isNetworkError = err instanceof TypeError;
      if (isNetworkError && attempt < MAX_FETCH_ATTEMPTS - 1) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(RETRY_BASE_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("Request failed");
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
    importCsv: (data: {
      csv: string;
      hubZip: string;
      hubId?: string;
      operationDate?: string;
      dutTime?: string;
    }) =>
      apiFetch<{ manifest: ManifestSummary; packages: PackageDetail[]; summary: Record<string, number>; rowCount: number }>(
        "/api/manifests/import",
        { method: "POST", body: JSON.stringify(data) }
      ),
    validation: (id: string) =>
      apiFetch<ManifestValidationResponse>(`/api/manifests/${id}/validation`),
    overridePackage: (manifestId: string, packageId: string, reason: string, actor?: string) =>
      apiFetch<{ package: PackageDetail }>(
        `/api/manifests/${manifestId}/packages/${packageId}/override`,
        { method: "POST", body: JSON.stringify({ reason, actor }) }
      ),
    importTemplateUrl: () => "/api/manifests/import/template",
    delete: (id: string) => apiFetch<{ deleted: string }>(`/api/manifests/${id}`, { method: "DELETE" }),
    routes: (id: string) => apiFetch<RouteSummary[]>(`/api/manifests/${id}/routes`),
    proposeRoutes: (id: string, data: {
      startAddress: string;
      driverCount: number;
      clusterMeters?: number;
      alertMeters?: number;
      maxPackagesPerRoute?: number;
      maxStopsPerRoute?: number;
      maxRouteDurationMinutes?: number;
      sundayMode?: boolean;
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
    packages: (id: string) =>
      apiFetch<RoutePackagesResponse>(`/api/routes/${id}/packages`),
    assignPackages: (id: string, packageIds: string[]) =>
      apiFetch<RoutePackagesResponse & { assigned: number }>(
        `/api/routes/${id}/assign-packages`,
        { method: "POST", body: JSON.stringify({ packageIds }) }
      ),
    exportUrl: (id: string, format: "gpx" | "kml" | "csv") =>
      `/api/routes/${id}/export/${format}`,
  },

  admin: {
    routes: () => apiFetch<RouteSummary[]>("/api/admin/routes"),
    sundayDashboard: () => apiFetch<SundayDashboardResponse>("/api/admin/sunday-dashboard"),
  },
};
