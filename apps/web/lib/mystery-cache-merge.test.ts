import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeMysteryAttempts,
  mergeMysteryCaches,
  type MergeableMysteryAttempt,
  type MergeableMysteryCache
} from "./mystery-cache-merge.ts";

function attempt(overrides: Partial<MergeableMysteryAttempt>): MergeableMysteryAttempt {
  return {
    id: "attempt-1",
    kind: "coordinate",
    latitude: 59.4,
    longitude: 18.3,
    state: "wrong",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("merges duplicate offline and server coordinates into one attempt", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "server-attempt" }),
    attempt({
      id: "offline-attempt",
      state: "correct",
      finalLatitude: 59.41,
      finalLongitude: 18.31
    })
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], attempt({
    id: "server-attempt",
    state: "correct",
    finalLatitude: 59.41,
    finalLongitude: 18.31
  }));
});

test("keeps every distinct coordinate while preserving sync confirmation", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "first", geocachingSyncedAt: "2026-02-01T00:00:00.000Z" }),
    attempt({ id: "duplicate", state: "correct" }),
    attempt({ id: "different", latitude: 59.5, longitude: 18.4 })
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, "first");
  assert.equal(merged[0]?.state, "correct");
  assert.equal(merged[0]?.geocachingSyncedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(merged[1]?.id, "different");
});

test("merges repeated keyword attempts independently from coordinate attempts", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "keyword-server", kind: "keyword", answer: " North ", latitude: undefined, longitude: undefined }),
    attempt({ id: "keyword-offline", kind: "keyword", answer: "north", latitude: undefined, longitude: undefined, state: "correct", finalLatitude: 59.6, finalLongitude: 18.5 }),
    attempt({ id: "coordinate", latitude: 59.6, longitude: 18.5 })
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, "keyword-server");
  assert.equal(merged[0]?.state, "correct");
  assert.equal(merged[1]?.id, "coordinate");
});

test("reconnect produces one cache with both server and offline coordinates", () => {
  const base: MergeableMysteryCache = {
    id: "server-cache-id",
    gcCode: "GC1234",
    name: "Mystery",
    area: "",
    country: "Sweden",
    status: "solving",
    notes: "Server notes",
    clues: ["server clue"],
    sharedWith: [],
    attempts: [attempt({ id: "server-coordinate" })]
  };
  const merged = mergeMysteryCaches(base, {
    ...base,
    id: "offline-cache-id",
    status: "solved",
    notes: "Longer offline notes",
    clues: ["offline clue"],
    attempts: [
      attempt({ id: "offline-duplicate", state: "correct" }),
      attempt({ id: "offline-coordinate", latitude: 59.5, longitude: 18.4 })
    ]
  });

  assert.equal(merged.id, "server-cache-id");
  assert.equal(merged.status, "solved");
  assert.equal(merged.notes, "Longer offline notes");
  assert.deepEqual(merged.clues, ["server clue", "offline clue"]);
  assert.deepEqual(merged.attempts.map(({ id }) => id), ["server-coordinate", "offline-coordinate"]);
  assert.equal(merged.attempts[0]?.state, "correct");
});

test("device notes and images win a server conflict even when notes are shorter", () => {
  const server: MergeableMysteryCache = {
    id: "server-cache-id",
    gcCode: "GC1234",
    name: "Mystery",
    area: "",
    country: "Sweden",
    status: "solving",
    notes: "Long server notes that the device user intentionally rewrote",
    clues: [],
    sharedWith: [],
    attempts: [],
    image: "data:image/png;base64,server"
  };

  const merged = mergeMysteryCaches(server, {
    ...server,
    notes: "Short rewrite",
    image: "data:image/png;base64,device"
  });

  assert.equal(merged.notes, "Short rewrite");
  assert.equal(merged.image, "data:image/png;base64,device");
});

test("keeps a server image when the incoming device has no image", () => {
  const server: MergeableMysteryCache = {
    id: "server-cache-id",
    gcCode: "GC1234",
    name: "Mystery",
    area: "",
    country: "Sweden",
    status: "solving",
    notes: "Server notes",
    clues: [],
    sharedWith: [],
    attempts: [],
    image: "data:image/png;base64,server"
  };

  assert.equal(mergeMysteryCaches(server, { ...server, image: undefined }).image, server.image);
});
