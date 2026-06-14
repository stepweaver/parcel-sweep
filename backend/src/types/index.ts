// ─────────────────────────────────────────────────────────────
// Request types (existing API)
// ─────────────────────────────────────────────────────────────

export interface StopInput {
  address: string;
  packageCount?: number;
}

export interface OptimizeRouteRequest {
  startAddress: string;
  /** Maximum metres between two stops to be merged into one cluster. Default 50. */
  clusterMeters?: number;
  /** Maximum metres to a stop in another cluster before emitting a nearby-package alert. Default 120. */
  alertMeters?: number;
  stops: StopInput[];
}

// ─────────────────────────────────────────────────────────────
// Internal working types (existing)
// ─────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodedStop {
  address: string;
  packageCount: number;
  lat: number;
  lng: number;
}

export interface Cluster {
  clusterId: string;
  centroid: LatLng;
  stops: GeocodedStop[];
  /** Total packages in cluster */
  totalPackages: number;
}

/** Duration (seconds) + distance (metres) between two nodes */
export interface LegMetrics {
  durationSeconds: number;
  distanceMeters: number;
  /** GeoJSON LineString coordinates [[lng,lat],...] */
  geometry?: [number, number][];
}

// ─────────────────────────────────────────────────────────────
// Response types (existing API)
// ─────────────────────────────────────────────────────────────

export interface RouteStepStop {
  address: string;
  packageCount: number;
  lat: number;
  lng: number;
}

export interface RouteStep {
  sequence: number;
  clusterId: string;
  driveSecondsFromPrevious: number;
  driveMilesFromPrevious: number;
  centroid: LatLng;
  stops: RouteStepStop[];
  alerts: string[];
}

export interface OptimizeRouteResponse {
  start: {
    address: string;
    lat: number;
    lng: number;
  };
  settings: {
    clusterMeters: number;
    alertMeters: number;
  };
  summary: {
    totalInputStops: number;
    totalClusters: number;
    totalPackages: number;
    estimatedDriveSeconds: number;
    estimatedDriveMiles: number;
  };
  route: RouteStep[];
}

// ─────────────────────────────────────────────────────────────
// Database row types (SQLite)
// ─────────────────────────────────────────────────────────────

export interface ManifestRow {
  id: string;
  zip_code: string;
  generated_at: string;
  total_packages: number;
  status: string;
}

export type PackageStatus = "pending" | "scanned" | "loaded" | "in_route" | "delivered";

export interface PackageRow {
  id: string;
  manifest_id: string;
  assigned_route_id: string | null;
  tracking_number: string;
  recipient_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  package_count: number;
  service_type: string;
  weight_oz: number;
  status: PackageStatus;
  is_ghost: number; // 0 | 1 (SQLite booleans)
  created_at: string;
  scanned_at: string | null;
  delivered_at: string | null;
}

export type RouteStatus = "loading" | "optimized" | "in_delivery" | "complete";

export interface RouteRow {
  id: string;
  manifest_id: string;
  route_number: string | null;
  driver_name: string;
  vehicle_id: string | null;
  status: RouteStatus;
  start_address: string;
  start_lat: number | null;
  start_lng: number | null;
  cluster_meters: number;
  alert_meters: number;
  return_drive_seconds: number;
  return_drive_miles: number;
  created_at: string;
  optimized_at: string | null;
  completed_at: string | null;
}

export type StopStatus = "pending" | "arrived" | "complete";

export interface RouteStopRow {
  id: string;
  route_id: string;
  sequence_number: number;
  cluster_id: string;
  centroid_lat: number;
  centroid_lng: number;
  drive_seconds_from_prev: number;
  drive_miles_from_prev: number;
  alerts: string; // JSON string
  geometry: string | null; // JSON string [[lng,lat],...]
  status: StopStatus;
  arrived_at: string | null;
  completed_at: string | null;
}

export interface GpsPingRow {
  id: string;
  route_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_mph: number | null;
  recorded_at: string;
}

// ─────────────────────────────────────────────────────────────
// API response shapes for the new endpoints
// ─────────────────────────────────────────────────────────────

export interface ManifestSummary {
  id: string;
  zipCode: string;
  generatedAt: string;
  totalPackages: number;
  status: string;
}

export interface RouteProposalStop {
  sequenceNumber: number;
  clusterId: string;
  centroid: LatLng;
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
  status: PackageStatus;
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
  centroid: LatLng;
  driveSecondsFromPrev: number;
  driveMilesFromPrev: number;
  alerts: string[];
  geometry: [number, number][] | null;
  status: StopStatus;
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
  status: RouteStatus;
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
