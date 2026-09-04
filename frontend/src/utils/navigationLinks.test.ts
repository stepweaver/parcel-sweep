import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapquestFullRouteUrl, mapquestStopUrl } from "./navigationLinks";

describe("MapQuest export links", () => {
  it("opens a single stop by coordinates", () => {
    const url = mapquestStopUrl({ lat: 41.652, lng: -86.251, address: "1918 W Indiana Ave" });
    assert.equal(url, "https://www.mapquest.com/directions/to/near-41.652,-86.251");
  });

  it("builds start then every stop in order", () => {
    const url = mapquestFullRouteUrl(
      { lat: 41.65, lng: -86.25, address: "Depot" },
      [
        { lat: 41.66, lng: -86.24 },
        { lat: 41.67, lng: -86.23 },
      ]
    );
    assert.equal(
      url,
      "https://www.mapquest.com/directions/from/near-41.65,-86.25/to/near-41.66,-86.24/to/near-41.67,-86.23"
    );
  });
});
