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


test("bounded parsing stops before scanning records beyond the limit", () => {
  assert.deepEqual(parseCsvRows('a,b\r\nc,"multiline\nfield"\r\n', ",", { maxRows: 2 }), [["a", "b"], ["c", "multiline\nfield"]]);
  // An unterminated suffix must never reach the quoted-field parser.
  assert.throws(() => parseCsvRows('a\nb\n"unfinished', ",", { maxRows: 2 }), /row limit exceeded/);
  assert.throws(() => parseCsvRows('a\nb', ",", { maxRows: 1 }), /row limit exceeded/);
  assert.throws(() => parseCsvRows("a", ",", { maxRows: 0 }), /row limit exceeded/);
  assert.deepEqual(parseCsvRows("", ",", { maxRows: 0 }), []);
  assert.throws(() => parseCsvRows("", ",", { maxRows: -1 }), /maxRows/);
});
