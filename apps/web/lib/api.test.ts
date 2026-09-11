import assert from "node:assert/strict";
import test from "node:test";
import {
  apiFetch,
  getStatsSummary,
  invalidateStatsSummaryCache,
  setStatsSummaryAccount,
  StatsSummaryStaleError,
  subscribeStatsSummaryCache
} from "./api.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    statusText: "OK",
    json: async () => value
  } as Response;
}

function useAccount(accountId: string) {
  setStatsSummaryAccount(accountId);
  invalidateStatsSummaryCache();
}

test.afterEach(() => {
  setStatsSummaryAccount(null);
  invalidateStatsSummaryCache();
});

test("deduplicates concurrent summary requests and reuses a fresh session cache", async () => {
  useAccount("summary-cache-user");
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ stats: { totalFinds: 12 } });
  };

  try {
    const [first, second] = await Promise.all([getStatsSummary<{ totalFinds: number }>(), getStatsSummary<{ totalFinds: number }>()]);
    const cached = await getStatsSummary<{ totalFinds: number }>();
    assert.equal(first.stats.totalFinds, 12);
    assert.equal(second.stats.totalFinds, 12);
    assert.equal(cached.stats.totalFinds, 12);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrates a startup request when the profile establishes the first account", async () => {
  useAccount("startup-old-user");
  setStatsSummaryAccount(null);
  const response = deferred<Response>();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return response.promise;
  };

  try {
    const beforeProfile = getStatsSummary<{ totalFinds: number }>();
    setStatsSummaryAccount("startup-user");
    const afterProfile = getStatsSummary<{ totalFinds: number }>();
    response.resolve(jsonResponse({ stats: { totalFinds: 42 } }));
    const [first, second] = await Promise.all([beforeProfile, afterProfile]);
    assert.equal(first.stats.totalFinds, 42);
    assert.equal(second.stats.totalFinds, 42);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a same-session summary after an import invalidates its generation", async () => {
  useAccount("retry-user");
  const oldResponse = deferred<Response>();
  const newResponse = deferred<Response>();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? oldResponse.promise : newResponse.promise;
  };

  try {
    const originalRequest = getStatsSummary<{ totalFinds: number }>();
    invalidateStatsSummaryCache();
    const currentRequest = getStatsSummary<{ totalFinds: number }>();
    newResponse.resolve(jsonResponse({ stats: { totalFinds: 2 } }));
    oldResponse.resolve(jsonResponse({ stats: { totalFinds: 1 } }));
    const [original, current] = await Promise.all([originalRequest, currentRequest]);
    assert.equal(original.stats.totalFinds, 2);
    assert.equal(current.stats.totalFinds, 2);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a summary caller from an earlier account epoch", async () => {
  useAccount("previous-user");
  const oldResponse = deferred<Response>();
  const newResponse = deferred<Response>();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? oldResponse.promise : newResponse.promise;
  };

  try {
    const previousRequest = getStatsSummary<{ totalFinds: number }>();
    setStatsSummaryAccount("current-user");
    const currentRequest = getStatsSummary<{ totalFinds: number }>();
    oldResponse.resolve(jsonResponse({ stats: { totalFinds: 1 } }));
    await assert.rejects(previousRequest, (error: unknown) => error instanceof StatsSummaryStaleError);
    newResponse.resolve(jsonResponse({ stats: { totalFinds: 2 } }));
    assert.equal((await currentRequest).stats.totalFinds, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalidates once for each import that reaches a terminal status", async () => {
  useAccount("import-user");
  const originalFetch = globalThis.fetch;
  let summaryCalls = 0;
  let importsResponse: unknown = {
    imports: [
      { id: "import-a", status: "QUEUED", updatedAt: "2025-01-01T00:00:00.000Z" },
      { id: "import-b", status: "PROCESSING", updatedAt: "2025-01-01T00:00:00.000Z" }
    ]
  };
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith("/stats/summary")) {
      summaryCalls += 1;
      return jsonResponse({ stats: { totalFinds: summaryCalls } });
    }
    return jsonResponse(importsResponse);
  };

  try {
    await getStatsSummary();
    await apiFetch("/imports");

    importsResponse = {
      imports: [
        { id: "import-a", status: "COMPLETED", updatedAt: "2025-01-01T00:00:01.000Z" },
        { id: "import-b", status: "PROCESSING", updatedAt: "2025-01-01T00:00:01.000Z" }
      ]
    };
    await apiFetch("/imports");
    assert.equal((await getStatsSummary<{ totalFinds: number }>()).stats.totalFinds, 2);

    // Re-reading the same terminal status is quiet, even while the other
    // import is still active.
    await apiFetch("/imports");
    assert.equal((await getStatsSummary<{ totalFinds: number }>()).stats.totalFinds, 2);

    importsResponse = {
      imports: [
        { id: "import-a", status: "COMPLETED", updatedAt: "2025-01-01T00:00:01.000Z" },
        { id: "import-b", status: "FAILED", updatedAt: "2025-01-01T00:00:02.000Z" }
      ]
    };
    await apiFetch("/imports");
    assert.equal((await getStatsSummary<{ totalFinds: number }>()).stats.totalFinds, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignores late identity and import responses from an earlier account epoch", async () => {
  useAccount("late-old-user");
  const oldMe = deferred<Response>();
  const oldImports = deferred<Response>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith("/auth/me")) return oldMe.promise;
    if (path.endsWith("/imports")) return oldImports.promise;
    return jsonResponse({ stats: {} });
  };

  try {
    let invalidations = 0;
    const unsubscribe = subscribeStatsSummaryCache(() => {
      invalidations += 1;
    });
    const meRequest = apiFetch("/auth/me");
    const importsRequest = apiFetch("/imports");
    setStatsSummaryAccount("late-current-user");
    const accountChangeInvalidations = invalidations;
    oldMe.resolve(jsonResponse({ user: { id: "late-old-user", username: "old" } }));
    oldImports.resolve(jsonResponse({ imports: [{ id: "old-import", status: "COMPLETED", updatedAt: "2025-01-01" }] }));
    await Promise.all([meRequest, importsRequest]);
    assert.equal(invalidations, accountChangeInvalidations);
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not reset a known account for a username-only /auth/me response", async () => {
  useAccount("known-user");
  let summaryCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith("/auth/me")) return jsonResponse({ user: { username: "known" } });
    summaryCalls += 1;
    return jsonResponse({ stats: { totalFinds: summaryCalls } });
  };

  try {
    await getStatsSummary();
    await apiFetch("/auth/me");
    await getStatsSummary();
    assert.equal(summaryCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
