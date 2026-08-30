import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  routeBlockedByVerification,
  summarizeRouteReadiness,
  summarizeVerificationCounts,
} from "./batchAccounting";
import {
  applyManualPinMapClick,
  applyStopTextEdit,
  confirmManualPin,
  adjustManualPin,
  migrateQuickRouteStop,
  stopAllowsManualPin,
  stopBlocksRoute,
  stopIsFilled,
  type QuickRouteStop,
} from "./quickRouteStops";

const IN_BOUNDS = { lat: 41.66, lng: -86.25 };

function manualStop(overrides: Partial<QuickRouteStop> = {}): QuickRouteStop {
  return {
    id: "pin-1",
    rawInput: "1818 South Jackson St",
    searchInput: "1818 South Jackson St",
    address: "1818 South Jackson St",
    verificationStatus: "unresolved",
    ...overrides,
  };
}

describe("Phase 3 manual verification (A–L)", () => {
  it("A. an unresolved stop can enter manual-pin mode", () => {
    const stop = manualStop();
    assert.equal(stopAllowsManualPin(stop), true);
    assert.equal(stop.verificationStatus, "unresolved");
  });

  it("B. first map click does not verify", () => {
    const stop = manualStop();
    const draft = applyManualPinMapClick({ stopId: stop.id }, IN_BOUNDS.lat, IN_BOUNDS.lng);
    assert.equal(draft.lat, IN_BOUNDS.lat);
    assert.equal(stop.verificationStatus, "unresolved");
    assert.equal(stop.lat, undefined);
  });

  it("C. explicit Use this location verifies", () => {
    const stop = manualStop();
    const draft = applyManualPinMapClick({ stopId: stop.id }, IN_BOUNDS.lat, IN_BOUNDS.lng);
    const verified = confirmManualPin(stop, draft, { at: "2026-08-29T12:00:00.000Z" });
    assert.equal(verified.verificationStatus, "verified");
    assert.equal(verified.verificationMethod, "manual_pin");
    assert.equal(verified.lat, IN_BOUNDS.lat);
    assert.equal(verified.lng, IN_BOUNDS.lng);
    assert.equal(verified.manualVerifiedAt, "2026-08-29T12:00:00.000Z");
  });

  it("D. a manually verified stop does not require placeId", () => {
    const verified = confirmManualPin(
      manualStop(),
      { stopId: "pin-1", ...IN_BOUNDS },
      { at: "2026-08-29T12:00:00.000Z" }
    );
    assert.equal(verified.placeId, undefined);
    const migrated = migrateQuickRouteStop(verified);
    assert.ok(migrated);
    assert.equal(migrated.verificationMethod, "manual_pin");
    assert.equal(migrated.placeId, undefined);
  });

  it("G. changing address text clears manual verification", () => {
    const verified = confirmManualPin(manualStop(), { stopId: "pin-1", ...IN_BOUNDS });
    const edited = applyStopTextEdit(verified, "1818 South Jackson Street");
    assert.equal(edited.verificationStatus, "unresolved");
    assert.equal(edited.verificationMethod, undefined);
    assert.equal(edited.lat, undefined);
    assert.equal(edited.lng, undefined);
    assert.equal(edited.manualVerifiedAt, undefined);
  });

  it("H. adjusting the pin keeps the same stop id", () => {
    const verified = confirmManualPin(manualStop(), { stopId: "pin-1", ...IN_BOUNDS });
    const adjusted = adjustManualPin(verified, 41.661, -86.251, { at: "2026-08-29T13:00:00.000Z" });
    assert.equal(adjusted.id, verified.id);
    assert.equal(adjusted.lat, 41.661);
    assert.equal(adjusted.lng, -86.251);
    assert.equal(adjusted.verificationMethod, "manual_pin");
    assert.equal(adjusted.manualVerifiedAt, "2026-08-29T13:00:00.000Z");
  });

  it("I. reverse-geocode label does not replace rawInput/address", () => {
    const stop = manualStop();
    const verified = confirmManualPin(
      stop,
      { stopId: stop.id, ...IN_BOUNDS },
      { reverseLabel: "1818 S Main St, South Bend, IN 46613" }
    );
    assert.equal(verified.rawInput, "1818 South Jackson St");
    assert.equal(verified.address, "1818 South Jackson St");
    assert.equal(verified.manualReverseGeocodeLabel, "1818 S Main St, South Bend, IN 46613");
  });

  it("J/K. route gate accepts provider + manual verified together and still blocks unresolved", () => {
    const provider: QuickRouteStop = {
      id: "p",
      rawInput: "1918 W Indiana Ave",
      address: "1918 West Indiana Avenue, South Bend, IN 46614",
      lat: 41.652,
      lng: -86.251,
      placeId: "place-indiana",
      verificationStatus: "verified",
      verificationMethod: "provider",
    };
    const manual = confirmManualPin(manualStop({ id: "m" }), { stopId: "m", ...IN_BOUNDS });
    const unresolved = manualStop({ id: "u", rawInput: "1616 Philippa St", address: "1616 Philippa St" });
    assert.equal(stopBlocksRoute(provider), false);
    assert.equal(stopBlocksRoute(manual), false);
    assert.equal(
      routeBlockedByVerification(
        [provider, manual].filter(stopIsFilled).map((s) => s.verificationStatus)
      ),
      false
    );
    assert.equal(
      routeBlockedByVerification(
        [provider, manual, unresolved].filter(stopIsFilled).map((s) => s.verificationStatus)
      ),
      true
    );
  });

  it("L. Phase 2 count invariant still holds with mixed verification sources", () => {
    const provider: QuickRouteStop = {
      id: "1",
      rawInput: "1918 W Indiana Ave",
      address: "1918 W Indiana Ave",
      verificationStatus: "verified",
      verificationMethod: "provider",
    };
    const manual = confirmManualPin(manualStop({ id: "2" }), { stopId: "2", ...IN_BOUNDS });
    const review = manualStop({ id: "3", verificationStatus: "needs_review" });
    const unresolved = manualStop({ id: "4", rawInput: "1616 Philippa St", address: "1616 Philippa St" });
    const stops = [provider, manual, review, unresolved];
    const statuses = stops.map((s) => s.verificationStatus);
    const count = summarizeVerificationCounts(4, statuses);
    assert.equal(count.ok, true);
    assert.equal(count.accountedFor, 4);
    const readiness = summarizeRouteReadiness(stops);
    assert.equal(readiness.providerVerified, 1);
    assert.equal(readiness.manuallyVerified, 1);
    assert.equal(readiness.needsReview, 1);
    assert.equal(readiness.unresolved, 1);
    assert.equal(readiness.accountedFor, 4);
    assert.equal(readiness.readyToRoute, false);
  });

  it("does not auto-verify by opening pin mode", () => {
    const stop = manualStop();
    assert.equal(stopAllowsManualPin(stop), true);
    assert.notEqual(stop.verificationStatus, "verified");
  });

  it("converts unresolved stops to manual_verified without changing the count", () => {
    const unresolved = [
      "2107 South Mead St",
      "2239 South Mead St",
      "1616 Philippa St",
      "1830 Philippa St",
      "1818 South Jackson St",
      "1917 South Jackson St",
    ].map((address, i) =>
      manualStop({ id: `gap-${i}`, rawInput: address, searchInput: address, address })
    );
    const before = summarizeVerificationCounts(
      unresolved.length,
      unresolved.map((s) => s.verificationStatus)
    );
    assert.equal(before.unresolved, 6);
    const pinned = unresolved.map((stop, i) =>
      confirmManualPin(stop, {
        stopId: stop.id,
        lat: 41.65 + i * 0.001,
        lng: -86.25,
      })
    );
    assert.equal(pinned.length, 6);
    assert.deepEqual(pinned.map((s) => s.id), unresolved.map((s) => s.id));
    assert.ok(pinned.every((s) => s.verificationMethod === "manual_pin"));
    assert.ok(pinned.every((s) => s.verificationStatus === "verified"));
    assert.ok(pinned.every((s) => s.rawInput === unresolved.find((u) => u.id === s.id)?.rawInput));
    const after = summarizeVerificationCounts(
      pinned.length,
      pinned.map((s) => s.verificationStatus)
    );
    assert.equal(after.ok, true);
    assert.equal(after.accountedFor, 6);
    assert.equal(after.verified, 6);
    const readiness = summarizeRouteReadiness(pinned);
    assert.equal(readiness.manuallyVerified, 6);
    assert.equal(readiness.readyToRoute, true);
  });
});
