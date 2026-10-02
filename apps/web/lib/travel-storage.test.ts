import assert from "node:assert/strict";
import test from "node:test";
import { mysteryStorageKeys } from "./mystery-storage.ts";
import { createTravelSessionBoundary, keepTravelSessionAfterNetworkFailure, readTravelStorage, travelStorageKeys } from "./travel-storage.ts";

test("Travel shares only the current account's Mysteries cache and isolates plans by server and identity", () => {
  const keys = travelStorageKeys("https://EXAMPLE.com/api/", "user/a");
  assert.equal(keys.caches, mysteryStorageKeys("https://example.com", "user/a").caches);
  assert.deepEqual(keys, travelStorageKeys("https://example.com/other", "user/a"));
  for (const other of [
    travelStorageKeys("https://example.com", "user:a"),
    travelStorageKeys("https://example.com", "user_2Fa"),
    travelStorageKeys("https://other.example.com", "user/a")
  ]) {
    assert.notEqual(keys.caches, other.caches);
    assert.notEqual(keys.plans, other.plans);
  }
  assert.throws(() => travelStorageKeys("https://example.com", " "), /user ID/);
});

test("switching accounts cannot hydrate the previous account or ambiguous legacy private snapshots", () => {
  const boundary = createTravelSessionBoundary();
  const first = boundary.activate("https://example.com", "alice");
  const entries = new Map([
    ["geostats-mysteries-v1", JSON.stringify([{ notes: "legacy private solution" }])],
    ["geostats-travel-plans-v2", JSON.stringify([{ name: "legacy private trip" }])],
    [first.keys.caches, JSON.stringify([{ notes: "Alice's private solution" }])],
    [first.keys.plans, JSON.stringify([{ name: "Alice's private trip" }])]
  ]);
  const reads: string[] = [];
  const storage = { getItem(key: string) { reads.push(key); return entries.get(key) ?? null; } };
  assert.deepEqual(readTravelStorage(storage, first), {
    caches: [{ notes: "Alice's private solution" }], plans: [{ name: "Alice's private trip" }]
  });
  const second = boundary.activate("https://example.com", "bob");
  reads.length = 0;
  assert.deepEqual(readTravelStorage(storage, second), { caches: [], plans: [] });
  assert.deepEqual(reads, [second.keys.caches, second.keys.plans]);
  reads.length = 0;
  assert.deepEqual(readTravelStorage(storage, first), { caches: [], plans: [] });
  assert.deepEqual(reads, []);
  boundary.clear();
});

test("late search and sync completions remain invalid after logout and re-login to the same account", async () => {
  const boundary = createTravelSessionBoundary();
  const first = boundary.activate("https://example.com", "alice");
  let finish!: () => void;
  const response = new Promise<void>((resolve) => { finish = resolve; });
  const applied: string[] = [];
  const pending = response.then(() => {
    if (first.isCurrent()) applied.push("old account response");
  });
  boundary.clear();
  const next = boundary.activate("https://example.com", "alice");
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(next.isCurrent(), true);
  finish();
  await pending;
  assert.deepEqual(applied, []);
  assert.equal(boundary.activate("https://example.com", "alice"), next);
  boundary.clear();
});

test("a verified mounted workspace remains usable offline, but not after an auth epoch change or auth rejection", () => {
  const boundary = createTravelSessionBoundary();
  const session = boundary.activate("https://example.com", "alice");
  const offline = new TypeError("Failed to fetch");
  assert.equal(keepTravelSessionAfterNetworkFailure(session, offline, 3, 3), true);
  assert.equal(keepTravelSessionAfterNetworkFailure(session, offline, 3, 4), false);
  assert.equal(keepTravelSessionAfterNetworkFailure(session, new Error("Unauthorized"), 3, 3), false);
  assert.equal(keepTravelSessionAfterNetworkFailure(null, offline, 3, 3), false);
  boundary.clear();
  assert.equal(keepTravelSessionAfterNetworkFailure(session, offline, 3, 3), false);
});
