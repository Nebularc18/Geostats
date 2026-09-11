export type ImportStatusRecord = {
  id: string;
  status: string;
};

const COMPLETED_STATUS = "COMPLETED";

// Import history is observed by more than one screen over the lifetime of the
// app. Keep the last status per server/account so changing screens cannot lose
// an active -> completed transition.
const statusesByScope = new Map<string, Map<string, string>>();

export function importStatusScopeKey(baseUrl: string, token: string) {
  return `${baseUrl.length}:${baseUrl}:${token.length}:${token}`;
}

/**
 * Records the latest statuses and reports whether a completion was observed
 * for the first time or after a different status. A completed import is
 * reported once until it is re-queued and completes again.
 */
export function observeImportStatuses(scope: string, imports: ImportStatusRecord[]) {
  const previous = statusesByScope.get(scope) ?? new Map<string, string>();
  let completed = false;

  for (const item of imports) {
    const before = previous.get(item.id);
    if (item.status === COMPLETED_STATUS && before !== COMPLETED_STATUS) {
      completed = true;
    }
    previous.set(item.id, item.status);
  }

  statusesByScope.set(scope, previous);
  return completed;
}

export function clearImportStatusTracking(scope?: string) {
  if (scope == null) {
    statusesByScope.clear();
    return;
  }
  statusesByScope.delete(scope);
}

