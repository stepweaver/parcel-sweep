import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutocompleteSuggestion } from "./addressAutocomplete.js";
import { evaluateAddressSuggestion } from "./quickRouteVerify.js";
import {
  SERVICE_UNAVAILABLE_REASON,
  resolveAddressBatch,
  resolveOneAddress,
  type AddressSearchFn,
  type BatchResolveInput,
} from "./batchResolve.js";
import { prepareOptimizePoints } from "../routes/optimizeRoute.js";
import type { GeocodedStop, OptimizeRouteRequest } from "../types/index.js";

function suggestion(
  overrides: Partial<AutocompleteSuggestion> & Pick<AutocompleteSuggestion, "displayName">
): AutocompleteSuggestion {
  return {
    placeId: overrides.placeId ?? overrides.displayName,
    displayName: overrides.displayName,
    lat: overrides.lat ?? 41.652,
    lng: overrides.lng ?? -86.251,
    confidence: overrides.confidence ?? "verified_parcel",
    rankReason: overrides.rankReason ?? "Suggested match",
    city: overrides.city ?? "South Bend",
    state: overrides.state ?? "IN",
    zip: overrides.zip ?? "46614",
    houseNumber: overrides.houseNumber,
    street: overrides.street,
    distanceMeters: overrides.distanceMeters,
  };
}

const oliveVerified = suggestion({
  displayName: "2221 South Olive Street, South Bend, IN 46613",
  houseNumber: "2221",
  street: "South Olive Street",
  zip: "46613",
  confidence: "verified_parcel",
});

const michiganWrongStreet = suggestion({
  displayName: "2221 South Michigan Street, South Bend, IN 46614",
  houseNumber: "2221",
  street: "South Michigan Street",
  zip: "46614",
  confidence: "verified_parcel",
});

describe("batch resolver never drops rows (G, H)", () => {
  it("returns an unresolved row when the provider finds nothing", async () => {
    const search: AddressSearchFn = async () => [];
    const { results, count } = await resolveAddressBatch(
      [
        { id: "1", rawInput: "1616 Philippa St", searchInput: "1616 Philippa St" },
        { id: "2", rawInput: "2107 South Mead St", searchInput: "2107 South Mead St" },
      ],
      { search }
    );
    assert.equal(results.length, 2);
    assert.equal(results[0].id, "1");
    assert.equal(results[1].id, "2");
    assert.equal(results[0].status, "unresolved");
    assert.equal(results[1].status, "unresolved");
    assert.equal(count.ok, true);
    assert.equal(count.unresolved, 2);
  });

  it("returns the row as unresolved when the provider throws", async () => {
    const search: AddressSearchFn = async () => {
      throw new Error("timeout");
    };
    const result = await resolveOneAddress(
      { id: "mead", rawInput: "2107 South Mead St", searchInput: "2107 South Mead St" },
      search
    );
    assert.equal(result.id, "mead");
    assert.equal(result.rawInput, "2107 South Mead St");
    assert.equal(result.status, "unresolved");
    assert.equal(result.reason, SERVICE_UNAVAILABLE_REASON);
  });

  it("still returns every row when some lookups fail", async () => {
    const search: AddressSearchFn = async ({ q }) => {
      if (q.includes("Mead")) throw new Error("timeout");
      return [oliveVerified];
    };
    const entries: BatchResolveInput[] = [
      { id: "olive", rawInput: "2221 South Olive St", searchInput: "2221 South Olive St" },
      { id: "mead", rawInput: "2107 South Mead St", searchInput: "2107 South Mead St" },
    ];
    const { results, count } = await resolveAddressBatch(entries, { search });
    assert.equal(results.length, 2);
    assert.equal(results.find((r) => r.id === "mead")?.status, "unresolved");
    assert.equal(count.parsed, 2);
    assert.equal(count.accountedFor, 2);
    assert.equal(count.ok, true);
  });
});

describe("batch verification uses Phase 1 semantics (L, M)", () => {
  it("verifies a strong in-area match the same way autocomplete would", async () => {
    const search: AddressSearchFn = async () => [oliveVerified];
    const result = await resolveOneAddress(
      { id: "olive", rawInput: "2221 South Olive St", searchInput: "2221 South Olive St" },
      search
    );
    const phase1 = evaluateAddressSuggestion("2221 South Olive St", oliveVerified);
    assert.equal(phase1.verificationStatus, "verified");
    assert.equal(result.status, "verified");
    assert.equal(result.candidate?.placeId, oliveVerified.placeId);
    assert.equal(result.rawInput, "2221 South Olive St");
  });

  it("cannot verify a wrong-street candidate through the batch path", async () => {
    const search: AddressSearchFn = async () => [michiganWrongStreet];
    const result = await resolveOneAddress(
      { id: "olive", rawInput: "2221 South Olive St", searchInput: "2221 South Olive St" },
      search
    );
    const phase1 = evaluateAddressSuggestion("2221 South Olive St", michiganWrongStreet);
    assert.notEqual(phase1.verificationStatus, "verified");
    assert.equal(phase1.canConfirm, false);
    assert.notEqual(result.status, "verified");
    assert.equal((result.candidates ?? []).length, 0);
  });

  it("preserves spoken rawInput while searching with the normalized form", async () => {
    let searched = "";
    const search: AddressSearchFn = async ({ q }) => {
      searched = q;
      return [oliveVerified];
    };
    const result = await resolveOneAddress(
      {
        id: "olive",
        rawInput: "twenty two twenty one south olive street",
        searchInput: "2221 south olive street",
      },
      search
    );
    assert.equal(searched, "2221 south olive street");
    assert.equal(result.rawInput, "twenty two twenty one south olive street");
    assert.equal(result.normalizedInput, "2221 south olive street");
  });
});

