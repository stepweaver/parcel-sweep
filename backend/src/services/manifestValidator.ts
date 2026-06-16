import { SUNDAY_DEFAULTS } from "../config/sundayDefaults.js";

export type ValidationStatus = "verified" | "warning" | "hold" | "duplicate";
export type QuarantineStatus = "none" | "hold" | "released";

export interface ManifestRowInput {
  trackingNumber: string;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  weightOz?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  hazmatFlag?: boolean;
  sundayEligible?: boolean;
  podRequired?: boolean;
  serviceType?: string;
  deliveryNotes?: string;
}

export interface ValidationResult {
  validationStatus: ValidationStatus;
  quarantineStatus: QuarantineStatus;
  validationReasons: string[];
  oversizeFlag: boolean;
}

const PO_BOX_RE = /\bP\.?\s*O\.?\s*BOX\b/i;
const UNIT_IN_ADDRESS_RE = /\b(APT|APARTMENT|UNIT|STE|SUITE|#)\b/i;

const ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "46614": { lat: 41.633, lng: -86.254 },
  "46628": { lat: 41.698, lng: -86.292 },
};

function hashJitter(seed: string): { latOff: number; lngOff: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const latOff = ((h & 0xffff) / 0xffff - 0.5) * 0.04;
  const lngOff = (((h >> 16) & 0xffff) / 0xffff - 0.5) * 0.04;
  return { latOff, lngOff };
}

export function approximateCoords(zip: string, trackingNumber: string): { lat: number; lng: number } {
  const base = ZIP_CENTROIDS[zip.slice(0, 5)] ?? ZIP_CENTROIDS["46614"];
  const { latOff, lngOff } = hashJitter(trackingNumber);
  return { lat: base.lat + latOff, lng: base.lng + lngOff };
}

export function isRoutablePackage(
  validationStatus: ValidationStatus,
  quarantineStatus: QuarantineStatus
): boolean {
  if (quarantineStatus === "hold") return false;
  if (validationStatus === "hold" || validationStatus === "duplicate") return false;
  return true;
}

export function validateManifestRow(
  row: ManifestRowInput,
  ctx: {
    hubZip: string;
    allowedZips: string[];
    seenTracking: Set<string>;
    existingTracking: Set<string>;
    skipGeocode?: boolean;
  }
): ValidationResult & { lat: number; lng: number } {
  const reasons: string[] = [];
  let validationStatus: ValidationStatus = "verified";
  let quarantineStatus: QuarantineStatus = "none";
  let oversizeFlag = false;

  const tracking = row.trackingNumber.trim();
  const address = row.addressLine1?.trim() ?? "";
  const zip = row.zip?.trim().slice(0, 5) ?? "";

  if (!tracking) {
    reasons.push("MISSING_TRACKING");
    validationStatus = "hold";
    quarantineStatus = "hold";
  } else if (ctx.seenTracking.has(tracking)) {
    reasons.push("DUPLICATE_IN_FILE");
    validationStatus = "duplicate";
    quarantineStatus = "hold";
  } else if (ctx.existingTracking.has(tracking)) {
    reasons.push("DUPLICATE_IN_SYSTEM");
    validationStatus = "duplicate";
    quarantineStatus = "hold";
  } else {
    ctx.seenTracking.add(tracking);
  }

  if (!address) {
    reasons.push("MISSING_STREET");
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  if (PO_BOX_RE.test(address) || PO_BOX_RE.test(row.addressLine2 ?? "")) {
    reasons.push("PO_BOX");
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  if (address && !row.addressLine2?.trim() && UNIT_IN_ADDRESS_RE.test(address) === false) {
    const looksMultiUnit = /\d{3,}/.test(address) && address.includes(" ");
    if (looksMultiUnit) {
      reasons.push("MISSING_APT_WARNING");
      if (validationStatus === "verified") validationStatus = "warning";
    }
  }

  if (zip && !ctx.allowedZips.includes(zip)) {
    reasons.push("ZIP_OUTSIDE_HUB");
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  if (row.hazmatFlag) {
    reasons.push("HAZMAT_HOLD");
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  const weight = row.weightOz ?? 16;
  const len = row.lengthIn ?? 0;
  const wid = row.widthIn ?? 0;
  const ht = row.heightIn ?? 0;
  const girth = len + 2 * (wid + ht);

  if (weight > SUNDAY_DEFAULTS.maxWeightOz || len > SUNDAY_DEFAULTS.maxDimensionIn || girth > SUNDAY_DEFAULTS.maxGirthIn) {
    reasons.push("OVERSIZE");
    oversizeFlag = true;
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  if (row.sundayEligible === false) {
    reasons.push("SUNDAY_INELIGIBLE");
    validationStatus = "hold";
    quarantineStatus = "hold";
  }

  const coords = approximateCoords(zip || ctx.hubZip, tracking || "unknown");
  if (!ctx.skipGeocode && (validationStatus === "verified" || validationStatus === "warning")) {
    // Approximate coords used for bulk import performance; flagged as warning when not truly geocoded
    if (validationStatus === "verified") {
      reasons.push("APPROXIMATE_GEOCODE");
      validationStatus = "warning";
    }
  }

  return {
    validationStatus,
    quarantineStatus,
    validationReasons: reasons,
    oversizeFlag,
    lat: coords.lat,
    lng: coords.lng,
  };
}

export function summarizeValidation(
  packages: Array<{ validationStatus: ValidationStatus; quarantineStatus: QuarantineStatus }>
): Record<string, number> {
  const summary: Record<string, number> = {
    verified: 0,
    warning: 0,
    hold: 0,
    duplicate: 0,
    quarantineHold: 0,
    routable: 0,
  };
  for (const p of packages) {
    summary[p.validationStatus] = (summary[p.validationStatus] ?? 0) + 1;
    if (p.quarantineStatus === "hold") summary.quarantineHold++;
    if (isRoutablePackage(p.validationStatus, p.quarantineStatus)) summary.routable++;
  }
  return summary;
}
