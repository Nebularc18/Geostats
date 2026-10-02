import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { personalCacheMetadata } from "./personal-cache-metadata";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;

test("legacy private metadata migration restores SQL filters without changing catalog or other accounts", { skip: !databaseUrl }, async () => {
  const schema = `private_metadata_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl!);
  url.searchParams.set("schema", schema);
  url.searchParams.set("connection_limit", "1");
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const legacy = {
    lat: "59", lon: "18", desc: "Private cache", time: "2020-01-01",
    "groundspeak:cache": {
      "groundspeak:type": "Unknown Cache", "groundspeak:country": "\u00a0\t Sweden \t\u00a0",
      "groundspeak:owner": { text: "\u00a0\t ALICE \t\u00a0" }, "groundspeak:difficulty": "2.5",
    },
  };
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe("CREATE TABLE caches (id TEXT PRIMARY KEY, metadata_trusted BOOLEAN, latitude NUMERIC, longitude NUMERIC)");
    await prisma.$executeRawUnsafe("CREATE TABLE user_cache_data (id TEXT PRIMARY KEY, user_id TEXT, cache_id TEXT, raw JSONB)");
    await prisma.$executeRawUnsafe("INSERT INTO caches VALUES ('private', false, 0, 0), ('trusted', true, 50, 10)");
    await prisma.$executeRaw`INSERT INTO user_cache_data VALUES ('a', 'a', 'private', ${JSON.stringify(legacy)}::jsonb)`;
    await prisma.$executeRaw`INSERT INTO user_cache_data VALUES ('b', 'b', 'private', ${JSON.stringify({
      lat: 60, lon: 19, extensions: { cache: { name: "Other", country: "Norway", owner: "Bob", type: "Traditional" } },
      geostatsMetadata: { name: "Keep", country: null },
    })}::jsonb)`;
    await prisma.$executeRaw`INSERT INTO user_cache_data VALUES ('trusted', 'a', 'trusted', ${JSON.stringify(legacy)}::jsonb)`;
    await prisma.$executeRaw`INSERT INTO user_cache_data VALUES ('bad', 'a', 'private', ${JSON.stringify({
      lat: "1e999999", lon: "18", time: "not a date", cache: { difficulty: "NaN" },
    })}::jsonb)`;
    await prisma.$executeRaw`INSERT INTO user_cache_data VALUES ('offset', 'a', 'private', ${JSON.stringify({ time: "2020-01-01T00:00:00+02:00" })}::jsonb)`;
    await prisma.$executeRawUnsafe("SET TIME ZONE 'Europe/Stockholm'");
    const migration = readFileSync(resolve(__dirname, "../prisma/migrations/000038_normalize_private_cache_metadata/migration.sql"), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of migration.match(/(?:\$\$[\s\S]*?\$\$|[^;])+;/g) ?? []) {
      await prisma.$executeRawUnsafe(statement);
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; raw: Record<string, unknown> }>>("SELECT id, raw FROM user_cache_data");
    const data = Object.fromEntries(rows.map((row) => [row.id, row.raw]));
    const normalized = data.a.geostatsMetadata as Record<string, unknown>;
    assert.equal(normalized.ownerNameNormalized, "alice");
    assert.equal(normalized.latitude, 59);
    assert.equal(normalized.longitude, 18);
    assert.equal(normalized.cacheType, "Mystery Cache");
    assert.equal(normalized.hiddenDate, "2020-01-01T00:00:00.000Z");
    assert.equal((data.offset.geostatsMetadata as Record<string, unknown>).hiddenDate, "2019-12-31T22:00:00.000Z");
    assert.deepEqual(await prisma.$queryRawUnsafe("SHOW TimeZone"), [{ TimeZone: "Europe/Stockholm" }]);
    assert.deepEqual(personalCacheMetadata({ metadataTrusted: false }, data.a), personalCacheMetadata({ metadataTrusted: false }, legacy));
    assert.equal((data.b.geostatsMetadata as Record<string, unknown>).name, "Keep");
    assert.equal((data.b.geostatsMetadata as Record<string, unknown>).country, null);
    assert.equal((data.bad.geostatsMetadata as Record<string, unknown>).latitude, undefined);
    assert.equal((data.bad.geostatsMetadata as Record<string, unknown>).hiddenDate, null);
    assert.equal(data.trusted.geostatsMetadata, undefined);
    // These are the JSON predicates used before map/travel pagination and
    // owner exclusion. The account boundary remains part of every predicate.
    assert.equal((await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM user_cache_data
      WHERE user_id = 'a' AND raw #>> '{geostatsMetadata,country}' = 'Sweden'
        AND (raw #>> '{geostatsMetadata,latitude}')::numeric BETWEEN 58 AND 60`))[0]?.id, "a");
    assert.equal((await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM user_cache_data
      WHERE user_id = 'b' AND raw #>> '{geostatsMetadata,ownerNameNormalized}' = 'alice'`)).length, 0);
    assert.equal((await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM user_cache_data
      WHERE user_id = 'a' AND raw #>> '{geostatsMetadata,ownerNameNormalized}' = 'alice'`))[0]?.id, "a");
    assert.deepEqual(await prisma.$queryRawUnsafe("SELECT id, latitude::text, longitude::text FROM caches ORDER BY id"), [
      { id: "private", latitude: "0", longitude: "0" }, { id: "trusted", latitude: "50", longitude: "10" },
    ]);
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
});
