"use client";

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function apiUrl() {
  if (typeof window === "undefined") {
    return CONFIGURED_API_URL;
  }

  let configured: URL;
  try {
    configured = new URL(CONFIGURED_API_URL);
  } catch {
    return CONFIGURED_API_URL;
  }
  if (configured.hostname === "localhost" && window.location.hostname === "127.0.0.1") {
    configured.hostname = "127.0.0.1";
  }
  return configured.toString().replace(/\/$/, "");
}

export const API_URL = apiUrl();

export const STATS_SUMMARY_CACHE_TTL_MS = 30_000;

type StatsSummaryResponse<T> = { stats: T };

type StatsSummaryCacheEntry = {
  value: StatsSummaryResponse<unknown>;
  cachedAt: number;
};

export type StatsSummaryCacheEvent = {
  generation: number;
  sessionEpoch: number;
};

type StatsSummaryCacheListener = (event: StatsSummaryCacheEvent) => void;

export class StatsSummaryStaleError extends Error {
  constructor() {
    super("Stats summary response belongs to an earlier session or cache generation");
    this.name = "StatsSummaryStaleError";
  }
}

const ACTIVE_IMPORT_STATUSES = new Set(["UPLOADED", "QUEUED", "PROCESSING"]);
const statsSummaryCache = new Map<string, StatsSummaryCacheEntry>();
const statsSummaryInFlight = new Map<string, Promise<StatsSummaryResponse<unknown>>>();
const statsSummaryCacheListeners = new Set<StatsSummaryCacheListener>();
let statsSummaryAccountKey: string | null = null;
let statsSummaryGeneration = 0;
let statsSummarySessionEpoch = 0;
let lastImportStatuses: Map<string, string> | null = null;

function statsSummaryKey() {
  return `${API_URL}|${statsSummaryAccountKey ?? "session"}`;
}

function clearStatsSummaryCache(resetImportTracking = false) {
  statsSummaryGeneration += 1;
  statsSummaryCache.clear();
  statsSummaryInFlight.clear();
  if (resetImportTracking) {
    lastImportStatuses = null;
  }
  const event = { generation: statsSummaryGeneration, sessionEpoch: statsSummarySessionEpoch };
  for (const listener of statsSummaryCacheListeners) {
    listener(event);
  }
}

function currentStatsSummarySession(generation: number, sessionEpoch: number) {
  return sessionEpoch === statsSummarySessionEpoch && generation === statsSummaryGeneration;
}

export function subscribeStatsSummaryCache(listener: StatsSummaryCacheListener) {
  statsSummaryCacheListeners.add(listener);
  return () => {
    statsSummaryCacheListeners.delete(listener);
  };
}

function resolveStatsSummary<T>(
  request: Promise<StatsSummaryResponse<unknown>>,
  generation: number,
  sessionEpoch: number
): Promise<StatsSummaryResponse<T>> {
  return request.then((value) => {
    if (sessionEpoch !== statsSummarySessionEpoch) {
      // The caller belongs to a logged-out or previous account session. Its
      // response must never be reissued under the new account.
      throw new StatsSummaryStaleError();
    }
    if (currentStatsSummarySession(generation, sessionEpoch)) {
      return value as StatsSummaryResponse<T>;
    }
    // A same-session mutation can invalidate a request while it is in flight.
    // Keep the caller attached to the current generation instead of surfacing
    // a stale response as an empty dashboard.
    return getStatsSummary<T>();
  });
}

/**
 * The summary is scoped to the current browser session and can be reused for
 * a short period while navigating between the stats screens. Mutations and
 * auth/session changes call invalidateStatsSummaryCache below.
 */
export function getStatsSummary<T = unknown>(options: { force?: boolean } = {}): Promise<StatsSummaryResponse<T>> {
  const key = statsSummaryKey();
  const now = Date.now();
  const sessionEpoch = statsSummarySessionEpoch;
  const cached = statsSummaryCache.get(key);
  if (!options.force && cached && now - cached.cachedAt < STATS_SUMMARY_CACHE_TTL_MS) {
    return resolveStatsSummary(Promise.resolve(cached.value), statsSummaryGeneration, sessionEpoch);
  }

  const inFlight = statsSummaryInFlight.get(key);
  if (inFlight) {
    const generation = statsSummaryGeneration;
    return resolveStatsSummary(inFlight, generation, sessionEpoch);
  }

  const generation = statsSummaryGeneration;
  let request: Promise<StatsSummaryResponse<unknown>>;
  request = apiFetch<StatsSummaryResponse<unknown>>("/stats/summary")
    .then((value) => {
      if (generation === statsSummaryGeneration && sessionEpoch === statsSummarySessionEpoch) {
        // The initial profile lookup can establish the account while this
        // request is in flight. Store the response under the now-known key;
        // its session epoch is unchanged, so it was fetched for the same
        // authenticated browser session.
        statsSummaryCache.set(statsSummaryKey(), { value, cachedAt: Date.now() });
      }
      return value;
    })
    .finally(() => {
      for (const [inFlightKey, inFlightRequest] of statsSummaryInFlight) {
        if (inFlightRequest === request) {
          statsSummaryInFlight.delete(inFlightKey);
        }
      }
    });

  statsSummaryInFlight.set(key, request);
  return resolveStatsSummary(request, generation, sessionEpoch);
}

