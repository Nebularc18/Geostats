import assert from "node:assert/strict";
import test from "node:test";
import { csvEscape, csvRow } from "./csv";

test("neutralizes spreadsheet formulas without changing the source value", () => {
  const value = "=HYPERLINK(\"https://example.test\",\"click\")";

  assert.equal(csvEscape(value), `"'=HYPERLINK(""https://example.test"",""click"")"`);
  assert.equal(value, "=HYPERLINK(\"https://example.test\",\"click\")");
});

test("neutralizes formulas hidden behind whitespace and control characters", () => {
  for (const value of [" +1+1", "\t@SUM(A1:A2)", "\u0000-2+3", "\r\n=cmd|' /C calc'!A0"]) {
    assert.equal(csvEscape(value).replace(/^"|"$/g, "").startsWith("'"), true, value);
  }
});

test("preserves normal CSV escaping and non-formula values", () => {
  assert.equal(csvRow(["GC123", "Finder, Jr.", 'said "hello"', "plain text"]), 'GC123,"Finder, Jr.","said ""hello""",plain text');
  assert.equal(csvEscape("one\ntwo"), '"one\ntwo"');
  assert.equal(csvEscape("1-2"), "1-2");
});
