import assert from "node:assert/strict";
import test from "node:test";
import { formatShortDt, ftfRowToListPoint, ftfRowToMapPoint, hasDtData } from "./ftf-points";

test("formatShortDt renders ratings with unknown fallbacks", () => {
  assert.equal(formatShortDt(2.5, 3), "2.5/3");
  assert.equal(formatShortDt(null, null), "?/?");
  assert.equal(formatShortDt(1, undefined), "1/?");
});

test("hasDtData detects any difficulty, terrain, or size value", () => {
  assert.equal(hasDtData({ difficulty: 2.5, terrain: null, size: null }), true);
  assert.equal(hasDtData({ difficulty: null, terrain: null, size: "Small" }), true);
  assert.equal(hasDtData({ difficulty: null, terrain: null, size: null }), false);
  assert.equal(hasDtData({}), false);
  assert.equal(hasDtData(null), false);
  assert.equal(hasDtData(undefined), false);
});

test("ftf mappers keep difficulty, terrain, and size for map callouts and list rows", () => {
  const row = {
    gcCode: "GCB0P42",
    name: "Naturally no pumpkins",
    cacheType: "Traditional Cache",
    difficulty: 2.5,
    terrain: 3,
    size: "Small",
    latitude: 56.1612,
    longitude: 15.5869,
    dateTime: "2026-05-03T08:11:00.000Z"
  };
  assert.deepEqual(ftfRowToMapPoint(row), {
    id: "GCB0P42-2026-05-03T08:11:00.000Z",
    gcCode: "GCB0P42",
    name: "Naturally no pumpkins",
    cacheType: "Traditional Cache",
    difficulty: 2.5,
    terrain: 3,
    size: "Small",
    latitude: 56.1612,
    longitude: 15.5869,
    foundAt: "2026-05-03T08:11:00.000Z"
  });
  const listPoint = ftfRowToListPoint({ ...row, latitude: null, longitude: null });
  assert.equal(listPoint.difficulty, 2.5);
  assert.equal(listPoint.terrain, 3);
  assert.equal(listPoint.size, "Small");
  assert.equal(listPoint.latitude, 0);
});
