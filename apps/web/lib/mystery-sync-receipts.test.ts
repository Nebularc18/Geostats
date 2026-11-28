import assert from "node:assert/strict";
import test from "node:test";
import { claimMysterySyncReceipt, MYSTERY_SYNC_RECEIPT_LIFETIME_MS, recordMysterySyncRequests, type PendingMysterySync } from "./mystery-sync-receipts.ts";

const issuedAt = Date.parse("2026-01-01T10:00:00.000Z");
const now = issuedAt + 1000;
const coordinate = { receiptToken: "coordinate-token", cacheId: "cache-1", gcCode: "GC123", attemptId: "attempt-1", latitude: 59, longitude: 18, issuedAt };

test("a workspace claims its matching helper receipt exactly once", () => {
  const owner = new Map<string, PendingMysterySync>();
  const otherWorkspace = new Map<string, PendingMysterySync>();
  recordMysterySyncRequests(owner, [coordinate], issuedAt);
  const receipt = { ...coordinate, syncedAt: new Date(now).toISOString() };
  assert.equal(claimMysterySyncReceipt(otherWorkspace, receipt, now), null);
  assert.equal(claimMysterySyncReceipt(owner, { ...receipt, attemptId: "another-attempt" }, now), null);
  assert.equal(claimMysterySyncReceipt(owner, receipt, now), coordinate.receiptToken);
  assert.equal(claimMysterySyncReceipt(owner, receipt, now), null);
});

test("a field note receipt matches the note sent to the helper and expires", () => {
  const pending = new Map<string, PendingMysterySync>();
  const note = { receiptToken: "note-token", cacheId: "cache-1", gcCode: "GC123", noteTarget: "fieldNotes" as const, notes: "Bring a torch", issuedAt };
  recordMysterySyncRequests(pending, [note], issuedAt);
  const receipt = {
    ...note,
    type: "notes",
    geostatsNotes: note.notes,
    notes: "Bring a lamp",
    direction: "from-geocaching",
    syncedAt: new Date(now).toISOString()
  };
  assert.equal(claimMysterySyncReceipt(pending, { ...receipt, geostatsNotes: "An unrelated note" }, now), null);
  assert.equal(claimMysterySyncReceipt(pending, receipt, now + MYSTERY_SYNC_RECEIPT_LIFETIME_MS), null);
  assert.equal(claimMysterySyncReceipt(pending, receipt, now), note.receiptToken);
});
