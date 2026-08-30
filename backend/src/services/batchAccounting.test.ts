import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectProbableDuplicates,
  keepDuplicateStop,
  removeDuplicateStop,
  routeBlockedByVerification,
  summarizeVerificationCounts,
  type DuplicateCheckStop,
} from "./batchAccounting.js";

describe("count invariant (I)", () => {
  it("requires parsed === verified + needs_review + unresolved", () => {
    const summary = summarizeVerificationCounts(17, [
      ..."v".repeat(12).split("").map(() => "verified" as const),
      "needs_review",
      "needs_review",
      "needs_review",
      "unresolved",
      "unresolved",
    ]);
    assert.equal(summary.parsed, 17);
    assert.equal(summary.verified, 12);
    assert.equal(summary.needsReview, 3);
    assert.equal(summary.unresolved, 2);
    assert.equal(summary.accountedFor, 17);
    assert.equal(summary.ok, true);
  });

  it("fails when a result row is missing", () => {
    const summary = summarizeVerificationCounts(15, [
      "verified",
      "verified",
      "unresolved",
    ]);
    assert.equal(summary.ok, false);
    assert.notEqual(summary.accountedFor, 15);
  });
});

describe("route gate (O)", () => {
  it("blocks generation when any stop is needs_review or unresolved", () => {
    assert.equal(routeBlockedByVerification(["verified", "needs_review"]), true);
    assert.equal(routeBlockedByVerification(["verified", "unresolved"]), true);
    assert.equal(routeBlockedByVerification(["verified", "verified"]), false);
  });
});

describe("probable duplicate detection (J, K)", () => {
  const olive: DuplicateCheckStop = {
    id: "a",
    rawInput: "2221 South Olive St",
    address: "2221 South Olive Street, South Bend, IN 46613",
    placeId: "place-olive",
    lat: 41.652,
    lng: -86.251,
  };
  const oliveVariant: DuplicateCheckStop = {
    id: "b",
    rawInput: "2221 S Olive Street",
    address: "2221 South Olive Street, South Bend, IN 46613",
    placeId: "place-olive",
    lat: 41.65201,
    lng: -86.25101,
  };

  it("flags the same house+street / placeId as a probable duplicate without removing it", () => {
    const flags = detectProbableDuplicates([olive, oliveVariant]);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].stopId, "b");
    assert.equal(flags[0].otherStopId, "a");
    assert.match(flags[0].reason, /stop 1/i);
    assert.equal([olive, oliveVariant].length, 2);
  });

  it("keep both leaves both stops and suppresses the flag", () => {
    const kept = keepDuplicateStop([olive, oliveVariant], "b");
    assert.equal(kept.length, 2);
    assert.equal(kept[1].duplicateKept, true);
    assert.equal(detectProbableDuplicates(kept).length, 0);
  });

  it("remove duplicate drops only the flagged stop", () => {
    const remaining = removeDuplicateStop([olive, oliveVariant], "b");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, "a");
  });
});
