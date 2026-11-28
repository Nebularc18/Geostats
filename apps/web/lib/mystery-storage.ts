export type MysteryStorageKeys = {
  userId: string;
  namespace: string;
  caches: string;
  syncMetadata: string;
  dedupBackup: string;
  deletions: string;
  deletionChannel: string;
};

export function safeRecipientMysteryImage(value: unknown) {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
    ? value
    : undefined;
}

function normalizedApiOrigin(apiUrl: string) {
  return new URL(apiUrl).origin.toLowerCase();
}

export function mysteryStorageKeys(apiUrl: string, userId: string): MysteryStorageKeys {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required for mystery storage");
  const namespace = `${encodeURIComponent(normalizedApiOrigin(apiUrl))}:${encodeURIComponent(normalizedUserId)}`;
  return {
    userId: normalizedUserId,
    namespace,
    caches: `geostats-mysteries-v2:${namespace}`,
    syncMetadata: `geostats-mystery-sync-metadata-v2:${namespace}`,
    dedupBackup: `geostats-mysteries-backup-before-dedup-v2:${namespace}`,
    deletions: `geostats-mystery-deletions-v2:${namespace}`,
    deletionChannel: `geostats-mystery-deletions-v2:${namespace}`
  };
}

export function createMysterySessionBoundary() {
  let current: MysterySession | null = null;
  let controller: AbortController | null = null;
  let generation = 0;

  function clear() {
    controller?.abort();
    controller = null;
    current = null;
  }

  return {
    clear,
    activate(apiUrl: string, userId: string): MysterySession {
      const keys = mysteryStorageKeys(apiUrl, userId);
      if (current?.keys.namespace === keys.namespace) return current;
      clear();
      controller = new AbortController();
      const signal = controller.signal;
      const session: MysterySession = {
        generation: ++generation,
        keys,
        signal,
        isCurrent: () => current === session && !signal.aborted
      };
      current = session;
      return session;
    }
  };
}

export type MysterySession = {
  generation: number;
  keys: MysteryStorageKeys;
  signal: AbortSignal;
  isCurrent: () => boolean;
};
