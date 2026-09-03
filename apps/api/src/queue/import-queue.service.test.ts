import assert from "node:assert/strict";
import test from "node:test";
import { ImportSource } from "@geostats/shared";
import {
  ImportQueueRejectedError,
  ImportQueueService,
  ImportQueueStateUnknownError,
} from "./import-queue.service";

const payload = {
  importId: "import-1",
  userId: "user-1",
  objectKey: "imports/import-1.gpx",
  source: ImportSource.GSAK,
};

test("enqueue deduplicates jobs by import and does not retain queue history", async () => {
  let added: any;
  const service = Object.create(ImportQueueService.prototype) as any;
  service.queue = {
    add: async (...args: any[]) => {
      added = args;
    },
  };

  await service.enqueue(payload);

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

test("enqueue accepts an ambiguous add when the deterministic job is present", async () => {
  const service = Object.create(ImportQueueService.prototype) as any;
  service.queue = {
    add: async () => {
      throw new Error("connection lost after write");
    },
    getJob: async () => ({ id: "import-import-1" }),
  };

  await assert.doesNotReject(() => service.enqueue(payload));
});

test("enqueue reports a definite rejection when no deterministic job exists", async () => {
  const service = Object.create(ImportQueueService.prototype) as any;
  service.queue = {
    add: async () => {
      throw new Error("Redis offline");
    },
    getJob: async () => undefined,
  };

  await assert.rejects(() => service.enqueue(payload), ImportQueueRejectedError);
});

test("enqueue preserves an unknown queue state when job inspection fails", async () => {
  const service = Object.create(ImportQueueService.prototype) as any;
  service.queue = {
    add: async () => {
      throw new Error("connection lost after write");
    },
    getJob: async () => {
      throw new Error("Redis still offline");
    },
  };

  await assert.rejects(() => service.enqueue(payload), ImportQueueStateUnknownError);
});
