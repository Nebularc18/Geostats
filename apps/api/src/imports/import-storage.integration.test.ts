import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { PrismaClient } from "@geostats/db";
import type { PrismaService } from "../common/prisma.service";
import { PortabilityService } from "../portability/portability.service";
import { ImportRecoveryService } from "./import-recovery.service";
import { ABANDONED_UPLOAD_RETENTION_MS, COMPLETED_IMPORT_RETENTION_MS, FAILED_IMPORT_RETENTION_MS } from "./import-storage";
import { ImportsController } from "./imports.controller";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;

function importFixture(userId: string, key: string) {
  return { userId, objectKey: `${userId}/${key}.gpx`, fileName: `${key}.gpx`, fileType: "GPX", source: "MY_FINDS_GPX", objectSizeBytes: 8 } as const;
}

async function withAccount(run: (prisma: PrismaService, user: { id: string; email: string; username: string }) => Promise<void>) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }) as PrismaService;
  const id = `import-test-${randomUUID()}`;
  const user = { id, email: `${id}@example.test`, username: id };
  try {
    await prisma.user.create({ data: user });
    await run(prisma, user);
  } finally {
    try {
      await prisma.user.deleteMany({ where: { id } });
      await prisma.pendingObjectDeletion.deleteMany({ where: { objectKey: { startsWith: `${id}/` } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

const file = { originalname: "finds.gpx", buffer: Buffer.from("<gpx/>") } as Express.Multer.File;
const isStatus = (status: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === status;

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

test("concurrent upload reservations enforce the byte and pending limits before a PUT", { skip: !databaseUrl }, async () => {
  await withAccount(async (prisma, user) => {
    const stored = await prisma.import.create({ data: {
      ...importFixture(user.id, "retained"),
      status: "COMPLETED",
      objectSizeBytes: 256 * 1024 * 1024 - file.buffer.length
    } });
    const puts: string[] = [];
    const queue = { enqueue: async () => undefined };
    const controller = new ImportsController(prisma, { putObject: async (key: string) => puts.push(key) } as never, queue as never);

    const uploads = await Promise.allSettled([controller.upload(user, file), controller.upload(user, file)]);
    assert.equal(uploads.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = uploads.find((result) => result.status === "rejected");
    assert.ok(rejected && isStatus(429)(rejected.reason));
    assert.equal(puts.length, 1);

    await prisma.import.update({ where: { id: stored.id }, data: { objectSizeBytes: file.buffer.length } });
    await prisma.import.createMany({ data: Array.from({ length: 9 }, (_, index) => ({ ...importFixture(user.id, `pending-${index}`), status: "QUEUED" })) });
    const retry = await prisma.import.create({ data: { ...importFixture(user.id, "retry"), status: "FAILED" } });
    await assert.rejects(controller.upload(user, file), isStatus(429));
    await assert.rejects(controller.retry(user, retry.id), isStatus(429));
    assert.equal(puts.length, 1);
  });
});

test("retention preserves history and a retry window, charging failed deletions until confirmed", { skip: !databaseUrl }, async () => {
  await withAccount(async (prisma, user) => {
    const now = Date.now();
    const completed = await prisma.import.create({ data: {
      ...importFixture(user.id, "completed"),
      objectSizeBytes: 256 * 1024 * 1024 - 24,
      status: "COMPLETED",
      updatedAt: new Date(now - COMPLETED_IMPORT_RETENTION_MS - 1000)
    } });
    const failed = await prisma.import.create({ data: {
      ...importFixture(user.id, "failed"), status: "FAILED", updatedAt: new Date(now - FAILED_IMPORT_RETENTION_MS - 1000)
    } });
    const abandoned = await prisma.import.create({ data: {
      ...importFixture(user.id, "abandoned"), status: "UPLOADED", updatedAt: new Date(now - ABANDONED_UPLOAD_RETENTION_MS - 1000)
    } });
    const retry = await prisma.import.create({ data: { ...importFixture(user.id, "retry"), status: "FAILED" } });
    const queued = await prisma.import.create({ data: { ...importFixture(user.id, "queued"), status: "QUEUED", updatedAt: failed.updatedAt } });
    const deleted: string[] = [];
    let outage = true;
    const storage = {
      putObject: async () => undefined,
      deleteObject: async (key: string) => {
        if (key === completed.objectKey && outage) throw new Error("S3 unavailable");
        if (key.startsWith(`${user.id}/`)) deleted.push(key);
      }
    };
    const queue = { enqueue: async () => undefined };
    const controller = new ImportsController(prisma, storage as never, queue as never);
    const recovery = new ImportRecoveryService(prisma, queue as never, storage as never);

    const before = await controller.list(user);
    assert.equal(before.imports.find((row) => row.id === failed.id)?.retryable, false);
    assert.equal(before.imports.find((row) => row.id === retry.id)?.retryable, true);
    await assert.rejects(controller.retry(user, failed.id), isStatus(404));
    await recovery.cleanupExpiredObjects();
    assert.deepEqual(deleted.sort(), [abandoned.objectKey, failed.objectKey].sort());
    const after = await prisma.import.findUniqueOrThrow({ where: { id: completed.id } });
    assert.equal(after.objectKey, completed.objectKey);
    assert.equal(after.objectSizeBytes, completed.objectSizeBytes);
    assert.ok(after.objectCleanupAttemptedAt);
    const stopped = await prisma.import.findUniqueOrThrow({ where: { id: abandoned.id } });
    assert.equal(stopped.status, "FAILED");
    assert.equal(stopped.objectKey, "");
    assert.equal((await prisma.import.findUniqueOrThrow({ where: { id: queued.id } })).objectKey, queued.objectKey);
    await assert.rejects(controller.upload(user, { ...file, buffer: Buffer.from("<gpx></gpx>") }), isStatus(429));
    assert.equal((await controller.retry(user, retry.id)).import.status, "QUEUED");

    outage = false;
    await prisma.import.update({ where: { id: completed.id }, data: { objectCleanupAttemptedAt: new Date(now - 120_000), updatedAt: completed.updatedAt } });
    await recovery.cleanupExpiredObjects();
    const removed = await prisma.import.findUniqueOrThrow({ where: { id: completed.id } });
    assert.equal(removed.objectKey, "");
    assert.equal(removed.objectSizeBytes, null);
    assert.equal(removed.status, "COMPLETED");
    assert.deepEqual(removed.updatedAt, completed.updatedAt);
    assert.equal((await controller.upload(user, file)).import.status, "QUEUED");
  });
});

test("account deletion collects a source file reserved by an in-flight upload", { skip: !databaseUrl, timeout: 10_000 }, async () => {
  await withAccount(async (prisma, user) => {
    const started = gate();
    const resume = gate();
    const objects = new Set<string>();
    const storage = {
      putObject: async (key: string) => {
        started.open();
        await resume.promise;
        objects.add(key);
      },
      deleteObject: async (key: string) => { objects.delete(key); }
    };
    const queue = { enqueue: async () => undefined };
    const controller = new ImportsController(prisma, storage as never, queue as never);
    const portability = new PortabilityService(prisma, storage as never);
    const upload = controller.upload(user, file);
    await started.promise;
    const cancelled = assert.rejects(upload, isStatus(404));
    try {
      await portability.deleteAccount(user);
    } finally {
      resume.open();
    }
    await cancelled;
    assert.equal(objects.size, 1);
    const [key] = objects;
    const cleanup = await prisma.pendingObjectDeletion.findUniqueOrThrow({ where: { objectKey: key } });
    assert.ok(cleanup.availableAt.getTime() > Date.now());
    await prisma.pendingObjectDeletion.update({ where: { objectKey: key }, data: { availableAt: new Date(0) } });
    await portability["cleanupPendingObjects"]();
    assert.equal(objects.size, 0);
    await assert.rejects(controller.upload(user, file), isStatus(404));
  });
});
