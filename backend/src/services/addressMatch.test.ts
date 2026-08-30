import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isForbiddenLocality,
  isQuickRouteServiceAreaResult,
  isQuickRouteZip,
  isSouthBendLocality,
  normalizeStreetCore,
  parsePartialAddress,
  requestedStreetMatchesCandidate,
  streetsEquivalent,
} from "./addressMatch.js";

describe("street core normalization", () => {
  it("treats S Jackson St and South Jackson Street as equivalent", () => {
    assert.equal(normalizeStreetCore("S Jackson St"), "jackson");
    assert.equal(normalizeStreetCore("South Jackson Street"), "jackson");
    assert.equal(streetsEquivalent("S Jackson St", "South Jackson Street"), true);
  });

  it("treats W Indiana Ave and West Indiana Avenue as equivalent", () => {
    assert.equal(streetsEquivalent("W Indiana Ave", "West Indiana Avenue"), true);
    assert.equal(streetsEquivalent("1918 W Indiana Ave", "1918 West Indiana Avenue"), true);
  });

  it("does not treat Fox as equivalent to Foxboro", () => {
    assert.equal(streetsEquivalent("Fox", "Foxboro"), false);
    assert.equal(requestedStreetMatchesCandidate("Fox", "Foxboro"), false);
  });

  it("does not treat Olive as equivalent to Michigan", () => {
    assert.equal(streetsEquivalent("Olive", "Michigan"), false);
    assert.equal(requestedStreetMatchesCandidate("2221 South Olive St", "2221 South Michigan Street"), false);
  });

  it("does not treat Jackson as equivalent to Main", () => {
    assert.equal(streetsEquivalent("Jackson", "Main"), false);
  });

  it("does not treat Mead as equivalent to Michigan", () => {
    assert.equal(streetsEquivalent("Mead", "Michigan"), false);
  });

  it("does not treat Brookfield as equivalent to Michigan", () => {
    assert.equal(streetsEquivalent("Brookfield", "Michigan"), false);
  });
});

describe("Quick Route ZIP and locality", () => {
  it("allows 46613 and 46614 only", () => {
    assert.equal(isQuickRouteZip("46613"), true);
    assert.equal(isQuickRouteZip("46614"), true);
    assert.equal(isQuickRouteZip("46601"), false);
    assert.equal(isQuickRouteZip("46616"), false);
    assert.equal(isQuickRouteZip("46628"), false);
  });

  it("expects South Bend and rejects other cities", () => {
    assert.equal(isSouthBendLocality("South Bend"), true);
    assert.equal(isForbiddenLocality("Fort Wayne"), true);
    assert.equal(isForbiddenLocality("Indianapolis"), true);
    assert.equal(isForbiddenLocality("Chicago"), true);
    assert.equal(isForbiddenLocality("Milwaukee"), true);
  });

  it("rejects Fort Wayne and non-allowlist ZIPs as service-area results", () => {
    assert.equal(
      isQuickRouteServiceAreaResult({
        city: "South Bend",
        state: "IN",
        zip: "46614",
      }),
      true
    );
    assert.equal(
      isQuickRouteServiceAreaResult({
        city: "Fort Wayne",
        state: "IN",
        zip: "46802",
        displayName: "1616 Philippa St, Fort Wayne, IN",
      }),
      false
    );
    assert.equal(
      isQuickRouteServiceAreaResult({
        city: "South Bend",
        state: "IN",
        zip: "46628",
      }),
      false
    );
    assert.equal(
      isQuickRouteServiceAreaResult({
        city: "Chicago",
        state: "IL",
        zip: "60601",
      }),
      false
    );
  });
});

describe("house number cannot rescue a wrong street", () => {
  it("2221 Olive vs 2221 Michigan is not a street match", () => {
    const parsed = parsePartialAddress("2221 South Olive St");
    assert.equal(parsed.houseNumber, "2221");
    assert.equal(requestedStreetMatchesCandidate("2221 South Olive St", "2221 South Michigan Street"), false);
  });

  it("1818 Jackson vs 1818 Main is not a street match", () => {
    assert.equal(
      requestedStreetMatchesCandidate("1818 South Jackson St", "1818 South Main Street"),
      false
    );
  });
});
