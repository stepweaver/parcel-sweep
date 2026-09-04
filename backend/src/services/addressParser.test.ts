import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAddressListHeuristic } from "./addressParser.js";
import { segmentAddresses } from "./addressSegmenter.js";

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

describe("address parser heuristic", () => {
  it("keeps a 15-line paste as 15 stops", () => {
    const result = parseAddressListHeuristic(FIELD_TEST_15.join("\n"));
    assert.equal(result.source, "heuristic");
    assert.equal(result.addresses.length, 15);
    assert.equal(
      result.addresses.filter((a) => a.rawInput && a.addressInput).length,
      15
    );
  });

  it("preserves an express flag through parse", () => {
    const result = parseAddressListHeuristic(
      "1818 South Jackson Street express\n2221 South Olive Street"
    );
    assert.equal(result.addresses.length, 2);
    assert.equal(result.addresses[0].express, true);
    assert.equal(result.addresses[1].express, false);
  });

  it("does not drop rows when mixing express and plain stops", () => {
    const spoken =
      "2221 South Olive Street. 2107 South Mead Street. 1918 West Indiana Avenue. 1818 South Jackson Street express. 2002 South Carlisle Street.";
    const result = parseAddressListHeuristic(spoken);
    assert.equal(result.addresses.length, 5);
    assert.equal(result.addresses.filter((a) => a.express).length, 1);
    assert.equal(segmentAddresses(spoken).length, result.addresses.length);
  });
});
