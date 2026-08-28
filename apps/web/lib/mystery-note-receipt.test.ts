import assert from "node:assert/strict";
import test from "node:test";
import { reconcileGeocachingNoteReceipt } from "./mystery-note-receipt.ts";

test("applies a Geocaching note when the sent Geostats note is still current", () => {
  assert.deepEqual(
    reconcileGeocachingNoteReceipt("note sent to sync", "note sent to sync", "note from geocaching"),
    { notes: "note from geocaching", conflict: null },
  );
});

test("preserves a newer local edit and records both versions for review", () => {
  assert.deepEqual(
    reconcileGeocachingNoteReceipt("new edit made during sync", "older note sent to sync", "note from geocaching"),
    {
      notes: "new edit made during sync",
      conflict: {
        geocaching: "note from geocaching",
        geostats: "new edit made during sync",
      },
    },
  );
});
