import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareOptimizePoints } from "../routes/optimizeRoute.js";
import type { GeocodedStop, OptimizeRouteRequest } from "../types/index.js";

const SB_STOP = {
  address: "1918 West Indiana Avenue, South Bend, IN 46614",
  rawInput: "1918 W Indiana Ave",
  lat: 41.652,
  lng: -86.251,
  placeId: "place-indiana",
  confidence: "verified_parcel" as const,
  verificationStatus: "verified" as const,
};

describe("prepareOptimizePoints", () => {
  it("uses verified coordinates and does not call the geocoder for stops or start when startCoords are supplied", async () => {
    let geocodeCalls = 0;
    const geocodeStart = async (address: string): Promise<GeocodedStop> => {
      geocodeCalls += 1;
      return { address, packageCount: 0, lat: 41.65, lng: -86.25 };
    };

    const body: OptimizeRouteRequest = {
      startAddress: "4015 S Main St, South Bend, IN 46614",
      startCoords: { lat: 41.652, lng: -86.2511 },
      stops: [SB_STOP],
    };

    const result = await prepareOptimizePoints(body, geocodeStart);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(geocodeCalls, 0);
    assert.equal(result.stops[0].lat, SB_STOP.lat);
    assert.equal(result.stops[0].lng, SB_STOP.lng);
    assert.equal(result.start.lat, body.startCoords?.lat);
  });

  it("does not geocode verified stops even when start must be geocoded", async () => {
    let geocodeCalls = 0;
    const geocodeStart = async (address: string): Promise<GeocodedStop> => {
      geocodeCalls += 1;
      return { address, packageCount: 0, lat: 41.65, lng: -86.25 };
    };

    const result = await prepareOptimizePoints(
      { startAddress: "Custom Start, South Bend, IN", stops: [SB_STOP] },
      geocodeStart
    );
    assert.equal(result.ok, true);
    assert.equal(geocodeCalls, 1);
    if (!result.ok) return;
    assert.equal(result.stops[0].lat, SB_STOP.lat);
  });

  it("rejects unresolved stops with 422 instead of geocoding them", async () => {
    let geocodeCalls = 0;
    const geocodeStart = async (address: string): Promise<GeocodedStop> => {
      geocodeCalls += 1;
      return { address, packageCount: 0, lat: 41.65, lng: -86.25 };
    };

    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [{ address: "1616 Philippa St", verificationStatus: "unresolved" }],
      },
      geocodeStart
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 422);
    assert.equal(geocodeCalls, 0);
  });

  it("rejects needs_review stops with 422", async () => {
    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [
          {
            address: "2221 South Michigan Street, South Bend, IN 46614",
            lat: 41.66,
            lng: -86.25,
            placeId: "mismatch",
            verificationStatus: "needs_review",
          },
        ],
      },
      async () => {
        throw new Error("geocoder should not be called");
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 422);
  });

  it("E. accepts a manually verified stop without placeId and does not geocode it", async () => {
    let geocodeCalls = 0;
    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [
          {
            address: "1818 South Jackson St",
            rawInput: "1818 South Jackson St",
            lat: 41.66,
            lng: -86.25,
            verificationStatus: "verified",
            verificationMethod: "manual_pin",
            manualVerifiedAt: "2026-08-29T12:00:00.000Z",
          },
        ],
      },
      async (address) => {
        geocodeCalls += 1;
        return { address, packageCount: 0, lat: 41.65, lng: -86.25 };
      }
    );
    assert.equal(result.ok, true);
    assert.equal(geocodeCalls, 0);
    if (!result.ok) return;
    assert.equal(result.stops[0].lat, 41.66);
    assert.equal(result.stops[0].address, "1818 South Jackson St");
  });

  it("J. accepts provider verified and manually verified stops together", async () => {
    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [
          SB_STOP,
          {
            address: "1616 Philippa St",
            rawInput: "1616 Philippa St",
            lat: 41.665,
            lng: -86.24,
            verificationStatus: "verified",
            verificationMethod: "manual_pin",
          },
        ],
      },
      async () => {
        throw new Error("geocoder should not be called");
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stops.length, 2);
  });

  it("F. rejects manual coordinates outside the service area with 422", async () => {
    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [
          {
            address: "1616 Philippa St",
            rawInput: "1616 Philippa St",
            lat: 41.08,
            lng: -85.14,
            verificationStatus: "verified",
            verificationMethod: "manual_pin",
          },
        ],
      },
      async () => {
        throw new Error("geocoder should not be called");
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 422);
  });

  it("K. still blocks any remaining unresolved stop even when others are manually verified", async () => {
    const result = await prepareOptimizePoints(
      {
        startAddress: "4015 S Main St, South Bend, IN 46614",
        startCoords: { lat: 41.652, lng: -86.2511 },
        stops: [
          {
            address: "1818 South Jackson St",
            rawInput: "1818 South Jackson St",
            lat: 41.66,
            lng: -86.25,
            verificationStatus: "verified",
            verificationMethod: "manual_pin",
          },
          { address: "1917 South Jackson St", verificationStatus: "unresolved" },
        ],
      },
      async () => {
        throw new Error("geocoder should not be called");
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 422);
  });
});
