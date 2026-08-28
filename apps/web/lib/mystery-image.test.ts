import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMysteryImageUrl } from "./mystery-image.ts";

test("accepts absolute web image URLs", () => {
  assert.equal(
    normalizeMysteryImageUrl("  https://images.example.com/clues/map%201.png?size=large  "),
    "https://images.example.com/clues/map%201.png?size=large"
  );
  assert.equal(normalizeMysteryImageUrl("http://example.com/clue.jpg"), "http://example.com/clue.jpg");
});

test("rejects non-web, relative and credential-bearing URLs", () => {
  assert.equal(normalizeMysteryImageUrl("data:image/png;base64,abc"), null);
  assert.equal(normalizeMysteryImageUrl("javascript:alert(1)"), null);
  assert.equal(normalizeMysteryImageUrl("/clue.png"), null);
  assert.equal(normalizeMysteryImageUrl("https://user:secret@example.com/clue.png"), null);
  assert.equal(normalizeMysteryImageUrl(""), null);
});
