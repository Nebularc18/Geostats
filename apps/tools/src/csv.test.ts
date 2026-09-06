import assert from "node:assert/strict";
import test from "node:test";
import { csvEscape, csvRow } from "./csv";

test("csvEscape neutralizes spreadsheet formulas after leading whitespace", () => {
  for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "\t=1+1", "\uFEFF@cmd"]) {
    assert.ok(csvEscape(value).replace(/^"|"$/g, "").startsWith("'"));
  }
});

test("csvEscape preserves ordinary values and RFC 4180 quoting", () => {
  assert.equal(csvEscape("Harbor Cache"), "Harbor Cache");
  assert.equal(csvEscape('text, with "quotes"'), '"text, with ""quotes"""');
  assert.equal(csvRow(["GC123", "line one\nline two"]), 'GC123,"line one\nline two"');
});
