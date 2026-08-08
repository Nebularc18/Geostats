import assert from "node:assert/strict";
import test from "node:test";
import { automaticSyncRetryDelay } from "./mystery-sync-policy.ts";

test("automatic sync retries back off without ever exhausting", () => {
  assert.equal(automaticSyncRetryDelay(0), 5_000);
  assert.equal(automaticSyncRetryDelay(1), 30_000);
  assert.equal(automaticSyncRetryDelay(2), 120_000);
  assert.equal(automaticSyncRetryDelay(3), 600_000);
  assert.equal(automaticSyncRetryDelay(4), 900_000);
  assert.equal(automaticSyncRetryDelay(100), 900_000);
});
