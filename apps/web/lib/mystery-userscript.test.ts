import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MYSTERY_USERSCRIPT_VERSION } from "./mystery-userscript.ts";

const pageSource = readFileSync(
  fileURLToPath(new URL("../app/mysteries/page.tsx", import.meta.url)),
  "utf8"
);
const routeSource = readFileSync(
  fileURLToPath(new URL("../app/mysteries/tampermonkey.user.js/route.ts", import.meta.url)),
  "utf8"
);

test("coordinate sync does not call Geocaching's retired token-based page method", () => {
  assert.equal(routeSource.includes("SetUserCoordinate"), false);
  assert.equal(routeSource.includes("pageUserToken"), false);
  assert.match(routeSource, /openAndFillCoordinateEditor/);
});

test("userscript version is bumped for automatic Tampermonkey updates", () => {
  assert.equal(MYSTERY_USERSCRIPT_VERSION, "2.7.0");
});

test("personal cache note sync compares both copies before replacing either", () => {
  assert.match(routeSource, /geostats-note-sync-request/);
  assert.match(routeSource, /personalCacheNoteFromPage\(document\)/);
  assert.match(routeSource, /Use Geostats note/);
  assert.match(routeSource, /Use Geocaching note/);
  assert.match(routeSource, /geostatsNotes: noteSyncPayload\.notes/);
  assert.match(routeSource, /personalCacheNoteEditorFromPage\(document, isVisible\)/);
});

test("coordinate sync adopts manually opened editors", () => {
  assert.match(routeSource, /solvedCoordinateEditorFromPage\(document, isVisible\)/);
  assert.match(routeSource, /adoptManuallyOpenedEditor\(\)/);
});

test("coordinate sync only clicks one high-confidence editor control", () => {
  assert.match(routeSource, /edit-cache-coordinates/);
  assert.match(routeSource, /data-testid\*='edit-coordinate'/);
  assert.match(routeSource, /candidates\.slice\(0, 1\)/);
  assert.doesNotMatch(routeSource, /add\(coordinateNode|coordinateBounds|sameRow|nearby/);
  assert.match(routeSource, /trigger\.click\(\)/);
});

test("coordinate sync retries the editor and submits without another user click", () => {
  assert.match(routeSource, /MAX_COORDINATE_EDITOR_ATTEMPTS = 4/);
  assert.match(routeSource, /submitSolvedCoordinate\(\)/);
  assert.match(routeSource, /accept\.click\(\)/);
  assert.match(routeSource, /window\.location\.reload\(\)/);
});

test("the header sync also starts the selected cache note sync", () => {
  assert.match(pageSource, /function syncFromHeader\(\)/);
  assert.match(pageSource, /if \(syncableCaches\.length\) syncAttempts\(syncableCaches\)/);
  assert.match(pageSource, /if \(selectedNotesNeedSync && selected\) syncNotes\(selected\)/);
});
