import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSpokenHouseNumber,
  parsePastedAddresses,
  segmentAddresses,
} from "./addressSegmenter.js";

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

describe("address segmenter — newlines (A)", () => {
  it("splits newline-delimited addresses and keeps commas in the address", () => {
    const input = [
      "2221 S Olive St, South Bend, IN 46614",
      "2107 S Mead St, South Bend, IN 46613",
    ].join("\n");
    const parts = segmentAddresses(input);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].rawInput, "2221 S Olive St, South Bend, IN 46614");
    assert.equal(parts[1].rawInput, "2107 S Mead St, South Bend, IN 46613");
  });

  it("does not split on commas or the word and", () => {
    const parts = segmentAddresses("2221 South Olive Street and the alley, South Bend");
    assert.equal(parts.length, 1);
    assert.match(parts[0].rawInput, /and the alley/);
  });

  it("ignores blank lines", () => {
    const input = "2221 S Olive St\n\n\n2107 S Mead St\n";
    assert.equal(segmentAddresses(input).length, 2);
  });
});

describe("address segmenter — next-address phrases (B)", () => {
  it("splits a speech transcript on next address", () => {
    const input = [
      "twenty two twenty one south olive street next address",
      "twenty one oh seven south mead street next address",
      "nineteen eighteen west indiana avenue next address",
      "sixteen nineteen south warren street",
    ].join("\n");
    const parts = segmentAddresses(input);
    assert.equal(parts.length, 4);
    assert.equal(parts[0].rawInput, "twenty two twenty one south olive street");
    assert.equal(parts[1].rawInput, "twenty one oh seven south mead street");
    assert.equal(parts[2].rawInput, "nineteen eighteen west indiana avenue");
    assert.equal(parts[3].rawInput, "sixteen nineteen south warren street");
  });

  it("does not merge spoken addresses", () => {
    const parts = segmentAddresses(
      "2221 South Olive Street next address 2107 South Mead Street next address 1918 West Indiana Avenue"
    );
    assert.equal(parts.length, 3);
  });
});

describe("address segmenter — punctuation variants (C)", () => {
  const expected = ["2221 South Olive Street", "2107 South Mead Street"];

  it("treats next-address punctuation variants as equivalent", () => {
    const samples = [
      "2221 South Olive Street next address 2107 South Mead Street",
      "2221 South Olive Street, next address, 2107 South Mead Street",
      "2221 South Olive Street. Next Address. 2107 South Mead Street.",
    ];
    for (const sample of samples) {
      const parts = segmentAddresses(sample);
      assert.equal(parts.length, 2, sample);
      assert.deepEqual(parts.map((p) => p.rawInput), expected, sample);
    }
  });

  it("accepts new address and next stop as delimiters", () => {
    assert.equal(
      segmentAddresses("2221 South Olive Street new address 2107 South Mead Street").length,
      2
    );
    assert.equal(
      segmentAddresses("2221 South Olive Street next stop 2107 South Mead Street").length,
      2
    );
  });
});

describe("number-word normalization (D)", () => {
  it("normalizes paired tens+ones house numbers", () => {
    assert.equal(
      normalizeSpokenHouseNumber("twenty two twenty one south olive street"),
      "2221 south olive street"
    );
    assert.equal(
      normalizeSpokenHouseNumber("nineteen eighteen west indiana avenue"),
      "1918 west indiana avenue"
    );
  });

  it("normalizes oh and zero digits conservatively", () => {
    assert.equal(
      normalizeSpokenHouseNumber("thirty two oh one west calvert street"),
      "3201 west calvert street"
    );
    assert.equal(
      normalizeSpokenHouseNumber("two zero zero two south carlisle"),
      "2002 south carlisle"
    );
  });

  it("does not invent a house number when the parse is ambiguous", () => {
    const original = "one hundred twenty one south olive street";
    assert.equal(normalizeSpokenHouseNumber(original), original);
  });
});

describe("rawInput preservation (E)", () => {
  it("keeps spoken words in rawInput while normalizing searchInput", () => {
    const [entry] = segmentAddresses("twenty two twenty one south olive street");
    assert.equal(entry.rawInput, "twenty two twenty one south olive street");
    assert.equal(entry.searchInput, "2221 south olive street");
    assert.notEqual(entry.rawInput, entry.searchInput);
  });
});

describe("field-test parser count (F)", () => {
  it("parses 15 pasted addresses into 15 records", () => {
    const parts = segmentAddresses(FIELD_TEST_15.join("\n"));
    assert.equal(parts.length, 15);
    assert.deepEqual(parts.map((p) => p.rawInput), FIELD_TEST_15);
  });

  it("parsePastedAddresses still returns original strings", () => {
    assert.equal(parsePastedAddresses(FIELD_TEST_15.join("\n")).length, 15);
  });
});

describe("consecutive spoken addresses and express", () => {
  it("splits a punctuated dictate run without next-address", () => {
    const parts = segmentAddresses(
      "2221 South Olive Street. 2107 South Mead Street. 1918 West Indiana Avenue. 1818 South Jackson Street express. 2002 South Carlisle Street."
    );
    assert.equal(parts.length, 5);
    assert.equal(parts[0].rawInput, "2221 South Olive Street");
    assert.equal(parts[3].express, true);
    assert.equal(parts[3].searchInput.toLowerCase().includes("express"), false);
    assert.equal(parts[4].rawInput, "2002 South Carlisle Street");
    assert.equal(parts[4].express, false);
  });

  it("splits digit house numbers that follow a street suffix", () => {
    const parts = segmentAddresses(
      "2221 South Olive Street 2107 South Mead Street 1918 West Indiana Avenue"
    );
    assert.equal(parts.length, 3);
  });

  it("does not treat express as part of the search street", () => {
    const [entry] = segmentAddresses("1818 South Jackson Street express");
    assert.equal(entry.express, true);
    assert.match(entry.rawInput, /express/i);
    assert.equal(entry.searchInput.toLowerCase().includes("jackson"), true);
    assert.equal(entry.searchInput.toLowerCase().includes("express"), false);
  });
});
