import assert from "node:assert/strict";
import test from "node:test";
import { mysteryStorageKeys, safeRecipientMysteryImage } from "./mystery-storage.ts";

test("mystery storage is isolated by normalized API origin and exact user identity", () => {
  const first = mysteryStorageKeys("https://Example.com/api/", "user/a");
  const sameOrigin = mysteryStorageKeys("https://example.com/other", "user/a");
  const otherUser = mysteryStorageKeys("https://example.com", "user:a");
  const escapedLookalike = mysteryStorageKeys("https://example.com", "user_2Fa");
  const otherServer = mysteryStorageKeys("https://other.example.com", "user/a");

  assert.deepEqual(first, sameOrigin);
  assert.notEqual(first.caches, otherUser.caches);
  assert.notEqual(first.caches, escapedLookalike.caches);
  assert.notEqual(first.caches, otherServer.caches);
  assert.notEqual(first.deletionChannel, otherUser.deletionChannel);
  assert.match(first.caches, /^geostats-mysteries-v2:/);
});

test("mystery storage refuses an empty identity", () => {
  assert.throws(() => mysteryStorageKeys("https://example.com", "  "), /user ID/);
});

test("recipient images allow embedded raster data but not network requests", () => {
  assert.equal(safeRecipientMysteryImage("data:image/webp;base64,aGVsbG8="), "data:image/webp;base64,aGVsbG8=");
  assert.equal(safeRecipientMysteryImage("https://tracker.example/pixel"), undefined);
  assert.equal(safeRecipientMysteryImage("data:image/svg+xml,<svg/>"), undefined);
});
