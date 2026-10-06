import assert from "node:assert/strict";
import test from "node:test";
import { automaticSyncRetryDelay, helperSupportsNoteBatches } from "./mystery-sync-policy.ts";

test("automatic sync retries back off without ever exhausting", () => {
  assert.equal(automaticSyncRetryDelay(0), 5_000);
  assert.equal(automaticSyncRetryDelay(1), 30_000);
  assert.equal(automaticSyncRetryDelay(2), 120_000);
  assert.equal(automaticSyncRetryDelay(3), 600_000);
  assert.equal(automaticSyncRetryDelay(4), 900_000);
  assert.equal(automaticSyncRetryDelay(100), 900_000);
});


test("note batches require explicit helper support, even when legacy sync is ready", () => {
  for (const capability of [null, "", "0", "1"]) {
    const root = { getAttribute: (name: string) => name === "data-geostats-note-batch-support" ? capability : "legacy-batch-ready" };
    assert.equal(helperSupportsNoteBatches(root), capability === "1");
  }
});
