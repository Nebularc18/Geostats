import assert from "node:assert/strict";
import test from "node:test";
import { matchesJourneySearch, parseStopNumber } from "./journey-search.ts";

test("accepts stop numbers with common thousands separators and optional prefix", () => {
  for (const value of ["10000", "10.000", "10,000", "10 000", "10\u00a0000", "Stop 10.000", "#10000"])
    assert.equal(parseStopNumber(value), 10000, value);
  for (const value of ["", "0", "-10", "1.5", "GC10000", "10.00", "9007199254740992"])
    assert.equal(parseStopNumber(value), null, value);
});

test("numeric searches match the exact sequence and preserve code/name searches", () => {
  const point = { sequence: 10000, gcCode: "GC23BXF", cacheName: "River crossing", locationName: "New Zealand" };
  assert.equal(matchesJourneySearch(point, "Stop 10.000"), true);
  assert.equal(matchesJourneySearch(point, "100"), false);
  for (const value of ["gc23bxf", "RIVER", "zealand", ""])
    assert.equal(matchesJourneySearch(point, value), true);
  assert.equal(matchesJourneySearch({ ...point, sequence: 100, cacheName: "10000" }, "10000"), false);
});
