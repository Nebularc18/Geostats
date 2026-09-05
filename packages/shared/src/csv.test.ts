import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvRows } from "./csv";

test("preserves quoted delimiters, escaped quotes, whitespace, and multiline fields", () => {
  assert.deepEqual(
    parseCsvRows('code,note\r\nGC123,"  said ""hello"", then\r\nleft  "\r\n'),
    [
      ["code", "note"],
      ["GC123", '  said "hello", then\r\nleft  '],
    ],
  );
});

test("supports importer delimiters, empty fields, and all record line endings", () => {
  for (const delimiter of [",", ";", "\t", "|"]) {
    assert.deepEqual(
      parseCsvRows(
        `a${delimiter}b\rc${delimiter}\nd${delimiter}e\r\n`,
        delimiter,
      ),
      [
        ["a", "b"],
        ["c", ""],
        ["d", "e"],
      ],
    );
  }
  assert.deepEqual(parseCsvRows(""), []);
  assert.deepEqual(parseCsvRows(","), [["", ""]]);
});

test("rejects truncated quoted input rather than importing a partial record", () => {
  assert.throws(
    () => parseCsvRows('code,note\nGC123,"unfinished'),
    /unclosed quoted field/,
  );
});
