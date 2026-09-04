import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendTranscript,
  normalizeSpokenHouseNumber,
  segmentAddresses,
} from "./addressSegmenter";
import {
  detectProbableDuplicates,
  keepDuplicateStop,
  removeDuplicateStop,
  routeBlockedByVerification,
  summarizeVerificationCounts,
} from "./batchAccounting";
import {
  applyResolvedBatchEntry,
  applyStopSearchEdit,
  mergeImportedStops,
  newStop,
  newStopFromSegment,
  stopBlocksRoute,
  stopIsFilled,
  type QuickRouteStop,
} from "./quickRouteStops";
import type { AddressSuggestion } from "../components/AddressAutocomplete";

const FIELD_TEST_15 = [
  "2221 South Olive St",
  "2107 South Mead St",
  "1918 W Indiana Ave",
  "1619 South Warren St",
  "1818 South Jackson St",
  "1916 Wabash St",
  "2002 South Carlisle St",
  "3001 West Calvert St",
  "1616 Philippa St",
  "1925 W Indiana Ave",
  "2239 South Mead St",
  "2014 South Brookfield St",
  "1830 Philippa St",
  "3201 West Calvert St",
  "1917 South Jackson St",
];

function suggestion(
  overrides: Partial<AddressSuggestion> & Pick<AddressSuggestion, "displayName">
): AddressSuggestion {
  return {
    placeId: overrides.placeId ?? overrides.displayName,
    displayName: overrides.displayName,
    lat: overrides.lat ?? 41.652,
    lng: overrides.lng ?? -86.251,
    confidence: overrides.confidence ?? "verified_parcel",
    rankReason: "Suggested match",
    city: overrides.city ?? "South Bend",
    state: overrides.state ?? "IN",
    zip: overrides.zip ?? "46613",
    houseNumber: overrides.houseNumber,
    street: overrides.street,
  };
}

describe("frontend segmenter (A, B, C, D, E, F)", () => {
  it("splits on newlines", () => {
    assert.equal(segmentAddresses(FIELD_TEST_15.join("\n")).length, 15);
  });

  it("splits spoken next-address transcripts into 4 records", () => {
    const parts = segmentAddresses(
      "twenty two twenty one south olive street next address twenty one oh seven south mead street next address nineteen eighteen west indiana avenue next address sixteen nineteen south warren street"
    );
    assert.equal(parts.length, 4);
  });

  it("treats punctuation variants as equivalent", () => {
    const a = segmentAddresses("2221 South Olive Street next address 2107 South Mead Street");
    const b = segmentAddresses("2221 South Olive Street, next address, 2107 South Mead Street");
    const c = segmentAddresses("2221 South Olive Street. Next Address. 2107 South Mead Street.");
    assert.equal(a.length, 2);
    assert.deepEqual(a.map((p) => p.rawInput), b.map((p) => p.rawInput));
    assert.deepEqual(a.map((p) => p.rawInput), c.map((p) => p.rawInput));
  });

  it("normalizes number words without changing rawInput", () => {
    const [entry] = segmentAddresses("twenty two twenty one south olive street");
    assert.equal(entry.rawInput, "twenty two twenty one south olive street");
    assert.equal(entry.searchInput, "2221 south olive street");
    assert.equal(
      normalizeSpokenHouseNumber("two zero zero two south carlisle"),
      "2002 south carlisle"
    );
  });

  it("appends only committed transcript text", () => {
    assert.equal(appendTranscript("2221 South Olive", "next address"), "2221 South Olive next address");
  });

  it("splits a punctuated dictate run and flags express", () => {
    const parts = segmentAddresses(
      "2221 South Olive Street. 2107 South Mead Street. 1818 South Jackson Street express."
    );
    assert.equal(parts.length, 3);
    assert.equal(parts[2].express, true);
    assert.equal(parts[2].searchInput.toLowerCase().includes("express"), false);
  });
});

