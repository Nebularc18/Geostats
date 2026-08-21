import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MYSTERY_USERSCRIPT_VERSION } from "./mystery-userscript.ts";

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
  assert.equal(MYSTERY_USERSCRIPT_VERSION, "2.5.1");
});

test("coordinate sync supports current editor controls and a manual-open fallback", () => {
  assert.match(routeSource, /edit-cache-coordinates/);
  assert.match(routeSource, /data-testid\*='edit-coordinate'/);
  assert.match(routeSource, /triggers\[index\]\.click\(\)/);
  assert.match(routeSource, /adoptManuallyOpenedEditor\(\)/);
  assert.match(routeSource, /Click the pencil beside the coordinates/);
});
