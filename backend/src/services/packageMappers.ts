import { PackageRow, PackageDetail, ManifestRow, ManifestSummary } from "../types/index.js";
import { isRoutablePackage } from "./manifestValidator.js";

export function parseValidationReasons(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function toPackageDetail(p: PackageRow): PackageDetail {
  return {
    id: p.id,
    manifestId: p.manifest_id,
    assignedRouteId: p.assigned_route_id,
    trackingNumber: p.tracking_number,
    recipientName: p.recipient_name,
    address: p.address,
    addressLine2: p.address_line_2 ?? null,
    city: p.city,
    state: p.state,
    zip: p.zip,
    lat: p.lat,
    lng: p.lng,
    packageCount: p.package_count,
    serviceType: p.service_type,
    weightOz: p.weight_oz,
    lengthIn: p.length_in,
    widthIn: p.width_in,
    heightIn: p.height_in,
    hazmatFlag: p.hazmat_flag === 1,
    oversizeFlag: p.oversize_flag === 1,
    sundayEligible: p.sunday_eligible !== 0,
    podRequired: p.pod_required === 1,
    deliveryNotes: p.delivery_notes ?? null,
    validationStatus: p.validation_status ?? "verified",
    validationReasons: parseValidationReasons(p.validation_reasons),
    quarantineStatus: p.quarantine_status ?? "none",
    overrideNote: p.override_note ?? null,
    status: p.status,
    isGhost: p.is_ghost === 1,
    createdAt: p.created_at,
    scannedAt: p.scanned_at,
    deliveredAt: p.delivered_at,
  };
}

export function toManifestSummary(m: ManifestRow & { package_count?: number }): ManifestSummary {
  let validationSummary: Record<string, number> | null = null;
  if (m.validation_summary) {
    try {
      validationSummary = JSON.parse(m.validation_summary) as Record<string, number>;
    } catch {
      validationSummary = null;
    }
  }
  return {
    id: m.id,
    zipCode: m.zip_code,
    generatedAt: m.generated_at,
    totalPackages: m.total_packages ?? m.package_count ?? 0,
    status: m.status,
    source: m.source ?? "synthetic",
    hubId: m.hub_id ?? null,
    operationDate: m.operation_date ?? null,
    dutTime: m.dut_time ?? null,
    validationSummary,
  };
}

export function packageIsRoutable(p: PackageRow): boolean {
  if (p.lat === 0 && p.lng === 0) return false;
  if (p.is_ghost === 1) return false;
  return isRoutablePackage(
    p.validation_status ?? "verified",
    p.quarantine_status ?? "none"
  );
}
