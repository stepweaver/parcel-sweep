import {
  hasUsableGeometry,
  normalizeStreetCore,
  parsePartialAddress,
  streetPortion,
} from "./addressMatch";

export type VerificationStatus = "unresolved" | "needs_review" | "verified";

export interface BatchCountSummary {
  parsed: number;
  verified: number;
  needsReview: number;
  unresolved: number;
  accountedFor: number;
  ok: boolean;
}

export function summarizeVerificationCounts(
  parsed: number,
  statuses: readonly VerificationStatus[]
): BatchCountSummary {
  const verified = statuses.filter((s) => s === "verified").length;
  const needsReview = statuses.filter((s) => s === "needs_review").length;
  const unresolved = statuses.filter((s) => s === "unresolved").length;
  const accountedFor = verified + needsReview + unresolved;
  return {
    parsed,
    verified,
    needsReview,
    unresolved,
    accountedFor,
    ok: parsed === statuses.length && parsed === accountedFor && parsed >= 0,
  };
}

export function routeBlockedByVerification(
  filledStatuses: readonly VerificationStatus[]
): boolean {
  if (filledStatuses.length === 0) return true;
  return filledStatuses.some((s) => s !== "verified");
}

export interface DuplicateCheckStop {
  id: string;
  rawInput: string;
  address: string;
  searchInput?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  duplicateKept?: boolean;
}

export interface ProbableDuplicate {
  stopId: string;
  otherStopId: string;
  otherIndex: number;
  reason: string;
}

const NEAR_DUPLICATE_METERS = 25;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function houseStreetKey(text: string): string | null {
  const line = streetPortion(text);
  const parsed = parsePartialAddress(line);
  if (!parsed.houseNumber) return null;
  const core = normalizeStreetCore(line);
  if (!core) return null;
  return `${parsed.houseNumber.toLowerCase()}|${core}`;
}

function stopHouseStreetKey(stop: DuplicateCheckStop): string | null {
  return (
    houseStreetKey(stop.address) ??
    houseStreetKey(stop.searchInput ?? "") ??
    houseStreetKey(stop.rawInput)
  );
}

/**
 * Flag later stops that look like earlier ones. Never removes entries.
 * Stops with duplicateKept stay unflagged.
 */
export function detectProbableDuplicates(stops: DuplicateCheckStop[]): ProbableDuplicate[] {
  const flags: ProbableDuplicate[] = [];

  for (let i = 0; i < stops.length; i++) {
    const current = stops[i];
    if (current.duplicateKept) continue;

    for (let j = 0; j < i; j++) {
      const other = stops[j];
      const otherIndex = j + 1;
      let reason: string | null = null;

      if (current.placeId && other.placeId && current.placeId === other.placeId) {
        reason = `Possible duplicate of stop ${otherIndex}`;
      }

      if (!reason) {
        const keyA = stopHouseStreetKey(current);
        const keyB = stopHouseStreetKey(other);
        if (keyA && keyB && keyA === keyB) {
          reason = `Possible duplicate of stop ${otherIndex}`;
        }
      }

      if (
        !reason &&
        hasUsableGeometry(current.lat, current.lng) &&
        hasUsableGeometry(other.lat, other.lng)
      ) {
        const meters = haversineMeters(
          { lat: current.lat as number, lng: current.lng as number },
          { lat: other.lat as number, lng: other.lng as number }
        );
        if (meters <= NEAR_DUPLICATE_METERS) {
          reason = `Possible duplicate of stop ${otherIndex}`;
        }
      }

      if (reason) {
        flags.push({
          stopId: current.id,
          otherStopId: other.id,
          otherIndex,
          reason,
        });
        break;
      }
    }
  }

  return flags;
}

export function keepDuplicateStop<T extends { id: string; duplicateKept?: boolean }>(
  stops: T[],
  stopId: string
): T[] {
  return stops.map((s) => (s.id === stopId ? { ...s, duplicateKept: true } : s));
}

export function removeDuplicateStop<T extends { id: string }>(stops: T[], stopId: string): T[] {
  return stops.filter((s) => s.id !== stopId);
}
