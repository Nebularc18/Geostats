import assert from "node:assert/strict";
import test from "node:test";
import { ImportSource } from "@geostats/shared";
import { ImportQueueService } from "./import-queue.service";

test("enqueue deduplicates jobs by import and does not retain queue history", async () => {
  let added: any;
  const service = Object.create(ImportQueueService.prototype) as any;
  service.queue = {
    add: async (...args: any[]) => {
      added = args;
    },
  };

  await service.enqueue({
    importId: "import-1",
    userId: "user-1",
    objectKey: "imports/import-1.gpx",
    source: ImportSource.GSAK,
  });

  assert.equal(added[0], "process-import");
  assert.deepEqual(added[1], {
    importId: "import-1",
    userId: "user-1",
    objectKey: "imports/import-1.gpx",
    source: ImportSource.GSAK,
  });
  assert.deepEqual(added[2], {
    jobId: "import-import-1",
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
});
