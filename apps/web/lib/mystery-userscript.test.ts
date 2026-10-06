import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { userscript } from "./mystery-userscript.ts";

function runGeostatsScript(initialStorage: Record<string, string> = {}) {
  const attributes = new Map<string, string>();
  const storage = new Map(Object.entries(initialStorage));
  const listeners = new Map<string, () => void>();
  const events: string[] = [];
  const receipts: string[] = [];
  runInNewContext(userscript("https://geostats.example"), {
    location: { origin: "https://geostats.example" },
    document: {
      documentElement: {
        getAttribute: (key: string) => attributes.get(key),
        setAttribute: (key: string, value: string) =>
          attributes.set(key, value),
      },
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        if (event.type === "geostats-sync-receipt")
          receipts.push(attributes.get("data-geostats-sync-receipt")!);
      },
    },
    window: { setInterval: () => 0 },
    Event,
    GM_getValue: (key: string, fallback: string) =>
      storage.get(key) ?? fallback,
    GM_setValue: (key: string, value: string) => storage.set(key, value),
    GM_deleteValue: (key: string) => storage.delete(key),
    GM_listValues: () => [...storage.keys()],
  });
  return {
    storage,
    attributes,
    events,
    receipts,
    request(name: string, payload: unknown) {
      attributes.set(`data-${name}`, JSON.stringify(payload));
      const listener = listeners.get(name);
      assert.ok(listener, `Missing ${name} handler`);
      listener();
    },
  };
}

const coordinateRequest = {
  cacheId: "cache-1",
  attemptId: "attempt-1",
  gcCode: "GC123",
  latitude: 59,
  longitude: 18,
  coordinateText: "N 59 E 18",
  solved: true,
  issuedAt: 12345,
};

test("generated userscript queues a solved coordinate and acknowledges the exact request", () => {
  const script = runGeostatsScript();
  script.request("geostats-sync-request", coordinateRequest);
  assert.deepEqual(
    JSON.parse(script.storage.get("geostats-pending-coordinate-sync")!),
    [coordinateRequest],
  );
  assert.equal(
    script.attributes.get("data-geostats-sync-ready"),
    "attempt-1:12345",
  );
  assert.deepEqual(script.events, ["geostats-sync-ready"]);
});

test("coordinate batches are rejected atomically if any request is invalid", () => {
  for (const invalid of [
    { solved: false },
    { latitude: 91 },
    { longitude: NaN },
    { gcCode: "invalid" },
  ]) {
    const script = runGeostatsScript();
    script.request("geostats-sync-request", {
      batchId: "batch-1",
      requests: [coordinateRequest, { ...coordinateRequest, ...invalid }],
    });
    assert.equal(script.storage.size, 0);
    assert.deepEqual(script.events, []);
  }
  const script = runGeostatsScript();
  script.request("geostats-sync-request", {
    batchId: "batch-1",
    requests: [coordinateRequest],
  });
  assert.equal(script.attributes.get("data-geostats-sync-ready"), "batch-1");
});

test("note requests preserve content and reject oversized notes", () => {
  const script = runGeostatsScript();
  const request = {
    cacheId: "cache-1",
    gcCode: "GC123",
    noteTarget: "fieldNotes",
    notes: "Clue one\nClue two",
    issuedAt: 12345,
  };
  script.request("geostats-note-sync-request", request);
  assert.deepEqual(
    JSON.parse(script.storage.get("geostats-pending-note-sync")!),
    [request],
  );
  assert.equal(
    script.attributes.get("data-geostats-note-sync-ready"),
    "cache-1:12345",
  );
  script.request("geostats-note-sync-request", {
    ...request,
    notes: "x".repeat(100001),
  });
  assert.deepEqual(
    JSON.parse(script.storage.get("geostats-pending-note-sync")!),
    [request],
  );
  assert.deepEqual(script.events, ["geostats-note-sync-ready"]);
});

test("queued receipts are delivered and removed without deleting unrelated userscript data", () => {
  const script = runGeostatsScript({
    "geostats-coordinate-sync-receipt:attempt-1": "coordinate receipt",
    "geostats-note-sync-receipt:cache-1": "note receipt",
    unrelated: "keep",
  });
  assert.deepEqual(script.receipts, ["coordinate receipt", "note receipt"]);
  assert.deepEqual([...script.storage], [["unrelated", "keep"]]);
});

const noteRequest = {
  cacheId: "cache-1",
  gcCode: "GC123",
  noteTarget: "fieldNotes",
  notes: "Bring a torch",
  issuedAt: 12345,
};

test("note batches queue every cache and reject invalid batches atomically", () => {
  const requests = [noteRequest, { ...noteRequest, cacheId: "cache-2", gcCode: "GC456" }];
  const script = runGeostatsScript();
  script.request("geostats-note-sync-request", { batchId: "notes-1", requests });
  assert.deepEqual(JSON.parse(script.storage.get("geostats-pending-note-sync")!), requests);
  assert.equal(script.attributes.get("data-geostats-note-sync-ready"), "notes-1");
  script.request("geostats-note-sync-request", {
    batchId: "invalid",
    requests: [noteRequest, { ...noteRequest, notes: "x".repeat(100001) }],
  });
  assert.deepEqual(JSON.parse(script.storage.get("geostats-pending-note-sync")!), requests);
  assert.deepEqual(script.events, ["geostats-note-sync-ready"]);
});

