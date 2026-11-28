export const MYSTERY_SYNC_RECEIPT_LIFETIME_MS = 30 * 60 * 1000;

export function createMysterySyncReceiptToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

type PendingMysterySync = { cacheId: string; gcCode: string; issuedAt: number; receiptToken: string } & (
  { attemptId: string; latitude: number; longitude: number } |
  { noteTarget: "fieldNotes"; notes: string }
);

export function recordMysterySyncRequests(
  pending: Map<string, PendingMysterySync>, requests: PendingMysterySync[], now = Date.now()
) {
  for (const [token, request] of pending) {
    if (now - request.issuedAt > MYSTERY_SYNC_RECEIPT_LIFETIME_MS) pending.delete(token);
  }
  for (const request of requests) pending.set(request.receiptToken, request);
}

export function claimMysterySyncReceipt(
  pending: Map<string, PendingMysterySync>, value: unknown, now = Date.now()
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const token = receipt.receiptToken;
  if (typeof token !== "string") return null;
  const request = pending.get(token);
  if (!request || now - request.issuedAt > MYSTERY_SYNC_RECEIPT_LIFETIME_MS) return null;
  const completed = typeof receipt.syncedAt === "string" ? Date.parse(receipt.syncedAt) : NaN;
  if (!Number.isFinite(completed) || completed < request.issuedAt || completed > now + 30_000
    || receipt.gcCode !== request.gcCode || receipt.cacheId !== request.cacheId) return null;

  if ("noteTarget" in request) {
    if (receipt.type !== "notes" || receipt.noteTarget !== request.noteTarget || receipt.geostatsNotes !== request.notes
      || typeof receipt.notes !== "string" || receipt.notes.length > 100_000
      || (receipt.direction !== "from-geocaching" && receipt.direction !== "to-geocaching" && receipt.direction !== "matched")
      || (receipt.direction !== "from-geocaching" && receipt.notes !== request.notes)) return null;
  } else if (receipt.type !== undefined || receipt.attemptId !== request.attemptId
    || !Number.isFinite(receipt.latitude) || !Number.isFinite(receipt.longitude)
    || receipt.latitude !== request.latitude || receipt.longitude !== request.longitude) return null;

  pending.delete(token);
  return token;
}

export type { PendingMysterySync };