describe("frontend count invariant and route gate (I, O)", () => {
  it("accounts for every parsed address", () => {
    const summary = summarizeVerificationCounts(15, [
      ...Array.from({ length: 9 }, () => "verified" as const),
      ...Array.from({ length: 2 }, () => "needs_review" as const),
      ...Array.from({ length: 4 }, () => "unresolved" as const),
    ]);
    assert.equal(summary.ok, true);
    assert.equal(summary.accountedFor, 15);
  });

  it("blocks the route while any filled stop is not verified", () => {
    const verified: QuickRouteStop = {
      id: "1",
      rawInput: "1918 W Indiana Ave",
      address: "1918 West Indiana Avenue, South Bend, IN 46614",
      lat: 41.652,
      lng: -86.251,
      placeId: "p",
      verificationStatus: "verified",
      express: false,
    };
    const review: QuickRouteStop = {
      id: "2",
      rawInput: "1818 South Jackson St",
      address: "1818 South Jackson St",
      verificationStatus: "needs_review",
      express: false,
    };
    assert.equal(stopBlocksRoute(verified), false);
    assert.equal(stopBlocksRoute(review), true);
    assert.equal(
      routeBlockedByVerification([verified, review].filter(stopIsFilled).map((s) => s.verificationStatus)),
      true
    );
  });
});

describe("duplicates remain unless removed (J, K)", () => {
  it("flags Olive variants and keep/remove work", () => {
    const a = newStop("2221 South Olive St");
    const b = newStop("2221 S Olive Street");
    a.address = "2221 South Olive Street, South Bend, IN 46613";
    b.address = "2221 South Olive Street, South Bend, IN 46613";
    a.placeId = "olive";
    b.placeId = "olive";
    const flags = detectProbableDuplicates([a, b]);
    assert.equal(flags.length, 1);
    const kept = keepDuplicateStop([a, b], b.id);
    assert.equal(kept.length, 2);
    assert.equal(detectProbableDuplicates(kept).length, 0);
    assert.equal(removeDuplicateStop([a, b], b.id).length, 1);
  });
});

describe("apply batch result (E, M, P)", () => {
  it("preserves rawInput and the same stop id on re-resolve", () => {
    const segment = {
      rawInput: "twenty two twenty one south olive street",
      searchInput: "2221 south olive street",
      express: false,
    };
    const stop = newStopFromSegment(segment, "same-id");
    const olive = suggestion({
      displayName: "2221 South Olive Street, South Bend, IN 46613",
      houseNumber: "2221",
      street: "South Olive Street",
      zip: "46613",
    });
    const verified = applyResolvedBatchEntry(stop, {
      id: stop.id,
      rawInput: stop.rawInput,
      normalizedInput: stop.searchInput ?? "",
      status: "verified",
      candidate: olive,
    });
    assert.equal(verified.id, "same-id");
    assert.equal(verified.rawInput, "twenty two twenty one south olive street");
    assert.equal(verified.address, olive.displayName);
    assert.equal(verified.verificationStatus, "verified");

    const edited = applyStopSearchEdit(verified, "2221 South Olive Street");
    assert.equal(edited.id, "same-id");
    assert.equal(edited.rawInput, "twenty two twenty one south olive street");
    assert.equal(edited.verificationStatus, "unresolved");

    const again = applyResolvedBatchEntry(edited, {
      id: edited.id,
      rawInput: edited.rawInput,
      normalizedInput: edited.searchInput ?? "",
      status: "verified",
      candidate: olive,
    });
    assert.equal(again.id, "same-id");
    assert.equal(again.rawInput, "twenty two twenty one south olive street");
    assert.equal(again.verificationStatus, "verified");
  });

  it("does not verify Olive as Michigan through the batch apply path", () => {
    const stop = newStopFromSegment({
      rawInput: "2221 South Olive St",
      searchInput: "2221 South Olive St",
      express: false,
    });
    const michigan = suggestion({
      displayName: "2221 South Michigan Street, South Bend, IN 46614",
      houseNumber: "2221",
      street: "South Michigan Street",
      zip: "46614",
    });
    const applied = applyResolvedBatchEntry(stop, {
      id: stop.id,
      rawInput: stop.rawInput,
      normalizedInput: "2221 South Olive St",
      status: "verified",
      candidate: michigan,
    });
    assert.notEqual(applied.verificationStatus, "verified");
  });
});

describe("batch import does not destroy existing stops", () => {
  it("adds to the current list by default", () => {
    const existing = [newStop("1918 W Indiana Ave")];
    const incoming = [newStop("2221 South Olive St")];
    const merged = mergeImportedStops(existing, incoming, false);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].rawInput, "1918 W Indiana Ave");
    assert.equal(merged[1].rawInput, "2221 South Olive St");
  });

  it("replaces only when asked", () => {
    const existing = [newStop("1918 W Indiana Ave")];
    const incoming = [newStop("2221 South Olive St")];
    const replaced = mergeImportedStops(existing, incoming, true);
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].rawInput, "2221 South Olive St");
  });
});
