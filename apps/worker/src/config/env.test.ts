import assert from "node:assert/strict";
import test from "node:test";
import { envOrDefault } from "./env";

async function withEnv(values: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("envOrDefault rejects query-string placeholders in production URLs", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_ENDPOINT: "https://storage.example.test/bucket?key=replace-with-an-api-key"
    },
    () => {
      assert.throws(() => envOrDefault("S3_ENDPOINT", "https://fallback.example.test"), /development value/);
    }
  );
});

test("envOrDefault rejects placeholders used as query parameter keys", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_ENDPOINT: "https://storage.example.test/bucket?replace-with-an-api-key=value"
    },
    () => {
      assert.throws(() => envOrDefault("S3_ENDPOINT", "https://fallback.example.test"), /development value/);
    }
  );
});
