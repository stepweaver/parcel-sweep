import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LruCache,
  autocompleteCacheKey,
  candidateHasHouseNumber,
  deriveConfidence,
  expandSearchQueries,
  fuzzyStreetMatch,
  locationBucket,
  mergeAndRank,
  parsePartialAddress,
  scoreCandidate,
  shouldRetryNationwide,
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
  it("expands ambiguous Fox query with East/West variants", () => {
    const queries = expandSearchQueries("302 Fox", "South Bend", "IN");
    assert.ok(queries.some((q) => q.includes("East Fox")));
    assert.ok(queries.some((q) => q.includes("West Fox")));
  });

  it("does not append South Bend when searching nationwide", () => {
    const queries = expandSearchQueries("123 Oak St, Chicago, IL", "South Bend", "IN", false);
    assert.deepEqual(queries, ["123 Oak St, Chicago, IL"]);
  });
});

describe("shouldRetryNationwide", () => {
  it("retries when query names a different city", () => {
    assert.equal(shouldRetryNationwide("123 Main St, Chicago, IL", "South Bend"), true);
    assert.equal(shouldRetryNationwide("302 Fox St, South Bend, IN", "South Bend"), false);
  });

  it("retries for non-local zip codes", () => {
    assert.equal(shouldRetryNationwide("123 Main St 60601", "South Bend"), true);
    assert.equal(shouldRetryNationwide("302 Fox 46601", "South Bend"), false);
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

  it("labels street-only matches", () => {
    const parsed = parsePartialAddress("302 Fox");
    const streetOnly = candidate("East Fox Street, South Bend, IN 46601", 41.682, -86.24);
    const ranked = mergeAndRank([streetOnly], parsed, NEAR_EAST_FOX, 3);
    assert.equal(ranked[0].confidence, "street_only");
    assert.match(ranked[0].rankReason, /street match only/i);
  });
});

describe("deriveConfidence", () => {
  it("marks unverified house numbers on failed streets", () => {
    const parsed = parsePartialAddress("302 Fox");
    const c = candidate("302 West Fox Street, South Bend, IN", 41.678, -86.265, {
      houseNumberVerified: false,
    });
    assert.equal(deriveConfidence(c, parsed), "street_matched_number_unverified");
  });

  it("marks ambiguous Google results without geometry", () => {
    const parsed = parsePartialAddress("302 Fox");
    const c = candidate("302 East Fox St, South Bend, IN, USA", 41.68, -86.252, {
      provider: "google",
      hasGeometry: false,
    });
    assert.equal(deriveConfidence(c, parsed), "ambiguous");
  });
});

describe("fuzzyStreetMatch", () => {
  it("matches typo-tolerant street prefixes", () => {
    assert.equal(fuzzyStreetMatch("ewi", "ewing"), true);
    assert.equal(fuzzyStreetMatch("fox", "foxboro"), true);
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
