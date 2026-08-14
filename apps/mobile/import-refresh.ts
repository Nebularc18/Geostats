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
      void refresh();
    }, delay)
  );
  return () => handles.forEach(cancel);
}
