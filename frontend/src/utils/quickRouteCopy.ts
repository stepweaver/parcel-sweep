import type { QuickRouteStop } from "./quickRouteStops";
import { GOOGLE_ADDRESS_VALIDATION_PROVIDER } from "./quickRouteStops";

/** Primary status label shown in the normal Quick Route flow. */
export function stopStatusTitle(stop: QuickRouteStop): string {
  if (stop.verificationStatus === "verified") return "Ready";
  if (stop.verificationStatus === "needs_review") return "Check this";
  return "Needs a location";
}

/** Quiet secondary line; provenance stays out of the primary UI. */
export function stopStatusDetail(stop: QuickRouteStop): string | undefined {
  if (stop.verificationStatus === "verified" && stop.verificationMethod === "manual_pin") {
    return "Pinned by you";
  }
  if (stop.verificationStatus === "needs_review") {
    return "We found more than one possibility.";
  }
  if (stop.verificationStatus === "unresolved") {
    return friendlyUnresolvedMessage(stop.unresolvedReason);
  }
  return undefined;
}

export function friendlyUnresolvedMessage(reason?: string): string {
  const text = reason?.trim() ?? "";
  if (/unavailable|try again/i.test(text)) {
    return "We couldn't check this address. Try again.";
  }
  if (/not returned|processing error/i.test(text)) {
    return "Something went wrong checking this address. Try again.";
  }
  return "We couldn't confidently place this stop.";
}

export function diagnosticStatusDetail(stop: QuickRouteStop): string | undefined {
  if (stop.verificationStatus !== "verified") return undefined;
  if (stop.verificationMethod === "manual_pin") {
    return stop.manualReverseGeocodeLabel
      ? `Pinned by you · ${stop.manualReverseGeocodeLabel}`
      : "Pinned by you";
  }
  if (stop.verificationProvider === GOOGLE_ADDRESS_VALIDATION_PROVIDER) {
    return "Google Address Validation";
  }
  if (stop.verificationProvider) return stop.verificationProvider;
  return undefined;
}
