import assert from "node:assert/strict";
import test from "node:test";
import { personalCacheMetadata, privateCacheRaw } from "./personal-cache-metadata";

test("personal metadata cannot override a trusted shared catalog or an unspecified trust flag", () => {
  const raw = { geostatsMetadata: { name: "Attacker", latitude: 59, longitude: 18, metadataTrusted: true, gcCode: "OTHER" } };
  assert.deepEqual(personalCacheMetadata({ metadataTrusted: true }, raw), {});
  assert.deepEqual(personalCacheMetadata({}, raw), {});
  assert.deepEqual(personalCacheMetadata({ metadataTrusted: false }, null), {});
  const overlay = personalCacheMetadata({ metadataTrusted: false }, raw);
  assert.equal(overlay.name, "Attacker");
  assert.equal("metadataTrusted" in overlay, false);
  assert.equal("gcCode" in overlay, false);
});

test("legacy GPX and GSAK waypoint extensions restore private display fields", () => {
  const overlay = personalCacheMetadata({ metadataTrusted: false }, {
    lat: "59", lon: "18", time: "2020-01-01", extensions: { cache: {
      name: { text: " Private cache " }, type: "Unknown Cache", owner: { text: " Bob " },
      difficulty: "2.5", terrain: 3, country: "Sweden", state: "Stockholm"
    } }
  });
  assert.equal(overlay.name, "Private cache");
  assert.equal(overlay.cacheType, "Mystery Cache");
  assert.equal(overlay.ownerName, "Bob");
  assert.equal(overlay.latitude, 59);
  assert.equal(overlay.longitude, 18);
  assert.equal(overlay.hiddenDate?.toISOString(), "2020-01-01T00:00:00.000Z");
});

test("normalized private storage preserves raw logs while excluding authority and invalid metadata", () => {
  const raw = privateCacheRaw({ logs: ["keep"], "groundspeak:cache": { "groundspeak:name": "Old name" } }, {
    name: "New name", cacheType: "Mystery", hiddenDate: new Date("2020-01-01"), ownerName: " ALICE ",
    latitude: 100, longitude: Number.POSITIVE_INFINITY, difficulty: 12,
    ...{ id: "injected", metadataTrusted: true }
  });
  assert.deepEqual(raw.logs, ["keep"]);
  const stored = raw.geostatsMetadata as Record<string, unknown>;
  assert.equal(stored.ownerNameNormalized, "alice");
  assert.equal(stored.hiddenDate, "2020-01-01T00:00:00.000Z");
  assert.equal(stored.cacheType, "Mystery Cache");
  assert.equal("id" in stored, false);
  assert.equal("metadataTrusted" in stored, false);
  assert.equal("latitude" in stored, false);
  assert.equal(personalCacheMetadata({ metadataTrusted: false }, raw).name, "New name");
});
