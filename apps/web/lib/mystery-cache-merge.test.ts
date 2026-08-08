import assert from "node:assert/strict";
import test from "node:test";
import {
  fieldChangedSinceBaseline,
  fieldMergeDecision,
  mergeMysteryAttempts,
  mergeMysteryCaches,
  stableJsonStringify,
  type MergeableMysteryAttempt,
  type MergeableMysteryCache
} from "./mystery-cache-merge.ts";

test("compares snapshots by JSON content instead of property insertion order", () => {
  const first = {
    id: "cache-1",
    details: { notes: "same", image: null },
    attempts: [{ id: "attempt-1", state: "wrong" }]
  };
  const reordered = {
    attempts: [{ state: "wrong", id: "attempt-1" }],
    details: { image: null, notes: "same" },
    id: "cache-1"
  };

  assert.notEqual(JSON.stringify(first), JSON.stringify(reordered));
  assert.equal(stableJsonStringify(first), stableJsonStringify(reordered));
});

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

test("does not treat a legacy field without a baseline as a device edit", () => {
  assert.equal(fieldChangedSinceBaseline("device-fingerprint"), false);
  assert.equal(fieldChangedSinceBaseline("device-fingerprint", "device-fingerprint"), false);
  assert.equal(fieldChangedSinceBaseline("device-fingerprint", "older-server-fingerprint"), true);
});

test("detects device-only, server-only and concurrent field edits", () => {
  assert.deepEqual(fieldMergeDecision("device-new", "baseline", "baseline"), {
    preferIncoming: true,
    preserveConflict: false
  });
  assert.deepEqual(fieldMergeDecision("baseline", "server-new", "baseline"), {
    preferIncoming: false,
    preserveConflict: false
  });
  assert.deepEqual(fieldMergeDecision("device-new", "server-new", "baseline"), {
    preferIncoming: false,
    preserveConflict: true
  });
  assert.deepEqual(fieldMergeDecision("same-new", "same-new", "baseline"), {
    preferIncoming: true,
    preserveConflict: false
  });
});

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

test("merges coordinate values that are identical at mobile display precision", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "server-attempt", latitude: 56.1333331, longitude: 15.2500001 }),
    attempt({ id: "device-attempt", latitude: 56.1333334, longitude: 15.2500004, state: "correct" })
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "server-attempt");
  assert.equal(merged[0]?.state, "correct");
});

test("keeps coordinates that differ by one displayed thousandth of a minute", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "first", latitude: 56.133333, longitude: 15.25 }),
    attempt({ id: "second", latitude: 56.13335, longitude: 15.25 })
  ]);

  assert.equal(merged.length, 2);
});

test("keeps coordinates that mobile displays as distinct five-decimal values", () => {
  const merged = mergeMysteryAttempts([
    attempt({ id: "first", latitude: 56.000009, longitude: 15.25 }),
    attempt({ id: "second", latitude: 56.000019, longitude: 15.25 })
  ]);

  assert.equal(merged.length, 2);
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

test("keeps the strongest result and the newest device attempt metadata", () => {
  const merged = mergeMysteryAttempts([
    attempt({
      id: "server-attempt",
      state: "correct",
      updatedAt: "2026-02-01T00:00:00.000Z",
      note: "Older server note",
      source: "server-agent"
    }),
    attempt({
      id: "device-attempt",
      state: "wrong",
      updatedAt: "2026-02-02T00:00:00.000Z",
      note: "Newer device note",
      source: "device-edit"
    })
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "server-attempt");
  assert.equal(merged[0]?.state, "correct");
  assert.equal(merged[0]?.note, "Newer device note");
  assert.equal(merged[0]?.source, "device-edit");
  assert.equal(merged[0]?.updatedAt, "2026-02-02T00:00:00.000Z");
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

test("keeps an intentional device image removal during a server conflict", () => {
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

  assert.equal(mergeMysteryCaches(server, { ...server, image: undefined }).image, undefined);
});

test("keeps independent server notes and image when those device fields are unchanged", () => {
  const server: MergeableMysteryCache = {
    id: "server-cache-id",
    gcCode: "GC1234",
    name: "Mystery",
    area: "",
    country: "Sweden",
    status: "solving",
    notes: "New server notes",
    clues: [],
    sharedWith: [],
    attempts: [],
    image: "data:image/png;base64,new-server-image"
  };
  const staleDevice = {
    ...server,
    notes: "Old notes from the last sync",
    image: "data:image/png;base64,old-image",
    clues: ["offline device edit"]
  };

  const merged = mergeMysteryCaches(server, staleDevice, {
    preferIncomingNotes: false,
    preferIncomingImage: false
  });

  assert.equal(merged.notes, server.notes);
  assert.equal(merged.image, server.image);
  assert.deepEqual(merged.clues, ["offline device edit"]);
});

test("preserves ambiguous legacy device fields without overwriting the server", () => {
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
  const device = { ...server, notes: "Offline rewrite", image: undefined };
  const merged = mergeMysteryCaches(server, device, {
    preferIncomingNotes: false,
    preferIncomingImage: false,
    preserveNotesConflict: true,
    preserveImageConflict: true
  });

  assert.equal(merged.notes, "Server notes");
  assert.equal(merged.image, "data:image/png;base64,server");
  assert.deepEqual(merged.syncConflicts, {
    notes: { server: "Server notes", device: "Offline rewrite" },
    image: { server: "data:image/png;base64,server", device: null }
  });
});
