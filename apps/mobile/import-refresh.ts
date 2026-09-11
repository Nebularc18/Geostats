export const POST_IMPORT_STATS_REFRESH_DELAYS_MS = [0, 3_000, 8_000, 15_000, 30_000] as const;

type Schedule = (callback: () => void, delay: number) => unknown;
type Cancel = (handle: unknown) => void;

export function schedulePostImportStatsRefresh(
  refresh: () => void | Promise<unknown>,
  schedule: Schedule = (callback, delay) => setTimeout(callback, delay),
  cancel: Cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
) {
  const handles = POST_IMPORT_STATS_REFRESH_DELAYS_MS.map((delay) =>
    schedule(() => {
      // Refresh intentionally rejects on a network error so interactive
      // callers can show it. Scheduled retries have no caller to observe that
      // rejection, so absorb both synchronous and asynchronous failures here.
      try {
        void Promise.resolve(refresh()).catch(() => undefined);
      } catch {
        // A custom refresh may throw before it returns a promise.
      }
    }, delay)
  );
  return () => handles.forEach(cancel);
}
