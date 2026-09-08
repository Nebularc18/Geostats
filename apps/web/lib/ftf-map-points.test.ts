import assert from "node:assert/strict";
import test from "node:test";
import { formatShortDt, ftfRowsToMapPoints } from "./ftf-map-points.ts";

test("formatShortDt renders ratings with unknown fallbacks", () => {
  assert.equal(formatShortDt(2.5, 3), "2.5/3");
  assert.equal(formatShortDt(null, null), "?/?");
  assert.equal(formatShortDt(1, undefined), "1/?");
});

test("ftf rows keep difficulty, terrain, size, and location for map popups", () => {
  const points = ftfRowsToMapPoints([
    {
      date: "2026-05-03",
      dateTime: "2026-05-03T08:11:00.000Z",
      gcCode: "GCB0P42",
      name: "Naturally no pumpkins",
      cacheType: "Traditional Cache",
      size: "Small",
      difficulty: 2.5,
      terrain: 3,
      country: "Sweden",
      region: "Blekinge",
      county: "Karlskrona",
      latitude: 56.1612,
      longitude: 15.5869
    },
    {
      date: "2026-05-04",
      dateTime: "2026-05-04T09:00:00.000Z",
      gcCode: "GCNOLOC",
      name: "No coordinates",
      cacheType: "Traditional Cache",
      size: "Micro",
      difficulty: 1.5,
      terrain: 1.5,
      country: "Sweden",
      region: "Blekinge",
      county: "Ronneby",
      latitude: null,
      longitude: null
    }
  ]);

  assert.equal(points.length, 1);
  assert.deepEqual(points[0], {
    id: "GCB0P42-2026-05-03",
    gcCode: "GCB0P42",
    name: "Naturally no pumpkins",
    cacheType: "Traditional Cache",
    difficulty: 2.5,
    terrain: 3,
    size: "Small",
    latitude: 56.1612,
    longitude: 15.5869,
    country: "Sweden",
    region: "Blekinge",
    county: "Karlskrona",
    foundAt: "2026-05-03T08:11:00.000Z"
  });

  const details = `D ${points[0]?.difficulty ?? "?"} / T ${points[0]?.terrain ?? "?"} - ${points[0]?.size ?? "Unknown"}`;
  assert.equal(details, "D 2.5 / T 3 - Small");
});
