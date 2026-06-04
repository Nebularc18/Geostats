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

test("requiredEnv rejects documented production placeholders", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      JWT_SECRET: "replace-with-at-least-32-random-bytes"
    },
    () => {
      assert.throws(() => requiredEnv("JWT_SECRET"), /development value/);
    }
  );
});

test("requiredEnv rejects short production secrets", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      JWT_SECRET: "short-secret"
    },
    () => {
      assert.throws(() => requiredEnv("JWT_SECRET"), /at least 32 characters/);
    }
  );
});

test("requiredEnv accepts strong production secrets", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      JWT_SECRET: "0123456789abcdef0123456789abcdef"
    },
    () => {
      assert.equal(requiredEnv("JWT_SECRET"), "0123456789abcdef0123456789abcdef");
    }
  );
});

test("envOrDefault rejects placeholders embedded in production URLs", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://geostats:replace-with-a-strong-postgres-password@postgres:5432/geostats"
    },
    () => {
      assert.throws(() => envOrDefault("DATABASE_URL", "postgresql://fallback"), /development value/);
    }
  );
});
