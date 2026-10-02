import { mysteryStorageKeys } from "./mystery-storage.ts";

export function travelStorageKeys(apiUrl: string, userId: string) {
  const mystery = mysteryStorageKeys(apiUrl, userId);
  return {
    namespace: mystery.namespace,
    caches: mystery.caches,
    plans: `geostats-travel-plans-v3:${mystery.namespace}`
  };
}

export type TravelSession = {
  generation: number;
  userId: string;
  keys: ReturnType<typeof travelStorageKeys>;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

/** Invalidating a session also cancels its requests, even before React unmounts it. */
export function createTravelSessionBoundary() {
  let current: TravelSession | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  function clear() {
    controller?.abort();
    controller = null;
    current = null;
  }
  return {
    clear,
    current: () => current,
    activate(apiUrl: string, userId: string): TravelSession {
      const keys = travelStorageKeys(apiUrl, userId);
      if (current?.keys.namespace === keys.namespace) return current;
      clear();
      controller = new AbortController();
      const signal = controller.signal;
      const session: TravelSession = {
        generation: ++generation,
        userId: userId.trim(),
        keys,
        signal,
        isCurrent: () => current === session && !signal.aborted
      };
      current = session;
      return session;
    }
  };
}

export function keepTravelSessionAfterNetworkFailure(
  session: TravelSession | null,
  error: unknown,
  requestEpoch: number,
  currentEpoch: number
) {
  return error instanceof TypeError && requestEpoch === currentEpoch && session?.isCurrent() === true;
}

export function readTravelStorage(storage: Pick<Storage, "getItem">, session: TravelSession) {
  if (!session.isCurrent()) return { caches: [], plans: [] };
  const read = (key: string): unknown => {
    try { return JSON.parse(storage.getItem(key) ?? "[]"); }
    catch { return []; }
  };
  // Unsuffixed legacy copies have no verifiable owner and are deliberately ignored.
  return { caches: read(session.keys.caches), plans: read(session.keys.plans) };
}
