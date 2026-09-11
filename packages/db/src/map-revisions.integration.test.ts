import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;

// Isolated schema and synthetic rows only. Exercise the real migration and
// independent database connections, including commits between page reads.
test("map revisions cover bulk writes, shared metadata, cascades and transaction visibility", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const fixtureSuffix = randomUUID().replaceAll("-", "");
  const schema = `map_revision_test_${fixtureSuffix}`;
  const sharedCacheId = `shared-${fixtureSuffix}`;
  const ownCacheId = `own-${fixtureSuffix}`;
  const settleTransactions = async (transactions: Promise<unknown>[]) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.allSettled(transactions),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("concurrent map revision transactions did not settle")), 5_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };
  const url = new URL(databaseUrl!);
  url.searchParams.set("schema", schema);
  const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const observer = new PrismaClient({ datasources: { db: { url: url.href } } });
  const revision = async (client = prisma, userId = "a") => {
    const row = await client.mapRevision.findUnique({ where: { userId } });
    return row?.revision ?? 0n;
  };
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe('CREATE TABLE users (id TEXT PRIMARY KEY)');
    await prisma.$executeRawUnsafe('CREATE TABLE caches (id TEXT PRIMARY KEY, name TEXT)');
    for (const table of ["finds", "hides", "imports", "geocaching_profiles", "corrected_coordinates"]) {
      await prisma.$executeRawUnsafe(`CREATE TABLE ${table} (
        id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        cache_id TEXT REFERENCES caches(id) ON DELETE CASCADE, value TEXT
      )`);
    }
    const migration = readFileSync(resolve(__dirname, "../prisma/migrations/000035_map_revisions/migration.sql"), "utf8")
      .replace(/--[^\n]*/g, "");
    // Preserve dollar-quoted function/DO bodies as single SQL statements.
    const statements = migration.match(/(?:\$\$[\s\S]*?\$\$|[^;])+;/g) ?? [];
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe("INSERT INTO users VALUES ('a'), ('b'), ('unrelated')");
    await prisma.$executeRawUnsafe(`INSERT INTO caches VALUES ('${sharedCacheId}', 'Before'), ('${ownCacheId}', 'Own')`);
    assert.equal(await revision(), 0n);

    // A single bulk statement increments once, including on 10,000-row imports.
    await prisma.$executeRawUnsafe(`INSERT INTO finds SELECT 'find-' || n, 'a', '${sharedCacheId}', 'old' FROM generate_series(1, 10000) n`);
    assert.equal(await revision(), 1n);
    await prisma.$executeRawUnsafe(`INSERT INTO hides VALUES ('hide', 'b', '${sharedCacheId}', 'old')`);
    assert.equal(await revision(prisma, "b"), 1n);
    await prisma.$executeRawUnsafe(`UPDATE caches SET name = 'After' WHERE id = '${sharedCacheId}'`);
    assert.equal(await revision(), 2n);
    assert.equal(await revision(prisma, "b"), 2n);
    assert.equal(await revision(prisma, "unrelated"), 0n);

    // Every user-scoped mutation family invalidates on insert, update, delete.
    for (const table of ["imports", "geocaching_profiles", "corrected_coordinates"]) {
      const before = await revision();
      await prisma.$executeRawUnsafe(`INSERT INTO ${table} VALUES ('row', 'a', '${ownCacheId}', 'old')`);
      assert.equal(await revision(), before + 1n, `${table} insert`);
      await prisma.$executeRawUnsafe(`UPDATE ${table} SET value = 'new' WHERE id = 'row'`);
      assert.equal(await revision(), before + 2n, `${table} update`);
      await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = 'row'`);
      assert.equal(await revision(), before + 3n, `${table} delete`);
    }
    // Moving ownership invalidates both owners, including restore-style updates.
    const beforeA = await revision();
    const beforeB = await revision(prisma, "b");
    await prisma.$executeRawUnsafe("UPDATE hides SET user_id = 'a' WHERE id = 'hide'");
    assert.equal(await revision(), beforeA + 1n);
    assert.equal(await revision(prisma, "b"), beforeB + 1n);
    const noOpRevision = await revision();
    await prisma.$executeRawUnsafe("UPDATE finds SET value = 'none' WHERE id = 'missing'");
    assert.equal(await revision(), noOpRevision);

    const committed = await revision();
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("DELETE FROM finds");
      assert.equal((await tx.mapRevision.findUnique({ where: { userId: "a" } }))!.revision, committed, "revision flush is deferred until commit");
      assert.equal(await tx.mapRevisionChange.count(), 1);
      assert.equal(await revision(observer), committed, "uncommitted revision must stay invisible");
      throw new Error("rollback fixture");
    }), /rollback fixture/);
    assert.equal(await revision(), committed, "rollback restores revision and rows");
    assert.equal(await prisma.mapRevisionChange.count(), 0, "rollback removes queued changes");
    const [count] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM finds`;
    assert.equal(count.count, 10000n);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("UPDATE finds SET value = 'committed' WHERE id = 'find-1'");
      assert.equal((await tx.mapRevision.findUnique({ where: { userId: "a" } }))!.revision, committed);
      assert.equal(await tx.mapRevisionChange.count(), 1);
      assert.equal(await revision(observer), committed);
    });
    assert.equal(await revision(observer), committed + 1n, "later page detects a committed mutation");
    assert.equal(await prisma.mapRevisionChange.count(), 0, "commit flush removes queued changes");

    // Concurrent writers must not lose increments.
    const beforeConcurrent = await revision();
    await Promise.all([
      prisma.$executeRawUnsafe("UPDATE finds SET value = 'one' WHERE id = 'find-1'"),
      observer.$executeRawUnsafe("UPDATE finds SET value = 'two' WHERE id = 'find-2'")
    ]);
    assert.equal(await revision(), beforeConcurrent + 2n);

    // A same-user pair of transactions used to deadlock when each transaction
    // held a find row and then waited on the shared revision row. The deferred
    // flush lets both finish their data writes before taking revision locks.
    const cycleFindOne = `cycle-one-${fixtureSuffix}`;
    const cycleFindTwo = `cycle-two-${fixtureSuffix}`;
    await prisma.$executeRawUnsafe(`INSERT INTO finds VALUES ('${cycleFindOne}', 'a', '${ownCacheId}', 'cycle'), ('${cycleFindTwo}', 'a', '${ownCacheId}', 'cycle')`);
    const cycleBaseline = await revision();
    const cycleAFirst = gate();
    const cycleBHasFindLock = gate();
    const cycleA = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'cycle-a-one' WHERE id = '${cycleFindOne}'`);
      cycleAFirst.release();
      await cycleBHasFindLock.promise;
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'cycle-a-two' WHERE id = '${cycleFindTwo}'`);
    });
    await cycleAFirst.promise;
    const cycleB = observer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT id FROM finds WHERE id = '${cycleFindTwo}' FOR UPDATE`);
      cycleBHasFindLock.release();
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'cycle-b-two' WHERE id = '${cycleFindTwo}'`);
    });
    const cycleResults = await settleTransactions([cycleA, cycleB]);
    assert.deepEqual(cycleResults.map(({ status }) => status), ["fulfilled", "fulfilled"], "same-user opposite row order must not deadlock");
    assert.equal(await revision(), cycleBaseline + 2n);
    assert.equal(await prisma.mapRevisionChange.count(), 0);

    // Opposite source order across two users must also complete and increment
    // both users once per transaction.
    const multiFindAOne = `multi-a-one-${fixtureSuffix}`;
    const multiFindATwo = `multi-a-two-${fixtureSuffix}`;
    const multiFindBOne = `multi-b-one-${fixtureSuffix}`;
    const multiFindBTwo = `multi-b-two-${fixtureSuffix}`;
    await prisma.$executeRawUnsafe(`INSERT INTO finds VALUES
      ('${multiFindAOne}', 'a', '${ownCacheId}', 'multi'),
      ('${multiFindATwo}', 'a', '${ownCacheId}', 'multi'),
      ('${multiFindBOne}', 'b', '${ownCacheId}', 'multi'),
      ('${multiFindBTwo}', 'b', '${ownCacheId}', 'multi')`);
    const multiBaselineA = await revision();
    const multiBaselineB = await revision(prisma, "b");
    const multiAFirst = gate();
    const multiBFirst = gate();
    const multiASecondStarted = gate();
    const multiA = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'multi-a-first' WHERE id = '${multiFindAOne}'`);
      multiAFirst.release();
      await multiBFirst.promise;
      multiASecondStarted.release();
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'multi-a-second' WHERE id = '${multiFindBOne}'`);
    });
    await multiAFirst.promise;
    const multiB = observer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'multi-b-first' WHERE id = '${multiFindBTwo}'`);
      multiBFirst.release();
      await multiASecondStarted.promise;
      await tx.$executeRawUnsafe(`UPDATE finds SET value = 'multi-b-second' WHERE id = '${multiFindATwo}'`);
    });
    const multiResults = await settleTransactions([multiA, multiB]);
    assert.deepEqual(multiResults.map(({ status }) => status), ["fulfilled", "fulfilled"], "opposite user source order must not deadlock");
    assert.equal(await revision(), multiBaselineA + 2n);
    assert.equal(await revision(prisma, "b"), multiBaselineB + 2n);
    assert.equal(await prisma.mapRevisionChange.count(), 0);

    const beforeCascade = await revision();
    await prisma.$executeRawUnsafe(`DELETE FROM caches WHERE id = '${sharedCacheId}'`);
    assert.ok(await revision() > beforeCascade, "cache cascade invalidates remaining map pages");
    await prisma.$executeRawUnsafe("DELETE FROM users WHERE id = 'a'");
    assert.equal(await prisma.mapRevision.findUnique({ where: { userId: "a" } }), null);
    assert.equal(await prisma.mapRevisionChange.count(), 0);
  } finally {
    await observer.$disconnect();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
});
