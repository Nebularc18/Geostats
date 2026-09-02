import assert from "node:assert/strict";
import test from "node:test";
import { envOrDefault, requiredEnv, validateAuthEnv } from "./env";

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

test("requiredEnv applies length guard to S3 secret access keys", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      S3_SECRET_ACCESS_KEY: "short-access-key"
    },
    () => {
      assert.throws(() => requiredEnv("S3_SECRET_ACCESS_KEY"), /at least 32 characters/);
    }
  );
});

test("requiredEnv applies length guard to collector token encryption keys", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      COLLECTOR_TOKEN_ENCRYPTION_KEY: "short-key"
    },
    () => {
      assert.throws(() => requiredEnv("COLLECTOR_TOKEN_ENCRYPTION_KEY"), /at least 32 characters/);
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

test("Clerk auth requires both Clerk credentials", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined
    },
    () => {
      assert.throws(() => validateAuthEnv(), /CLERK_SECRET_KEY must be set/);
    }
  );

  await withEnv(
    {
      NODE_ENV: "development",
      AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "sk_test_secret",
      CLERK_PUBLISHABLE_KEY: undefined
    },
    () => {
      assert.throws(() => validateAuthEnv(), /CLERK_PUBLISHABLE_KEY must be set/);
    }
  );
});

test("password and development auth do not require Clerk credentials", async () => {
  for (const authMode of ["password", "dev"]) {
    await withEnv(
      {
        NODE_ENV: "development",
        AUTH_MODE: authMode,
        CLERK_SECRET_KEY: undefined,
        CLERK_PUBLISHABLE_KEY: undefined
      },
      () => {
        assert.doesNotThrow(() => validateAuthEnv());
      }
    );
  }
});

test("production defaults to Clerk auth and requires credentials", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      AUTH_MODE: undefined,
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined
    },
    () => {
      assert.throws(() => validateAuthEnv(), /CLERK_SECRET_KEY must be set/);
    }
  );
});

test("envOrDefault rejects placeholders embedded in production URLs", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DATABASE_URL: "https://service.example.test/api?key=replace-with-an-api-key"
    },
    () => {
      assert.throws(() => envOrDefault("DATABASE_URL", "https://fallback.example.test"), /development value/);
    }
  );
});

test("envOrDefault rejects placeholders used as query parameter keys", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DATABASE_URL: "https://service.example.test/api?replace-with-an-api-key=value"
    },
    () => {
      assert.throws(() => envOrDefault("DATABASE_URL", "https://fallback.example.test"), /development value/);
    }
  );
});

test("envOrDefault rejects placeholders before later query parameters", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DATABASE_URL: "https://service.example.test/api?key=replace-with-an-api-key&region=us-east-1"
    },
    () => {
      assert.throws(() => envOrDefault("DATABASE_URL", "https://fallback.example.test"), /development value/);
    }
  );
});

test("envOrDefault rejects placeholders after query parameter separators", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DATABASE_URL: "https://service.example.test/api?region=us-east-1&replace-with-an-api-key=value"
    },
    () => {
      assert.throws(() => envOrDefault("DATABASE_URL", "https://fallback.example.test"), /development value/);
    }
  );
});
