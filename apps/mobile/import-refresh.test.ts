import assert from "node:assert/strict";
import test from "node:test";
import { POST_IMPORT_STATS_REFRESH_DELAYS_MS, schedulePostImportStatsRefresh } from "./import-refresh";

test("post-import stats refresh retries through the recalculation window", () => {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const cancelled: unknown[] = [];
  let refreshes = 0;
  const stop = schedulePostImportStatsRefresh(
    () => {
      refreshes += 1;
    },
    (callback, delay) => {
      callbacks.push(callback);
      delays.push(delay);
      return delay;
    },
    (handle) => cancelled.push(handle)
  );

  assert.deepEqual(delays, [...POST_IMPORT_STATS_REFRESH_DELAYS_MS]);
  callbacks.forEach((callback) => callback());
  assert.equal(refreshes, POST_IMPORT_STATS_REFRESH_DELAYS_MS.length);

  stop();
  assert.deepEqual(cancelled, delays);
});

test("scheduled refresh absorbs a rejected request", async () => {
  const callbacks: Array<() => void> = [];
  const stop = schedulePostImportStatsRefresh(
    () => Promise.reject(new Error("temporary failure")),
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    }
  );

  callbacks.forEach((callback) => callback());
  await new Promise<void>((resolve) => setImmediate(resolve));
  stop();
});
