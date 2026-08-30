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
});
