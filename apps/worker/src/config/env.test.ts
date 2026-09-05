import assert from "node:assert/strict";
import test from "node:test";
import { envOrDefault, requiredEnv } from "./env";

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

test("envOrDefault rejects placeholders before later query parameters", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_ENDPOINT: "https://storage.example.test/bucket?key=replace-with-an-api-key&region=us-east-1"
    },
    () => {
      assert.throws(() => envOrDefault("S3_ENDPOINT", "https://fallback.example.test"), /development value/);
    }
  );
});

test("envOrDefault rejects placeholders after query parameter separators", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_ENDPOINT: "https://storage.example.test/bucket?region=us-east-1&replace-with-an-api-key=value"
    },
    () => {
      assert.throws(() => envOrDefault("S3_ENDPOINT", "https://fallback.example.test"), /development value/);
    }
  );
});

test("requiredEnv applies length guard to S3 secret access keys", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_SECRET_ACCESS_KEY: "short-access-key"
    },
    () => {
      assert.throws(() => requiredEnv("S3_SECRET_ACCESS_KEY"), /must be at least 32 characters/);
    }
  );
});

test("requiredEnv rejects Dockhand production secret placeholders", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_SECRET_ACCESS_KEY: "change-this-minio-password-min-32-chars"
    },
    () => {
      assert.throws(() => requiredEnv("S3_SECRET_ACCESS_KEY"), /development value/);
    }
  );
});

test("requiredEnv accepts a non-placeholder production secret", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_SECRET_ACCESS_KEY: "c960d85eaf664adb8243d1834d465645"
    },
    () => {
      assert.equal(requiredEnv("S3_SECRET_ACCESS_KEY"), "c960d85eaf664adb8243d1834d465645");
    }
  );
});

test("envOrDefault rejects Dockhand placeholders embedded in connection URLs", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_ENDPOINT: "redis://:change-this-redis-password-min-32-chars@redis:6379"
    },
    () => {
      assert.throws(() => envOrDefault("S3_ENDPOINT", "https://fallback.example.test"), /development value/);
    }
  );
});