test("combined sync queues coordinates and all notes before acknowledging", () => {
  const script = runGeostatsScript();
  const noteRequests = [noteRequest, { ...noteRequest, cacheId: "cache-2", gcCode: "GC456" }];
  script.request("geostats-sync-request", { batchId: "combined", requests: [coordinateRequest], noteRequests });
  assert.deepEqual(JSON.parse(script.storage.get("geostats-pending-coordinate-sync")!), [coordinateRequest]);
  assert.deepEqual(JSON.parse(script.storage.get("geostats-pending-note-sync")!), noteRequests);
  assert.equal(script.attributes.get("data-geostats-sync-ready"), "combined");

  const invalid = runGeostatsScript();
  invalid.request("geostats-sync-request", {
    batchId: "invalid", requests: [coordinateRequest], noteRequests: [{ ...noteRequest, gcCode: "invalid" }],
  });
  assert.equal(invalid.storage.size, 0);
});

function generatedFunction(name: string) {
  const source = userscript("https://geostats.example");
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf("\n  }", start) + "\n  }".length;
  return source.slice(start, end);
}

test("completing a note preserves the remaining queue and visits the next cache before closing", () => {
  for (const legacySingle of [false, true]) {
    const next = { ...noteRequest, cacheId: "cache-2", gcCode: "GC456" };
    const storage = new Map([["notes", JSON.stringify(legacySingle ? noteRequest : [noteRequest, next])]]);
    const destinations: string[] = [];
    let closed = false;
    runInNewContext([
      generatedFunction("pendingNoteSyncPayloads"),
      generatedFunction("continueNoteSync"),
      generatedFunction("returnNoteSyncReceipt"),
      'returnNoteSyncReceipt("matched", noteSyncPayload.notes);',
    ].join("\n"), {
      PENDING_NOTE_SYNC_KEY: "notes",
      NOTE_SYNC_RECEIPT_PREFIX: "receipt:",
      noteSyncPayload: noteRequest,
      noteReceiptReturned: false,
      GM_getValue: (key: string, fallback: string) => storage.get(key) ?? fallback,
      GM_setValue: (key: string, value: string) => storage.set(key, value),
      GM_deleteValue: (key: string) => storage.delete(key),
      setNoteSyncPanelState: () => {},
      toast: () => {},
      window: {
        setTimeout: (callback: () => void) => callback(),
        location: { assign: (target: string) => destinations.push(target) },
        close: () => { closed = true; },
      },
    });
    assert.ok(storage.has("receipt:cache-1"));
    assert.equal(closed, legacySingle);
    if (legacySingle) assert.equal(storage.has("notes"), false);
    else {
      const refreshed = { ...next, issuedAt: JSON.parse(storage.get("notes")!)[0].issuedAt };
      assert.ok(refreshed.issuedAt > next.issuedAt);
      assert.deepEqual(JSON.parse(storage.get("notes")!), [refreshed]);
      assert.equal(destinations.length, 1);
      const target = new URL(destinations[0]);
      assert.equal(target.pathname, "/GC456");
      assert.deepEqual(JSON.parse(new URLSearchParams(target.hash.slice(1)).get("geostats-note-sync")!), refreshed);
    }
  }
});


test("the last coordinate hands off to the field-note queue in the same tab", () => {
  const storage = new Map([
    ["coordinates", JSON.stringify([coordinateRequest])],
    ["notes", JSON.stringify([noteRequest])],
  ]);
  const destinations: string[] = [];
  let closed = false;
  runInNewContext([
    generatedFunction("pendingSyncPayloads"),
    generatedFunction("removePendingSyncPayload"),
    generatedFunction("pendingNoteSyncPayloads"),
    generatedFunction("continueNoteSync"),
    generatedFunction("returnSyncReceipt"),
    "returnSyncReceipt();",
  ].join("\n"), {
    PENDING_SYNC_KEY: "coordinates",
    PENDING_NOTE_SYNC_KEY: "notes",
    SYNC_RECEIPT_PREFIX: "receipt:",
    syncPayload: coordinateRequest,
    syncReceiptReturned: false,
    GM_getValue: (key: string, fallback: string) => storage.get(key) ?? fallback,
    GM_setValue: (key: string, value: string) => storage.set(key, value),
    GM_deleteValue: (key: string) => storage.delete(key),
    setSyncPanelState: () => {},
    window: {
      setTimeout: (callback: () => void) => callback(),
      location: { assign: (target: string) => destinations.push(target) },
      close: () => { closed = true; },
    },
  });
  assert.equal(storage.has("coordinates"), false);
  assert.ok(storage.has("receipt:attempt-1"));
  assert.equal(closed, false);
  assert.equal(destinations.length, 1);
  assert.equal(new URL(destinations[0]).pathname, "/GC123");
  assert.ok(destinations[0].includes("#geostats-note-sync="));
});
