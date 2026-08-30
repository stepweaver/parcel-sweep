import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LruCache,
  autocompleteCacheKey,
  candidateHasHouseNumber,
  deriveConfidence,
  expandSearchQueries,
  locationBucket,
  mergeAndRank,
  parsePartialAddress,
  scoreCandidate,
  shouldUseNationwideFallback,
  streetsEquivalent,
  type RankCandidate,
} from "./addressAutocompleteRank.js";

const NEAR_EAST_FOX = { lat: 41.682, lng: -86.24 };
const NEAR_WEST_FOX = { lat: 41.678, lng: -86.265 };

function candidate(
  displayName: string,
  lat: number,
  lng: number,
  overrides: Partial<RankCandidate> = {}
): RankCandidate {
  return {
    placeId: displayName,
    displayName,
    lat,
    lng,
    confidence: "interpolated",
    rankReason: "Suggested match",
    provider: "photon",
    hasGeometry: true,
    ...overrides,
  };
}

describe("parsePartialAddress", () => {
  it("parses house number and street core", () => {
    const parsed = parsePartialAddress("302 Fox");
    assert.equal(parsed.houseNumber, "302");
    assert.equal(parsed.streetPart, "Fox");
    assert.equal(parsed.preDirectional, undefined);
  });

  it("parses predirectional abbreviation", () => {
    const parsed = parsePartialAddress("302 E Fox");
    assert.equal(parsed.houseNumber, "302");
    assert.equal(parsed.preDirectional, "E");
    assert.equal(parsed.streetPart, "Fox");
  });

  it("parses suffix", () => {
    const parsed = parsePartialAddress("302 Fox St");
    assert.equal(parsed.suffix, "st");
    assert.equal(parsed.streetPart, "Fox");
  });

  it("parses street-only query", () => {
    const parsed = parsePartialAddress("Fox");
    assert.equal(parsed.houseNumber, undefined);
    assert.equal(parsed.streetPart, "Fox");
  });
});

describe("expandSearchQueries", () => {
  it("puts the literal South Bend query first for 302 Fox", () => {
    const queries = expandSearchQueries("302 Fox", "South Bend", "IN");
    assert.equal(queries[0], "302 Fox South Bend IN");
    assert.ok(queries.some((q) => q.includes("East Fox")));
    assert.ok(queries.some((q) => q.includes("West Fox")));
    assert.ok(queries.indexOf("302 Fox South Bend IN") < queries.findIndex((q) => q.includes("East Fox")));
  });

  it("does not let guessed directionals outrank an explicit directional", () => {
    const queries = expandSearchQueries("302 East Fox", "South Bend", "IN");
    assert.equal(queries[0], "302 East Fox South Bend IN");
    assert.equal(queries.some((q) => /West Fox/i.test(q)), false);
  });

  it("does not append South Bend when searching nationwide", () => {
    const queries = expandSearchQueries("123 Oak St, Chicago, IL", "South Bend", "IN", false);
    assert.deepEqual(queries, ["123 Oak St, Chicago, IL"]);
  });
});

describe("shouldUseNationwideFallback", () => {
  it("never retries nationwide for Quick Route service-area searches", () => {
    assert.equal(shouldUseNationwideFallback(true, "1616 Philippa St", "South Bend"), false);
    assert.equal(shouldUseNationwideFallback(true, "123 Main St, Chicago, IL", "South Bend"), false);
  });
});

describe("directional scoring", () => {
  it("strongly prefers explicit West when user typed W", () => {
    const parsed = parsePartialAddress("302 W Fox");
    const west = candidate("302 West Fox Street, South Bend, IN 46601", 41.678, -86.265);
    const east = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });

    const westScore = scoreCandidate(west, parsed, NEAR_WEST_FOX);
    const eastScore = scoreCandidate(east, parsed, NEAR_WEST_FOX);
    assert.ok(westScore > eastScore + 50);
  });

  it("demotes conflicting direction when user typed E", () => {
    const parsed = parsePartialAddress("302 E Fox");
    const west = candidate("302 West Fox Street, South Bend, IN 46601", 41.678, -86.265);
    const east = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });

    assert.ok(scoreCandidate(east, parsed, NEAR_EAST_FOX) > scoreCandidate(west, parsed, NEAR_EAST_FOX));
  });
});

