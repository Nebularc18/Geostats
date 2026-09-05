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
    notes: "Clue one\nClue two",
    issuedAt: 12345,
  };
  script.request("geostats-note-sync-request", request);
  assert.deepEqual(
    JSON.parse(script.storage.get("geostats-pending-note-sync")!),
    request,
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
    request,
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
