import assert from "node:assert/strict";
import test from "node:test";
import { pickAndUploadDocument, type UploadKind } from "./upload";

function uploadHarness(kind: UploadKind, overrides: Record<string, unknown> = {}) {
  const messages: string[] = [];
  const requests: Array<{ path: string; body: FormData }> = [];
  let pickerOptions: { type: string[]; copyToCacheDirectory: true } | undefined;
  let refreshes = 0;
  const dependencies = {
    pick: async (options: { type: string[]; copyToCacheDirectory: true }) => {
      pickerOptions = options;
      return {
        canceled: false as const,
        assets: [{
          name: kind === "cache" ? "my-finds.gpx" : "owner-logs.csv",
          uri: "file:///picked-file",
          mimeType: kind === "cache" ? "application/gpx+xml" : "text/csv"
        }]
      };
    },
    createFile: () => new Blob(["file contents"], { type: kind === "cache" ? "application/gpx+xml" : "text/csv" }),
    request: async (path: string, body: FormData) => {
      requests.push({ path, body });
    },
    refresh: async () => {
      refreshes += 1;
    },
    onMessage: (message: string) => messages.push(message),
    ...overrides
  };
  return { dependencies, messages, requests, pickerOptions: () => pickerOptions, refreshes: () => refreshes };
}

test("GPX uploads use a cached document and the imports multipart endpoint", async () => {
  const harness = uploadHarness("cache");

  const result = await pickAndUploadDocument("cache", harness.dependencies);

  assert.equal(result, "uploaded");
  assert.deepEqual(harness.pickerOptions(), {
    type: ["application/gpx+xml", "application/zip", "text/xml", "*/*"],
    copyToCacheDirectory: true
  });
  assert.equal(harness.requests[0]?.path, "/imports/upload");
  const file = harness.requests[0]?.body.get("file") as Blob & { name?: string };
  assert.equal(file.name, "my-finds.gpx");
  assert.equal(await file.text(), "file contents");
  assert.deepEqual(harness.messages, ["Uploading import...", "Import queued."]);
  assert.equal(harness.refreshes(), 1);
});

test("trackable uploads explain missing cache coordinates", async () => {
  const harness = uploadHarness("trackable", {
    request: async (path: string, body: FormData) => {
      harness.requests.push({ path, body });
      return { import: { unresolvedCaches: ["GC123", "GC456"] } };
    }
  });

  assert.equal(await pickAndUploadDocument("trackable", harness.dependencies), "uploaded");
  assert.match(harness.messages.at(-1) ?? "", /2 cache locations are missing/);
  assert.match(harness.messages.at(-1) ?? "", /GSAK as GPX\/ZIP/);
});

test("CSV uploads use the owner-log endpoint", async () => {
  const harness = uploadHarness("csv", { createFile: () => new Blob(["owner logs"]) });

  const result = await pickAndUploadDocument("csv", harness.dependencies);

  assert.equal(result, "uploaded");
  assert.equal(harness.requests[0]?.path, "/collector/received-logs/csv");
  assert.equal((harness.requests[0]?.body.get("file") as Blob).type, "text/csv");
  assert.deepEqual(harness.messages, ["Uploading owner logs...", "Owner logs imported."]);
});

test("CSV uploads preserve accepted picker MIME types", async () => {
  const harness = uploadHarness("csv", {
    pick: async () => ({
      canceled: false as const,
      assets: [{ name: "owner-logs.csv", uri: "file:///picked-file", mimeType: "text/plain" }]
    }),
    createFile: () => new Blob(["owner logs"])
  });

  assert.equal(await pickAndUploadDocument("csv", harness.dependencies), "uploaded");
  assert.equal((harness.requests[0]?.body.get("file") as Blob).type, "text/plain");
});

test("CSV uploads normalize unsupported or missing picker MIME types", async () => {
  for (const mimeType of ["application/octet-stream", undefined]) {
    const harness = uploadHarness("csv", {
      pick: async () => ({
        canceled: false as const,
        assets: [{ name: "owner-logs.csv", uri: "file:///picked-file", mimeType }]
      }),
      createFile: () => new Blob(["owner logs"])
    });

    assert.equal(await pickAndUploadDocument("csv", harness.dependencies), "uploaded");
    assert.equal((harness.requests[0]?.body.get("file") as Blob).type, "text/csv");
  }
});

test("canceling the picker does not upload or refresh", async () => {
  const harness = uploadHarness("cache", { pick: async () => ({ canceled: true as const }) });

  const result = await pickAndUploadDocument("cache", harness.dependencies);

  assert.equal(result, "canceled");
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.refreshes(), 0);
  assert.deepEqual(harness.messages, []);
});

test("picker and network failures are shown to the user", async () => {
  for (const overrides of [
    { pick: async () => { throw new Error("Picker unavailable"); } },
    { request: async () => { throw new Error("Upload rejected"); } }
  ]) {
    const harness = uploadHarness("cache", overrides);
    assert.equal(await pickAndUploadDocument("cache", harness.dependencies), "failed");
    assert.match(harness.messages.at(-1) ?? "", /Picker unavailable|Upload rejected/);
  }
});
