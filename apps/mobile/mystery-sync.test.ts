import assert from "node:assert/strict";
import test from "node:test";
import { type MergeableMysteryCache } from "@geostats/shared";
import { mergeDeviceMystery, mysteryFieldFingerprints } from "./mystery-sync";

const fingerprint = (value: string) => value;
const base: MergeableMysteryCache = {
  id: "account-mystery", gcCode: "GC123", name: "Puzzle", area: "", country: "",
  status: "solving", notes: "Baseline", fieldNotes: "", clues: [], sharedWith: [], attempts: []
};

test("Android reconciles divergent edits into the account mystery with a local solution draft", () => {
  const server = { ...base, notes: "Account solution", clues: ["Account clue"] };
  const device: MergeableMysteryCache = {
    ...base, id: "old-device-copy", notes: "Device solution", fieldNotes: "Parking near the gate",
    clues: ["Device clue"],
    attempts: [{ id: "final", state: "correct", createdAt: "2026-01-01", latitude: 59, longitude: 18 }]
  };
  const merged = mergeDeviceMystery(server, device, fingerprint, mysteryFieldFingerprints(base, fingerprint));

  assert.equal(merged.id, server.id);
  assert.equal(merged.notes, "Account solution");
  assert.equal(merged.fieldNotes, "Parking near the gate");
  assert.deepEqual(merged.clues, ["Account clue", "Device clue"]);
  assert.deepEqual(merged.attempts, device.attempts);
  assert.deepEqual(merged.syncConflicts?.notes, { server: "Account solution", device: "Device solution" });
  const repeated = mergeDeviceMystery(server, merged, fingerprint, mysteryFieldFingerprints(server, fingerprint));
  assert.equal(repeated.syncConflicts?.notes?.device, "Device solution");
});

test("legacy copies preserve each distinct unresolved device edit", () => {
  const first = mergeDeviceMystery(base, { ...base, notes: "First device draft" }, fingerprint);
  const merged = mergeDeviceMystery(first, { ...base, notes: "Second device draft" }, fingerprint);
  const notes = merged.syncConflicts?.notes;
  assert.ok(notes);
  assert.deepEqual(new Set([notes.device, ...(notes.otherDeviceEdits ?? [])]), new Set(["First device draft", "Second device draft"]));
});