describe("batch concurrency", () => {
  it("does not run all lookups at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const search: AddressSearchFn = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return [];
    };
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      rawInput: `Address ${i} Street`,
      searchInput: `Address ${i} Street`,
    }));
    await resolveAddressBatch(entries, { search, concurrency: 4 });
    assert.ok(maxInFlight <= 4, `max in-flight ${maxInFlight}`);
    assert.ok(maxInFlight >= 2, `expected some parallelism, got ${maxInFlight}`);
  });
});

describe("Google Address Validation is a fallback, not a free-for-all", () => {
  it("does not call Google when the local provider already verified", async () => {
    let googleCalls = 0;
    const search: AddressSearchFn = async () => [oliveVerified];
    const googleValidate = async () => {
      googleCalls += 1;
      throw new Error("Google should not be called");
    };
    const result = await resolveOneAddress(
      { id: "olive", rawInput: "2221 South Olive St", searchInput: "2221 South Olive St" },
      search,
      googleValidate
    );
    assert.equal(result.status, "verified");
    assert.equal(googleCalls, 0);
    assert.equal(result.verificationProvider, undefined);
  });

  it("J. Google unavailable keeps the original row unresolved and does not drop it", async () => {
    const search: AddressSearchFn = async () => [];
    const googleValidate = async () => {
      throw new Error("Address Validation API unavailable");
    };
    const { results, count } = await resolveAddressBatch(
      [
        { id: "mead", rawInput: "2107 South Mead St", searchInput: "2107 South Mead St" },
        { id: "philippa", rawInput: "1616 Philippa St", searchInput: "1616 Philippa St" },
      ],
      { search, googleValidate }
    );
    assert.equal(results.length, 2);
    assert.equal(results[0].id, "mead");
    assert.equal(results[1].id, "philippa");
    assert.equal(results[0].status, "unresolved");
    assert.equal(results[1].status, "unresolved");
    assert.equal(count.ok, true);
    assert.equal(count.accountedFor, 2);
  });

  it("uses Google when local providers cannot verify", async () => {
    const search: AddressSearchFn = async () => [];
    const googleValidate = async () => ({
      status: "verified" as const,
      candidate: {
        placeId: "ChIJ-mead",
        displayName: "2107 South Mead Street, South Bend, IN 46613, USA",
        lat: 41.66,
        lng: -86.24,
        confidence: "verified_parcel" as const,
        city: "South Bend",
        state: "IN",
        zip: "46613",
        houseNumber: "2107",
        street: "South Mead Street",
      },
      meta: {
        addressComplete: true,
        validationGranularity: "PREMISE",
        geocodeGranularity: "PREMISE",
        hasUnconfirmedComponents: false,
        hasInferredComponents: true,
        hasReplacedComponents: false,
        geometryOk: true,
        materialStreetOrHouseChange: false,
        unconfirmedStreetOrHouse: false,
        inServiceArea: true,
        changedComponents: [],
        lat: 41.66,
        lng: -86.24,
        placeId: "ChIJ-mead",
      },
    });
    const result = await resolveOneAddress(
      { id: "mead", rawInput: "2107 South Mead St", searchInput: "2107 South Mead St" },
      search,
      googleValidate
    );
    assert.equal(result.status, "verified");
    assert.equal(result.verificationMethod, "provider");
    assert.equal(result.verificationProvider, "google_address_validation");
    assert.equal(result.candidate?.placeId, "ChIJ-mead");
    assert.equal(result.id, "mead");
  });
});

describe("batch-created verified stop bypasses optimization geocoder (N)", () => {
  it("uses locked coordinates from a batch-verified stop", async () => {
    let geocodeCalls = 0;
    const geocodeStart = async (address: string): Promise<GeocodedStop> => {
      geocodeCalls += 1;
      return { address, packageCount: 0, lat: 41.65, lng: -86.25 };
    };
    const body: OptimizeRouteRequest = {
      startAddress: "4015 S Main St, South Bend, IN 46614",
      startCoords: { lat: 41.652, lng: -86.2511 },
      stops: [
        {
          address: oliveVerified.displayName,
          rawInput: "2221 South Olive St",
          lat: oliveVerified.lat,
          lng: oliveVerified.lng,
          placeId: oliveVerified.placeId,
          confidence: "verified_parcel",
          verificationStatus: "verified",
        },
      ],
    };
    const result = await prepareOptimizePoints(body, geocodeStart);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(geocodeCalls, 0);
    assert.equal(result.stops[0].lat, oliveVerified.lat);
    assert.equal(result.stops[0].lng, oliveVerified.lng);
  });
});
