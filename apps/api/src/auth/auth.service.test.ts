import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> | T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function authServiceWithUsers() {
  const users: Array<{ id: string; email: string; username: string; passwordHash: string | null }> = [];
  const prisma = {
    user: {
      findFirst: async ({ where }: any) =>
        users.find((user) =>
          where.OR.some((condition: { email?: string; username?: string }) =>
            condition.email ? user.email === condition.email : user.username === condition.username
          )
        ) ?? null,
      findUnique: async ({ where }: any) =>
        users.find((user) =>
          where.email ? user.email === where.email : where.username ? user.username === where.username : user.id === where.id
        ) ?? null,
      create: async ({ data }: any) => {
        const user = {
          id: `user-${users.length + 1}`,
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash ?? null
        };
        users.push(user);
        return user;
      }
    }
  };
  return { service: new AuthService(prisma as any, {} as any), users };
}

test("password auth is the default mode", () => {
  withEnv({ AUTH_MODE: undefined }, () => {
    const { service } = authServiceWithUsers();
    assert.equal(service.authMode(), "password");
  });
});

test("register stores a password hash and login verifies it", async () => {
  await withEnv({ AUTH_MODE: undefined }, async () => {
    const { service, users } = authServiceWithUsers();

    const created = await service.register("User@Example.com", "user", "correct-password");
    assert.deepEqual(created, { id: "user-1", email: "user@example.com", username: "user" });
    assert.notEqual(users[0].passwordHash, "correct-password");
    assert.match(users[0].passwordHash ?? "", /^scrypt\$/);

    await assert.rejects(() => service.login("user@example.com", "wrong-password"), UnauthorizedException);
    const loggedIn = await service.login("USER@example.com", "correct-password");
    assert.deepEqual(loggedIn, created);
  });
});

test("register rejects invalid emails and usernames", async () => {
  await withEnv({ AUTH_MODE: undefined }, async () => {
    const { service } = authServiceWithUsers();

    await assert.rejects(() => service.register("notanemail", "user", "correct-password"), {
      message: "A valid email address (max 254 characters) is required"
    });
    await assert.rejects(() => service.register("user@example.com", "ab", "correct-password"), {
      message: "Username must be between 3 and 40 characters"
    });
    await assert.rejects(() => service.register("user@example.com", "a".repeat(41), "correct-password"), {
      message: "Username must be between 3 and 40 characters"
    });
    await assert.rejects(() => service.register("user@example.com", "user", "short"), {
      message: "Password must be at least 8 characters"
    });
  });
});

test("login verifies legacy bcrypt password hashes", async () => {
  await withEnv({ AUTH_MODE: undefined }, async () => {
    const { service, users } = authServiceWithUsers();
    users.push({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      passwordHash: await bcrypt.hash("correct-password", 10)
    });

    await assert.rejects(() => service.login("user@example.com", "wrong-password"), UnauthorizedException);
    const loggedIn = await service.login("user@example.com", "correct-password");
    assert.deepEqual(loggedIn, { id: "user-1", email: "user@example.com", username: "user" });
  });
});

test("external auth requires email_verified to be true when configured", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL: "true",
      EXTERNAL_AUTH_PROVIDER_ID: "external",
      EXTERNAL_AUTH_CLIENT_ID: "client",
      EXTERNAL_AUTH_TOKEN_URL: "https://auth.example/token",
      EXTERNAL_AUTH_USERINFO_URL: "https://auth.example/userinfo"
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string) => {
        if (url === "https://auth.example/token") {
          return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
        }
        return new Response(JSON.stringify({ sub: "external-user-1", email: "user@example.com" }), { status: 200 });
      }) as typeof fetch;
      try {
        const { service } = authServiceWithUsers();

        await assert.rejects(() => service.loginWithExternalProvider("code", "verifier"), {
          message: "External auth account email must be verified"
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("login rejects malformed scrypt hashes without throwing", async () => {
  await withEnv({ AUTH_MODE: undefined }, async () => {
    const { service, users } = authServiceWithUsers();
    users.push({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      passwordHash: "scrypt$NaN$8$1$salt$key"
    });

    await assert.rejects(() => service.login("user@example.com", "correct-password"), UnauthorizedException);
  });
});

test("external auth mode disables password registration", async () => {
  await withEnv({ AUTH_MODE: "external" }, async () => {
    const { service } = authServiceWithUsers();
    await assert.rejects(() => service.register("user@example.com", "user", "correct-password"), ServiceUnavailableException);
  });
});

test("upsertOAuthUser recovers when concurrent account linking wins the race", async () => {
  const user = { id: "user-1", email: "user@example.com", username: "user", passwordHash: null };
  let accountLookupCount = 0;
  const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test"
  });
  const prisma = {
    user: {
      findUnique: async ({ where }: any) => (where.email === user.email ? user : null)
    },
    oAuthAccount: {
      findUnique: async () => {
        accountLookupCount += 1;
        return accountLookupCount === 1 ? null : { id: "oauth-1", user };
      },
      create: async () => {
        throw uniqueConstraintError;
      }
    }
  };
  const service = new AuthService(prisma as any, {} as any);

  const result = await (service as any).upsertOAuthUser({
    provider: "external",
    providerAccountId: "provider-user-1",
    providerUsername: "provider-user",
    email: user.email,
    username: user.username
  });

  assert.equal(result, user);
  assert.equal(accountLookupCount, 2);
});

test("upsertOAuthUser skips account update when provider username is unchanged", async () => {
  const user = { id: "user-1", email: "user@example.com", username: "user", passwordHash: null };
  let updateCount = 0;
  const prisma = {
    oAuthAccount: {
      findUnique: async () => ({ id: "oauth-1", providerUsername: "provider-user", user }),
      update: async () => {
        updateCount += 1;
      }
    }
  };
  const service = new AuthService(prisma as any, {} as any);

  const result = await (service as any).upsertOAuthUser({
    provider: "external",
    providerAccountId: "provider-user-1",
    providerUsername: "provider-user",
    email: user.email,
    username: user.username
  });

  assert.equal(result, user);
  assert.equal(updateCount, 0);
});
