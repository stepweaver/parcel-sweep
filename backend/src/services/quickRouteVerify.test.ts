import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStopTextEdit,
  evaluateAddressSuggestion,
  migrateLegacyQuickRouteStop,
  parsePastedAddresses,
  validateVerifiedStopCoords,
  type SuggestionLike,
} from "./quickRouteVerify.js";

function suggestion(overrides: Partial<SuggestionLike> & Pick<SuggestionLike, "displayName">): SuggestionLike {
  return {
    placeId: overrides.placeId ?? overrides.displayName,
    displayName: overrides.displayName,
    lat: overrides.lat ?? 41.652,
    lng: overrides.lng ?? -86.251,
    confidence: overrides.confidence ?? "verified_parcel",
    city: overrides.city ?? "South Bend",
    state: overrides.state ?? "IN",
    zip: overrides.zip ?? "46614",
    houseNumber: overrides.houseNumber,
    street: overrides.street,
  };
}

describe("parsePastedAddresses", () => {
  it("treats newline as the delimiter and keeps commas in the address", () => {
    const input = [
      "2221 S Olive St, South Bend, IN 46614",
      "2107 S Mead St, South Bend, IN 46613",
    ].join("\n");
    assert.deepEqual(parsePastedAddresses(input), [
      "2221 S Olive St, South Bend, IN 46614",
      "2107 S Mead St, South Bend, IN 46613",
    ]);
  });

  it("ignores blank lines", () => {
    const input = "2221 S Olive St, South Bend, IN 46614\n\n\n2107 S Mead St, South Bend, IN 46613\n";
    assert.equal(parsePastedAddresses(input).length, 2);
  });
});

describe("evaluateAddressSuggestion", () => {
  it("auto-verifies a strong South Bend 46614 match with geometry", () => {
    const result = evaluateAddressSuggestion(
      "1918 W Indiana Ave",
      suggestion({
        displayName: "1918 West Indiana Avenue, South Bend, IN 46614",
        houseNumber: "1918",
        street: "West Indiana Avenue",
        zip: "46614",
        confidence: "verified_parcel",
      })
    );
    assert.equal(result.verificationStatus, "verified");
  });

  it("does not verify Olive as Michigan even with the same house number", () => {
    const result = evaluateAddressSuggestion(
      "2221 South Olive St",
      suggestion({
        displayName: "2221 South Michigan Street, South Bend, IN 46614",
        houseNumber: "2221",
        street: "South Michigan Street",
        confidence: "verified_parcel",
      })
    );
    assert.notEqual(result.verificationStatus, "verified");
    assert.equal(result.canConfirm, false);
  });

  it("does not verify Jackson as Main", () => {
    const result = evaluateAddressSuggestion(
      "1818 South Jackson St",
      suggestion({
        displayName: "1818 South Main Street, South Bend, IN 46614",
        houseNumber: "1818",
        street: "South Main Street",
        confidence: "verified_parcel",
      })
    );
    assert.equal(result.canConfirm, false);
    assert.notEqual(result.verificationStatus, "verified");
  });

  it("does not verify 46628 or Fort Wayne as a Quick Route stop", () => {
    const zip = evaluateAddressSuggestion(
      "3800 McKinley Ave",
      suggestion({
        displayName: "3800 McKinley Avenue, South Bend, IN 46628",
        zip: "46628",
        houseNumber: "3800",
        street: "McKinley Avenue",
      })
    );
    assert.notEqual(zip.verificationStatus, "verified");

    const city = evaluateAddressSuggestion(
      "1616 Philippa St",
      suggestion({
        displayName: "1616 Philippa Street, Fort Wayne, IN 46802",
        city: "Fort Wayne",
        zip: "46802",
        houseNumber: "1616",
        street: "Philippa Street",
        lat: 41.08,
        lng: -85.14,
      })
    );
    assert.notEqual(city.verificationStatus, "verified");
    assert.equal(city.canConfirm, false);
  });
});

