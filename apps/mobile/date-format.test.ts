import assert from "node:assert/strict";
import test from "node:test";
import { formatSwedishDate } from "./date-format";

test("formats app dates in Swedish year-month-day order", () => {
  assert.equal(formatSwedishDate("2026-09-02T12:00:00"), "2026-09-02");
});

test("preserves missing and invalid date fallbacks", () => {
  assert.equal(formatSwedishDate(null), "-");
  assert.equal(formatSwedishDate("not-a-date"), "not-a-date");
});
