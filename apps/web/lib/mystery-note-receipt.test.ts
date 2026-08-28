import assert from "node:assert/strict";
import test from "node:test";
import { chooseGeocachingNoteConflict, reconcileGeocachingNoteReceipt } from "./mystery-note-receipt.ts";

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

test("applies the Geocaching note when the reviewed Geostats note is still current", () => {
  assert.deepEqual(
    chooseGeocachingNoteConflict(
      "reviewed Geostats note",
      { geocaching: "note from geocaching", geostats: "reviewed Geostats note" },
      true,
    ),
    { notes: "note from geocaching", conflict: null, outcome: "geocaching" },
  );
});

test("keeps an edit made after the conflict appeared and refreshes the review", () => {
  assert.deepEqual(
    chooseGeocachingNoteConflict(
      "edit made after conflict",
      { geocaching: "note from geocaching", geostats: "older Geostats note" },
      true,
    ),
    {
      notes: "edit made after conflict",
      conflict: { geocaching: "note from geocaching", geostats: "edit made after conflict" },
      outcome: "stale",
    },
  );
});

test("keeps the current Geostats note when that version is chosen", () => {
  assert.deepEqual(
    chooseGeocachingNoteConflict(
      "latest Geostats note",
      { geocaching: "note from geocaching", geostats: "older Geostats note" },
      false,
    ),
    { notes: "latest Geostats note", conflict: null, outcome: "geostats" },
  );
});