describe("applyStopTextEdit", () => {
  it("clears verification and coordinates when the address text changes", () => {
    const edited = applyStopTextEdit(
      {
        id: "1",
        rawInput: "1918 W Indiana Ave",
        address: "1918 West Indiana Avenue, South Bend, IN 46614",
        lat: 41.652,
        lng: -86.251,
        placeId: "place-1",
        confidence: "verified_parcel",
        verificationStatus: "verified",
      },
      "1918 W Indiana Avenue edited"
    );
    assert.equal(edited.verificationStatus, "unresolved");
    assert.equal(edited.lat, undefined);
    assert.equal(edited.lng, undefined);
    assert.equal(edited.placeId, undefined);
    assert.equal(edited.confidence, undefined);
  });

  it("G. changing address text clears manual verification", () => {
    const edited = applyStopTextEdit(
      {
        id: "1",
        rawInput: "1818 South Jackson St",
        address: "1818 South Jackson St",
        lat: 41.66,
        lng: -86.25,
        verificationStatus: "verified",
        verificationMethod: "manual_pin",
        manualVerifiedAt: "2026-08-29T12:00:00.000Z",
      },
      "1818 South Jackson Street"
    );
    assert.equal(edited.verificationStatus, "unresolved");
    assert.equal(edited.verificationMethod, undefined);
    assert.equal(edited.lat, undefined);
    assert.equal(edited.lng, undefined);
  });
});

describe("legacy stop migration", () => {
  it("does not treat stored address strings as verified", () => {
    const migrated = migrateLegacyQuickRouteStop({ id: "abc", address: "2221 S Olive St" });
    assert.equal(migrated.rawInput, "2221 S Olive St");
    assert.equal(migrated.address, "2221 S Olive St");
    assert.equal(migrated.verificationStatus, "unresolved");
    assert.equal(migrated.lat, undefined);
  });
});

describe("validateVerifiedStopCoords", () => {
  it("accepts a verified in-bounds stop", () => {
    const result = validateVerifiedStopCoords({
      address: "1918 West Indiana Avenue, South Bend, IN 46614",
      lat: 41.652,
      lng: -86.251,
      placeId: "place-1",
      verificationStatus: "verified",
    });
    assert.equal(result.ok, true);
  });

  it("rejects unresolved stops", () => {
    const result = validateVerifiedStopCoords({
      address: "1616 Philippa St",
      lat: 41.652,
      lng: -86.251,
      placeId: "place-1",
      verificationStatus: "unresolved",
    });
    assert.equal(result.ok, false);
  });

  it("rejects coordinates outside the service area", () => {
    const result = validateVerifiedStopCoords({
      address: "1616 Philippa Street, Fort Wayne, IN",
      lat: 41.08,
      lng: -85.14,
      placeId: "place-1",
      verificationStatus: "verified",
    });
    assert.equal(result.ok, false);
  });

  it("accepts a manual pin without placeId", () => {
    const result = validateVerifiedStopCoords({
      address: "1818 South Jackson St",
      rawInput: "1818 South Jackson St",
      lat: 41.66,
      lng: -86.25,
      verificationStatus: "verified",
      verificationMethod: "manual_pin",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stop.verificationMethod, "manual_pin");
    assert.equal(result.stop.placeId, undefined);
  });

  it("rejects a manual pin that is missing the original address", () => {
    const result = validateVerifiedStopCoords({
      lat: 41.66,
      lng: -86.25,
      verificationStatus: "verified",
      verificationMethod: "manual_pin",
    });
    assert.equal(result.ok, false);
  });

  it("still requires placeId for provider-verified stops", () => {
    const result = validateVerifiedStopCoords({
      address: "1918 West Indiana Avenue, South Bend, IN 46614",
      lat: 41.652,
      lng: -86.251,
      verificationStatus: "verified",
      verificationMethod: "provider",
    });
    assert.equal(result.ok, false);
  });

  it("rejects 0,0 and non-finite coordinates", () => {
    assert.equal(
      validateVerifiedStopCoords({
        address: "x",
        lat: 0,
        lng: 0,
        placeId: "place-1",
        verificationStatus: "verified",
      }).ok,
      false
    );
    assert.equal(
      validateVerifiedStopCoords({
        address: "x",
        lat: Number.NaN,
        lng: -86.25,
        placeId: "place-1",
        verificationStatus: "verified",
      }).ok,
      false
    );
  });
});
