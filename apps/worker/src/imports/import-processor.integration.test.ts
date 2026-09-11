import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@geostats/db";
import { ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { ImportProcessor } from "./import-processor";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;
const FIND_COUNT = 501;
const FAILED_FIND_COUNT = 1_001;

function fixtureGpx(prefix: string, count: number, finder: string): Buffer {
  const waypoints = Array.from({ length: count }, (_, index) => {
    const gcCode = `${prefix}${String(index + 1).padStart(5, "0")}`;
    const foundAt = new Date(Date.UTC(2024, 0, index + 1, 12, 0, 0)).toISOString();
    const logText = index === 0 ? "FTF worker integration fixture" : "TFTC worker integration fixture";
    return `
  <wpt lat="56.161200" lon="15.586900">
    <time>2020-01-01T00:00:00Z</time>
    <name>${gcCode}</name>
    <groundspeak:cache>
      <groundspeak:name>${gcCode} integration cache</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Regular</groundspeak:container>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
      <groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>${foundAt}</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>${finder}</groundspeak:finder>
          <groundspeak:text>${logText}</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>
  </wpt>`;
  }).join("");

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0" xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">${waypoints}
</gpx>`
  );
}

function wrapFindCreateManyFailure(prisma: PrismaClient, failOnBatch: number) {
  const realTransaction = prisma.$transaction.bind(prisma);
  let batchCalls = 0;

  (prisma as any).$transaction = (callback: (tx: any) => Promise<unknown>, options?: unknown) =>
    realTransaction(async (tx) => {
      const wrappedFind = {
        ...tx.find,
        createMany: async (args: any) => {
          batchCalls += 1;
          if (batchCalls === failOnBatch) {
            throw new Error(`forced find batch ${failOnBatch} failure`);
          }
          return tx.find.createMany(args);
        }
      };
      return callback({ ...tx, find: wrappedFind });
    }, options as any);

  return () => batchCalls;
}

test(
  "imports more than 500 finds, preserves manual FTF on reimport, and rolls back a failed second batch",
  { skip: !databaseUrl, timeout: 180_000 },
  async () => {
    const runId = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userId = `worker_import_test_${runId}`;
    const email = `${userId}@example.test`;
    const username = `worker_import_${runId}`;
    const fixtureToken = Math.random().toString(36).slice(2, 8).toUpperCase();
    const successfulPrefix = `GCI${fixtureToken}`;
    const failedPrefix = `GCF${fixtureToken}`;
    const finder = username;
    const successfulObjectKey = `${userId}/successful.gpx`;
    const reimportObjectKey = `${userId}/reimport.gpx`;
    const failedObjectKey = `${userId}/failed.gpx`;
    const successfulContent = fixtureGpx(successfulPrefix, FIND_COUNT, finder);
    const failedContent = fixtureGpx(failedPrefix, FAILED_FIND_COUNT, finder);
    const url = new URL(databaseUrl!);
    const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });

    try {
      await prisma.user.create({
        data: {
          id: userId,
          email,
          username
        }
      });
      await prisma.geocachingProfile.create({
        data: {
          userId,
          gcUsername: finder,
          timeZone: "Europe/Stockholm",
          ftfDetectionTerms: ["FTF"]
        }
      });

      const imports = [
        {
          id: `worker_import_success_${runId}`,
          fileName: "successful.gpx",
          objectKey: successfulObjectKey,
          content: successfulContent
        },
        {
          id: `worker_import_reimport_${runId}`,
          fileName: "reimport.gpx",
          objectKey: reimportObjectKey,
          content: successfulContent
        },
        {
          id: `worker_import_failed_${runId}`,
          fileName: "failed.gpx",
          objectKey: failedObjectKey,
          content: failedContent
        }
      ];
      await prisma.import.createMany({
        data: imports.map(({ id, fileName, objectKey }) => ({
          id,
          userId,
          fileName,
          fileType: ImportFileType.GPX,
          source: ImportSource.MY_FINDS_GPX,
          status: ImportStatus.QUEUED,
          objectKey
        }))
      });

      const contentByKey = new Map(imports.map(({ objectKey, content }) => [objectKey, content]));
      const storage = {
        getObject: async (objectKey: string) => {
          const content = contentByKey.get(objectKey);
          assert.ok(content, `missing fixture for ${objectKey}`);
          return content;
        }
      };
      const processor = new ImportProcessor(prisma, storage as any);

      await processor.process({
        importId: imports[0]!.id,
        userId,
        objectKey: successfulObjectKey,
        source: ImportSource.MY_FINDS_GPX
      });

      assert.equal(
        await prisma.find.count({ where: { userId } }),
        FIND_COUNT,
        "the first import must persist every find, including the second createMany batch"
      );
      assert.equal((await prisma.import.findUnique({ where: { id: imports[0]!.id } }))?.status, ImportStatus.COMPLETED);

      const firstFind = await prisma.find.findFirst({
        where: { userId },
        orderBy: { foundAt: "asc" }
      });
      assert.ok(firstFind);
      await prisma.find.update({
        where: { id: firstFind.id },
        data: { isFtf: false, isFtfManual: true }
      });

      await processor.process({
        importId: imports[1]!.id,
        userId,
        objectKey: reimportObjectKey,
        source: ImportSource.MY_FINDS_GPX
      });

      assert.equal(await prisma.find.count({ where: { userId } }), FIND_COUNT, "reimport must not duplicate finds");
      const preservedFind = await prisma.find.findUnique({ where: { id: firstFind.id } });
      assert.equal(preservedFind?.isFtf, false);
      assert.equal(preservedFind?.isFtfManual, true);
      assert.equal((await prisma.import.findUnique({ where: { id: imports[1]!.id } }))?.status, ImportStatus.COMPLETED);

      const countBatches = wrapFindCreateManyFailure(prisma, 2);
      await assert.rejects(
        processor.process({
          importId: imports[2]!.id,
          userId,
          objectKey: failedObjectKey,
          source: ImportSource.MY_FINDS_GPX
        }),
        /forced find batch 2 failure/
      );
      assert.equal(countBatches(), 2, "the failure must happen on the second createMany call");

      assert.equal(
        await prisma.find.count({ where: { userId, cache: { gcCode: { startsWith: failedPrefix } } } }),
        0,
        "a failed second batch must roll back the first batch too"
      );
      assert.equal(await prisma.find.count({ where: { userId } }), FIND_COUNT, "the successful import rows must remain");
      assert.equal((await prisma.import.findUnique({ where: { id: imports[2]!.id } }))?.status, ImportStatus.FAILED);
    } finally {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.cache.deleteMany({ where: { gcCode: { startsWith: successfulPrefix } } });
      await prisma.cache.deleteMany({ where: { gcCode: { startsWith: failedPrefix } } });
      await prisma.$disconnect();
    }
  }
);
