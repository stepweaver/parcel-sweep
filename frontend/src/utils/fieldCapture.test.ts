import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segmentAddresses } from "./addressSegmenter";
import {
  applyStopTextEdit,
  newStopFromSegment,
  restoreDeletedStop,
  snapshotDeleteStop,
  toggleStopExpress,
  UNDO_DELETE_MS,
} from "./quickRouteStops";

describe("field capture express and undo", () => {
  it("carries express from a spoken segment onto the stop", () => {
    const [segment] = segmentAddresses("1818 South Jackson Street express");
    const stop = newStopFromSegment(segment, "express-1");
    assert.equal(stop.express, true);
    assert.equal(stop.searchInput.toLowerCase().includes("express"), false);
    const toggled = toggleStopExpress(stop);
    assert.equal(toggled.express, false);
    assert.equal(toggled.verificationStatus, stop.verificationStatus);
  });

  it("edit reruns as unresolved but keeps the express flag", () => {
    const [segment] = segmentAddresses("1818 South Jackson Street express");
    const stop = newStopFromSegment(segment, "express-2");
    const edited = applyStopTextEdit(stop, "1818 South Jackson St");
    assert.equal(edited.express, true);
    assert.equal(edited.verificationStatus, "unresolved");
    assert.equal(edited.id, "express-2");
  });

  it("undo restore puts a deleted stop back in the same place", () => {
    const a = newStopFromSegment({ rawInput: "A St", searchInput: "A St", express: false }, "a");
    const b = newStopFromSegment({ rawInput: "B St", searchInput: "B St", express: true }, "b");
    const c = newStopFromSegment({ rawInput: "C St", searchInput: "C St", express: false }, "c");
    const { next, snapshot } = snapshotDeleteStop([a, b, c], "b");
    assert.equal(next.map((s) => s.id).join(","), "a,c");
    assert.ok(snapshot);
    const restored = restoreDeletedStop(next, snapshot);
    assert.equal(restored.map((s) => s.id).join(","), "a,b,c");
    assert.equal(restored[1].express, true);
    assert.equal(UNDO_DELETE_MS, 8000);
  });

  it("splits a field-style dictate run into the same number of stops", () => {
    const parts = segmentAddresses(
      "2221 South Olive Street. 2107 South Mead Street. 1918 West Indiana Avenue. 1818 South Jackson Street express. 2002 South Carlisle Street."
    );
    assert.equal(parts.length, 5);
    assert.equal(parts.filter((p) => p.express).length, 1);
  });
});
