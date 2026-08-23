import assert from "node:assert/strict";
import test from "node:test";
import { ImportFileType, ImportSource } from "@geostats/shared";
import { importSourceFor } from "./imports.controller";

test("travel GPX uploads are treated as Pocket Queries", () => {
  assert.equal(importSourceFor("weekend-route.gpx", ImportFileType.GPX, "travel"), ImportSource.POCKET_QUERY);
});

test("normal upload source detection remains unchanged", () => {
  assert.equal(importSourceFor("my_finds.gpx", ImportFileType.GPX), ImportSource.MY_FINDS_GPX);
  assert.equal(importSourceFor("my_hides.gpx", ImportFileType.GPX), ImportSource.MY_HIDES_GPX);
  assert.equal(importSourceFor("query.zip", ImportFileType.ZIP), ImportSource.POCKET_QUERY);
});
