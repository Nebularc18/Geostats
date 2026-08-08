const AUTOMATIC_SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000, 900_000] as const;

/** Keep pending work recoverable while capping background traffic at one retry per 15 minutes. */
export function automaticSyncRetryDelay(failureCount: number) {
  const normalizedCount = Number.isFinite(failureCount) && failureCount > 0
    ? Math.floor(failureCount)
    : 0;
  return AUTOMATIC_SYNC_RETRY_DELAYS_MS[
    Math.min(normalizedCount, AUTOMATIC_SYNC_RETRY_DELAYS_MS.length - 1)
  ];
}
