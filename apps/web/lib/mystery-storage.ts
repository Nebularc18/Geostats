export type MysteryStorageKeys = {
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

function encodeIdentity(value: string) {
  return encodeURIComponent(value);
}

export function mysteryStorageKeys(apiUrl: string, userId: string): MysteryStorageKeys {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required for mystery storage");
  const namespace = `${encodeIdentity(normalizedApiOrigin(apiUrl))}:${encodeIdentity(normalizedUserId)}`;
  return {
    namespace,
    caches: `geostats-mysteries-v2:${namespace}`,
    syncMetadata: `geostats-mystery-sync-metadata-v2:${namespace}`,
    dedupBackup: `geostats-mysteries-backup-before-dedup-v2:${namespace}`,
    deletions: `geostats-mystery-deletions-v2:${namespace}`,
    deletionChannel: `geostats-mystery-deletions-v2:${namespace}`
  };
}
