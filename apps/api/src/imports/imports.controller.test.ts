import assert from "node:assert/strict";
import test from "node:test";
import { ImportFileType, ImportSource } from "@geostats/shared";
import { importSourceFor } from "./imports.controller";

test("travel GPX uploads are treated as Pocket Queries", () => {
  assert.equal(importSourceFor("weekend-route.gpx", ImportFileType.GPX, "travel"), ImportSource.POCKET_QUERY);
});

test("normal upload source detection remains unchanged", () => {
  assert.equal(importSourceFor("my_finds.gpx", ImportFileType.GPX), ImportSource.MY_FINDS_GPX);
  assert.equal(importSourceFor("my_hides.gpx", ImportFileType.GPX), ImportSource.MY_HIDES_GPX);
  assert.equal(importSourceFor("query.zip", ImportFileType.ZIP), ImportSource.POCKET_QUERY);
});

test("explicit import modes take precedence over the extension and filename", () => {
  assert.equal(importSourceFor("renamed.gpx", ImportFileType.GPX, "hides"), ImportSource.MY_HIDES_GPX);
  assert.equal(importSourceFor("my-hides.zip", ImportFileType.ZIP, "finds"), ImportSource.MY_FINDS_GPX);
  assert.equal(importSourceFor("my-finds.gpx", ImportFileType.GPX, "cache-list"), ImportSource.POCKET_QUERY);
});

test("an uncertain enqueue keeps the uploaded source available for reconciliation", async () => {
  const { ImportsController } = await import("./imports.controller");
  const { ImportQueueStateUnknownError } = await import("../queue/import-queue.service");
  let created: { id: string; objectKey: string } | undefined;
  const objects = new Map<string, Buffer>();
  const controller = new ImportsController({
    import: {
      create: async ({ data }: any) => {
        created = { id: "import-1", ...data };
        return created;
      }
    }
  } as never, {
    putObject: async (key: string, value: Buffer) => { objects.set(key, value); },
    deleteObject: async (key: string) => { objects.delete(key); }
  } as never, {
    enqueue: async () => { throw new ImportQueueStateUnknownError(new Error("lost acknowledgement")); }
  } as never);
  const result = await controller.upload(
    { id: "user-1", email: "fixture@example.test", username: "fixture" },
    { originalname: "renamed.gpx", buffer: Buffer.from("<gpx/>") } as Express.Multer.File,
    "hides"
  );
  assert.deepEqual(result, { import: { id: "import-1", status: "QUEUED" } });
  assert.ok(created && objects.has(created.objectKey));
});
