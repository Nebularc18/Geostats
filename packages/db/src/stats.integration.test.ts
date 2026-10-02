import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { countableFindWhere } from "./stats";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;

test("PostgreSQL counts unknown owners while excluding own hides and own cache metadata", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  // Session-local tables exercise Prisma's generated SQL without touching application data.
  url.searchParams.set("schema", "pg_temp");
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE caches (id text, owner_name text, metadata_trusted boolean) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE user_cache_data (user_id text, cache_id text, raw jsonb) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE finds (id text, user_id text, cache_id text) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE hides (id text, user_id text, cache_id text) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO caches VALUES ('unknown', NULL, true), ('other', 'Bob', true), ('own', 'ALICE', true), ('hidden', NULL, true), ('private-own', NULL, false), ('private-other', NULL, false)`);
      await tx.$executeRawUnsafe(`INSERT INTO finds VALUES ('1','user-1','unknown'), ('2','user-1','other'), ('3','user-1','own'), ('4','user-1','hidden'), ('5','user-2','other')`);
      await tx.$executeRawUnsafe(`INSERT INTO hides VALUES ('1','user-1','hidden')`);
      await tx.$executeRawUnsafe(`INSERT INTO finds VALUES ('6','user-1','private-own'), ('7','user-1','private-other')`);
      await tx.$executeRawUnsafe(`INSERT INTO user_cache_data VALUES ('user-1','private-own','{"geostatsMetadata":{"ownerNameNormalized":"alice"}}'), ('user-2','private-other','{"geostatsMetadata":{"ownerNameNormalized":"alice"}}')`);
      assert.equal(await tx.find.count({ where: countableFindWhere("user-1", "alice") }), 3);
      assert.equal(await tx.find.count({ where: countableFindWhere("user-1", null) }), 5);
    });
  } finally {
    await prisma.$disconnect();
  }
});
