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
      await tx.$executeRawUnsafe('CREATE TEMP TABLE caches (id text, owner_name text) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE finds (id text, user_id text, cache_id text) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE hides (id text, user_id text, cache_id text) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO caches VALUES ('unknown', NULL), ('other', 'Bob'), ('own', 'ALICE'), ('hidden', NULL)`);
      await tx.$executeRawUnsafe(`INSERT INTO finds VALUES ('1','user-1','unknown'), ('2','user-1','other'), ('3','user-1','own'), ('4','user-1','hidden'), ('5','user-2','other')`);
      await tx.$executeRawUnsafe(`INSERT INTO hides VALUES ('1','user-1','hidden')`);
      assert.equal(await tx.find.count({ where: countableFindWhere("user-1", "alice") }), 2);
      assert.equal(await tx.find.count({ where: countableFindWhere("user-1", null) }), 3);
    });
  } finally {
    await prisma.$disconnect();
  }
});