export function invalidateStatsSummaryCache() {
  clearStatsSummaryCache();
}

export function setStatsSummaryAccount(accountId: string | null | undefined) {
  const nextAccountKey = typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
  if (nextAccountKey === statsSummaryAccountKey) {
    return;
  }

  // The first profile response usually arrives immediately after a page
  // starts. A summary request may already be using the temporary session key,
  // but that response is still for the same account. Migrate its cache entry
  // and in-flight promise instead of invalidating the request and flashing a
  // blank page. Every subsequent identity change advances the session epoch.
  if (statsSummaryAccountKey === null && nextAccountKey !== null) {
    const previousKey = statsSummaryKey();
    const cached = statsSummaryCache.get(previousKey);
    const inFlight = statsSummaryInFlight.get(previousKey);
    statsSummaryAccountKey = nextAccountKey;
    const nextKey = statsSummaryKey();
    if (cached) {
      statsSummaryCache.set(nextKey, cached);
      statsSummaryCache.delete(previousKey);
    }
    if (inFlight) {
      statsSummaryInFlight.set(nextKey, inFlight);
      statsSummaryInFlight.delete(previousKey);
    }
    return;
  }

  statsSummarySessionEpoch += 1;
  statsSummaryAccountKey = nextAccountKey;
  clearStatsSummaryCache(true);
}

function observeImportStatuses(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { imports?: unknown }).imports)) {
    return;
  }

  const imports = (value as { imports: unknown[] }).imports;
  const nextImportMarkers = new Map<string, string>();
  for (const item of imports) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = (item as { id?: unknown }).id;
    const status = (item as { status?: unknown }).status;
    if (typeof id === "string" && typeof status === "string") {
      const updatedAt = (item as { updatedAt?: unknown }).updatedAt;
      nextImportMarkers.set(id, `${status}|${typeof updatedAt === "string" ? updatedAt : ""}`);
    }
  }

  const importChanged = [...nextImportMarkers.entries()].some(([id, marker]) => {
    const previousMarker = lastImportStatuses?.get(id);
    if (!previousMarker) {
      return marker.startsWith("COMPLETED|") || marker.startsWith("FAILED|");
    }
    if (previousMarker === marker) {
      return false;
    }
    const status = marker.split("|", 1)[0];
    return typeof status === "string" && !ACTIVE_IMPORT_STATUSES.has(status);
  });
  lastImportStatuses = nextImportMarkers;
  if (importChanged) {
    invalidateStatsSummaryCache();
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const requestSessionEpoch = statsSummarySessionEpoch;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? "Request failed");
  }

  const data = (await response.json()) as T;
  const normalizedPath = path.split("?", 1)[0];
  if (normalizedPath === "/imports" && requestSessionEpoch === statsSummarySessionEpoch) {
    observeImportStatuses(data);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && requestSessionEpoch === statsSummarySessionEpoch) {
    if (normalizedPath === "/auth/logout") {
      statsSummarySessionEpoch += 1;
      statsSummaryAccountKey = null;
      clearStatsSummaryCache(true);
    } else {
      invalidateStatsSummaryCache();
    }
  }

  if (requestSessionEpoch === statsSummarySessionEpoch && ["/auth/login", "/auth/register", "/auth/clerk/exchange"].includes(normalizedPath)) {
    const user = (data as { user?: { id?: unknown } }).user;
    if (typeof user?.id === "string") {
      setStatsSummaryAccount(user.id);
    }
  }

  if (normalizedPath === "/auth/me" && requestSessionEpoch === statsSummarySessionEpoch) {
    const user = (data as { user?: { id?: unknown } }).user;
    // Some screens only ask /auth/me for the username. An incomplete payload
    // must not turn a known account into the anonymous cache namespace.
    if (typeof user?.id === "string") {
      setStatsSummaryAccount(user.id);
    }
  }

  return data;
}
