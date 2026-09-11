import assert from "node:assert/strict";
import test from "node:test";
import {
  STATS_SUMMARY_FRESHNESS_MS,
  clearStatsSummaryCacheForTests,
  getStatsSummaryCache,
  invalidateStatsSummary,
  requestStatsSummary,
  statsSummaryCacheKey,
  subscribeStatsSummaryCache
} from "./stats-cache";

test.beforeEach(() => {
  clearStatsSummaryCacheForTests();
});

test("stats summary requests deduplicate and warm the session cache", async () => {
  const key = statsSummaryCacheKey("https://server.example", "session-a");
  let resolveRequest!: (value: { stats: { totalFinds: number } }) => void;
  let requests = 0;
  const pending = new Promise<{ stats: { totalFinds: number } }>((resolve) => {
    resolveRequest = resolve;
  });
  const fetcher = () => {
    requests += 1;
    return pending;
  };

  const first = requestStatsSummary(key, fetcher);
  const second = requestStatsSummary(key, fetcher);
  assert.equal(first, second);
  assert.equal(requests, 1);

  resolveRequest({ stats: { totalFinds: 42 } });
  assert.deepEqual(await first, { stats: { totalFinds: 42 } });
  assert.deepEqual(getStatsSummaryCache(key)?.data, { stats: { totalFinds: 42 } });
  assert.equal((await requestStatsSummary(key, fetcher)).stats.totalFinds, 42);
  assert.equal(requests, 1);
});

test("stale summaries refresh while callers can keep the previous value", async () => {
  const key = statsSummaryCacheKey("https://server.example", "session-a");
  let requests = 0;
  const fetcher = async () => ({ stats: { totalFinds: ++requests } });

  await requestStatsSummary(key, fetcher, { now: 1_000 });
  const cached = getStatsSummaryCache<{ stats: { totalFinds: number } }>(key, 1_000 + STATS_SUMMARY_FRESHNESS_MS);
  assert.equal(cached?.fresh, false);
  assert.equal(cached?.data.stats.totalFinds, 1);

  assert.equal((await requestStatsSummary(key, fetcher, { now: 1_000 + STATS_SUMMARY_FRESHNESS_MS })).stats.totalFinds, 2);
  assert.equal(requests, 2);
});

test("invalidating a session does not allow an old in-flight response to repopulate it", async () => {
  const key = statsSummaryCacheKey("https://server.example", "session-a");
  let resolveOld!: (value: { stats: { totalFinds: number } }) => void;
  const oldRequest = new Promise<{ stats: { totalFinds: number } }>((resolve) => {
    resolveOld = resolve;
  });

  const old = requestStatsSummary(key, () => oldRequest);
  invalidateStatsSummary("https://server.example", "session-a");
  resolveOld({ stats: { totalFinds: 1 } });
  await old;

  assert.equal(getStatsSummaryCache(key), undefined);
});

test("server/account keys do not share cached summaries", async () => {
  const firstKey = statsSummaryCacheKey("https://server-a.example", "same-looking-token");
  const secondKey = statsSummaryCacheKey("https://server-b.example", "same-looking-token");
  let requests = 0;
  const fetcher = async () => ({ stats: { totalFinds: ++requests } });

  await requestStatsSummary(firstKey, fetcher);
  await requestStatsSummary(secondKey, fetcher);

  assert.equal(requests, 2);
});

test("silent invalidation clears in-flight work without notifying mounted listeners", async () => {
  const key = statsSummaryCacheKey("https://server.example", "session-a");
  const events: string[] = [];
  let resolveRequest!: (value: { stats: { totalFinds: number } }) => void;
  const pending = new Promise<{ stats: { totalFinds: number } }>((resolve) => {
    resolveRequest = resolve;
  });
  const unsubscribe = subscribeStatsSummaryCache(key, (event) => events.push(event.type));
  const old = requestStatsSummary(key, () => pending);

  invalidateStatsSummary("https://server.example", "session-a", { notify: false });
  resolveRequest({ stats: { totalFinds: 1 } });
  await old;
  unsubscribe();

  assert.deepEqual(events, []);
  assert.equal(getStatsSummaryCache(key), undefined);
});
