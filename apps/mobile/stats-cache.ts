export const STATS_SUMMARY_FRESHNESS_MS = 30_000;

type CachedStatsSummary<T> = {
  data: T;
  fetchedAt: number;
};

export type StatsSummaryCacheEvent = {
  type: "set" | "invalidate";
  generation: number;
};

type Listener = (event: StatsSummaryCacheEvent) => void;

const entries = new Map<string, CachedStatsSummary<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

export function statsSummaryCacheKey(baseUrl: string, token: string) {
  return `${baseUrl.length}:${baseUrl}:${token.length}:${token}`;
}

function generationFor(key: string) {
  return generations.get(key) ?? 0;
}

function emit(key: string, event: StatsSummaryCacheEvent) {
  listeners.get(key)?.forEach((listener) => listener(event));
}

export function getStatsSummaryCache<T>(key: string, now = Date.now()) {
  const entry = entries.get(key) as CachedStatsSummary<T> | undefined;
  if (!entry) return undefined;
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    fresh: now - entry.fetchedAt < STATS_SUMMARY_FRESHNESS_MS
  };
}

export function getStatsSummaryCacheGeneration(key: string) {
  return generationFor(key);
}

export function subscribeStatsSummaryCache(key: string, listener: Listener) {
  const keyListeners = listeners.get(key) ?? new Set<Listener>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
}

export function requestStatsSummary<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { force?: boolean; now?: number } = {}
): Promise<T> {
  const requestStartedAt = options.now ?? Date.now();
  const cached = getStatsSummaryCache<T>(key, requestStartedAt);
  if (!options.force && cached?.fresh) return Promise.resolve(cached.data);

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const requestGeneration = generationFor(key);
  const request = fetcher().then((data) => {
    // A write may invalidate a request while it is in flight. Do not let the
    // old response become the warm value for the next screen/account.
    if (generationFor(key) === requestGeneration) {
      entries.set(key, { data, fetchedAt: requestStartedAt });
      emit(key, { type: "set", generation: requestGeneration });
    }
    return data;
  });
  inFlight.set(key, request);
  void request.then(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }, () => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  return request;
}

export function invalidateStatsSummary(baseUrl?: string, token?: string, options: { notify?: boolean } = {}) {
  const notify = options.notify ?? true;
  const keys = baseUrl != null && token != null
    ? [statsSummaryCacheKey(baseUrl, token)]
    : [...new Set([...entries.keys(), ...inFlight.keys(), ...listeners.keys()])];

  for (const key of keys) {
    entries.delete(key);
    inFlight.delete(key);
    const nextGeneration = generationFor(key) + 1;
    generations.set(key, nextGeneration);
    if (notify) emit(key, { type: "invalidate", generation: nextGeneration });
  }
}

export function clearStatsSummaryCacheForTests() {
  entries.clear();
  inFlight.clear();
  generations.clear();
  listeners.clear();
}