describe("mergeAndRank scenarios", () => {
  it("prefers nearer valid East/West when direction omitted", () => {
    const parsed = parsePartialAddress("302 Fox");
    const east = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });
    const west = candidate("302 West Fox Street, South Bend, IN 46601", 41.678, -86.265, {
      houseNumberVerified: true,
    });
    const hollow = candidate("302 Fox Hollow Drive, South Bend, IN 46601", 41.69, -86.23);

    const nearEast = mergeAndRank([west, hollow, east], parsed, NEAR_EAST_FOX, 5);
    assert.match(nearEast[0].displayName, /East Fox/i);

    const nearWest = mergeAndRank([east, hollow, west], parsed, NEAR_WEST_FOX, 5);
    assert.match(nearWest[0].displayName, /West Fox/i);
  });

  it("prefers street where house number verified when only one exists", () => {
    const parsed = parsePartialAddress("302 Fox");
    const east = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });
    const west = candidate("302 West Fox Street, South Bend, IN 46601", 41.678, -86.265, {
      houseNumberVerified: false,
    });

    const mid = { lat: 41.68, lng: -86.252 };
    const ranked = mergeAndRank([west, east], parsed, mid, 5);
    assert.match(ranked[0].displayName, /East Fox/i);
    assert.equal(ranked[0].confidence, "verified_parcel");
  });

  it("demotes Google candidates without real geometry below verified OSM", () => {
    const parsed = parsePartialAddress("302 Fox");
    const googleFake = candidate("302 East Fox St, South Bend, IN, USA", 41.68, -86.252, {
      provider: "google",
      hasGeometry: false,
    });
    const osmVerified = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
      provider: "photon",
    });

    const ranked = mergeAndRank([googleFake, osmVerified], parsed, NEAR_EAST_FOX, 5);
    assert.match(ranked[0].displayName, /East Fox Street/i);
    assert.notEqual(ranked[0].confidence, "ambiguous");
  });

  it("ranks verified exact match with proximity reason", () => {
    const parsed = parsePartialAddress("302 E Fox");
    const east = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });
    const ranked = mergeAndRank([east], parsed, NEAR_EAST_FOX, 3);
    assert.equal(ranked[0].confidence, "verified_parcel");
    assert.match(ranked[0].rankReason, /exact match/i);
  });

  it("does not surface a same-number wrong-street candidate as exact", () => {
    const parsed = parsePartialAddress("2221 South Olive St");
    const michigan = candidate("2221 South Michigan Street, South Bend, IN 46614", 41.66, -86.25, {
      houseNumberVerified: true,
      city: "South Bend",
      zip: "46614",
      houseNumber: "2221",
      street: "South Michigan Street",
    });
    const ranked = mergeAndRank([michigan], parsed, NEAR_EAST_FOX, 5);
    assert.equal(ranked.length, 0);
    assert.notEqual(deriveConfidence(michigan, parsed), "verified_parcel");
    assert.notEqual(deriveConfidence(michigan, parsed), "verified_rooftop");
  });

  it("does not classify Jackson→Main as verified_parcel", () => {
    const parsed = parsePartialAddress("1818 South Jackson St");
    const main = candidate("1818 South Main Street, South Bend, IN 46614", 41.66, -86.25, {
      houseNumberVerified: true,
      city: "South Bend",
      zip: "46614",
      houseNumber: "1818",
      street: "South Main Street",
    });
    assert.notEqual(deriveConfidence(main, parsed), "verified_parcel");
    const ranked = mergeAndRank([main], parsed, NEAR_EAST_FOX, 5);
    assert.equal(ranked.length, 0);
  });

  it("filters Fort Wayne results when service area is enforced", () => {
    const parsed = parsePartialAddress("1616 Philippa St");
    const fortWayne = candidate("1616 Philippa Street, Fort Wayne, IN 46802", 41.08, -85.14, {
      houseNumberVerified: true,
      city: "Fort Wayne",
      zip: "46802",
      houseNumber: "1616",
      street: "Philippa Street",
    });
    const ranked = mergeAndRank([fortWayne], parsed, NEAR_EAST_FOX, 5, {
      enforceServiceArea: true,
    });
    assert.equal(ranked.length, 0);
  });
});

describe("deriveConfidence", () => {
  it("marks OSM housenumber matches as interpolated unless street+number+geometry agree", () => {
    const parsed = parsePartialAddress("302 Fox");
    const c = candidate("302 West Fox Street, South Bend, IN", 41.678, -86.265, {
      houseNumberVerified: false,
    });
    assert.equal(deriveConfidence(c, parsed), "interpolated");
  });

  it("marks ambiguous Google results without geometry", () => {
    const parsed = parsePartialAddress("302 Fox");
    const c = candidate("302 East Fox St, South Bend, IN, USA", 41.68, -86.252, {
      provider: "google",
      hasGeometry: false,
    });
    assert.equal(deriveConfidence(c, parsed), "ambiguous");
  });

  it("does not assign verified_parcel for a matching number on the wrong street", () => {
    const parsed = parsePartialAddress("2221 South Olive St");
    const c = candidate("2221 South Michigan Street, South Bend, IN 46614", 41.66, -86.25, {
      houseNumberVerified: true,
      street: "South Michigan Street",
      houseNumber: "2221",
    });
    assert.equal(deriveConfidence(c, parsed), "ambiguous");
  });
});

describe("streetsEquivalent", () => {
  it("does not treat Fox as Foxboro", () => {
    assert.equal(streetsEquivalent("Fox", "Foxboro"), false);
  });
});

describe("candidateHasHouseNumber", () => {
  it("detects exact house numbers", () => {
    assert.equal(candidateHasHouseNumber("302 East Fox Street", "302"), true);
    assert.equal(candidateHasHouseNumber("30 East Fox Street", "302"), false);
  });
});

describe("cache helpers", () => {
  it("buckets nearby coordinates together", () => {
    const a = locationBucket(41.67641, -86.25201);
    const b = locationBucket(41.67649, -86.25208);
    assert.equal(a, b);
  });

  it("uses bucketed location in autocomplete cache keys", () => {
    const keyA = autocompleteCacheKey({
      q: "302 Fox",
      near: { lat: 41.67641, lng: -86.25201 },
      city: "South Bend",
      state: "IN",
    });
    const keyB = autocompleteCacheKey({
      q: "302 Fox",
      near: { lat: 41.67649, lng: -86.25208 },
      city: "South Bend",
      state: "IN",
    });
    assert.equal(keyA, keyB);
  });

  it("evicts oldest LRU entry", () => {
    const cache = new LruCache<string>(2, 60_000);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    assert.equal(cache.get("b"), null);
    assert.equal(cache.get("a"), "1");
    assert.equal(cache.get("c"), "3");
  });
});

describe("abbreviated suffix normalization", () => {
  it("matches st suffix in scoring", () => {
    const parsed = parsePartialAddress("302 Fox st");
    const withStreet = candidate("302 East Fox Street, South Bend, IN 46601", 41.682, -86.24, {
      houseNumberVerified: true,
    });
    const ranked = mergeAndRank([withStreet], parsed, NEAR_EAST_FOX, 3);
    assert.match(ranked[0].displayName, /Fox/i);
  });
});
