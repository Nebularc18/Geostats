import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
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
  const oauthAccounts: Array<{
    id: string;
    userId: string;
    provider: string;
    providerAccountId: string;
    providerUsername: string | null;
  }> = [];
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
      findMany: async ({ where, take }: any) =>
        users
          .filter(
            (user) =>
              user.id !== where.id.not &&
              user.username.toLowerCase().includes(where.username.contains.toLowerCase())
          )
          .sort((left, right) => left.username.localeCompare(right.username))
          .slice(0, take)
          .map(({ id, username }) => ({ id, username })),
      create: async ({ data }: any) => {
        const user = {
          id: `user-${users.length + 1}`,
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash ?? null
        };
        users.push(user);
        if (data.oauthAccounts?.create) {
          const account = data.oauthAccounts.create;
          oauthAccounts.push({
            id: `oauth-${oauthAccounts.length + 1}`,
            userId: user.id,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            providerUsername: account.providerUsername ?? null
          });
        }
        return user;
      }
    },
    oAuthAccount: {
      findUnique: async ({ where, include }: any) => {
        const key = where.provider_providerAccountId;
        const account = oauthAccounts.find(
          (candidate) => candidate.provider === key.provider && candidate.providerAccountId === key.providerAccountId
        );
        if (!account) {
          return null;
        }
        const user = users.find((candidate) => candidate.id === account.userId);
        return include?.user ? { ...account, user } : account;
      },
      create: async ({ data }: any) => {
        const account = {
          id: `oauth-${oauthAccounts.length + 1}`,
          userId: data.userId,
          provider: data.provider,
          providerAccountId: data.providerAccountId,
          providerUsername: data.providerUsername ?? null
        };
        oauthAccounts.push(account);
        return account;
      },
      update: async ({ where, data }: any) => {
        const account = oauthAccounts.find((candidate) => candidate.id === where.id);
        if (account) {
          account.providerUsername = data.providerUsername ?? null;
        }
        return account;
      }
    }
  };
  return { service: new AuthService(prisma as any, {} as any), users, oauthAccounts };
}

test("password auth is the default mode", () => {
  withEnv({ AUTH_MODE: undefined }, () => {
    const { service } = authServiceWithUsers();
    assert.equal(service.authMode(), "password");
  });
});

test("admin access follows the configured email allowlist", () => {
  withEnv(
    {
      AUTH_MODE: "password",
      NODE_ENV: "development",
      ADMIN_EMAILS: " Owner@Example.com,second@example.com "
    },
    () => {
      const { service } = authServiceWithUsers();
      assert.equal(service.isAdmin({ email: "owner@example.com" }), true);
      assert.equal(service.isAdmin({ email: "other@example.com" }), false);
    }
  );
});

test("the local development account is an admin only in development mode", () => {
  withEnv(
    {
      AUTH_MODE: "dev",
      NODE_ENV: "development",
      ADMIN_EMAILS: undefined,
      DEV_AUTH_EMAIL: "dev-admin@example.com"
    },
    () => {
      const { service } = authServiceWithUsers();
      assert.equal(service.isAdmin({ email: "dev-admin@example.com" }), true);
    }
  );

  withEnv(
    {
      AUTH_MODE: "dev",
      NODE_ENV: "production",
      ADMIN_EMAILS: undefined,
      DEV_AUTH_EMAIL: "dev-admin@example.com"
    },
    () => {
      const { service } = authServiceWithUsers();
      assert.equal(service.isAdmin({ email: "dev-admin@example.com" }), false);
    }
  );
});

test("user search returns registered usernames without the current user or email addresses", async () => {
  const { service, users } = authServiceWithUsers();
  users.push(
    { id: "user-1", email: "owner@example.com", username: "CacheOwner", passwordHash: null },
    { id: "user-2", email: "alex@example.com", username: "AlexCache", passwordHash: null },
    { id: "user-3", email: "maja@example.com", username: "Maja", passwordHash: null }
  );

  assert.deepEqual(await service.searchUsers("a", "user-1"), []);
  assert.deepEqual(await service.searchUsers("CA", "user-1"), [
    { id: "user-2", username: "AlexCache" }
  ]);
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
      message: "Password must be between 8 and 128 characters"
    });
    await assert.rejects(() => service.register("user@example.com", "user", "a".repeat(129)), {
      message: "Password must be between 8 and 128 characters"
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

test("Clerk is the production default", () => {
  withEnv(
    {
      AUTH_MODE: undefined,
      NODE_ENV: "production"
    },
    () => {
      const { service } = authServiceWithUsers();
      assert.equal(service.authMode(), "clerk");
    }
  );
});

test("development auth is never selected in production", () => {
  withEnv({ AUTH_MODE: "dev", NODE_ENV: "production" }, () => {
    const { service } = authServiceWithUsers();
    assert.equal(service.authMode(), "clerk");
  });
});

test("Clerk token exchange verifies the session and links the local account", async () => {
  await withEnv(
    {
      AUTH_MODE: "clerk",
      NODE_ENV: "development",
      CLERK_SECRET_KEY: "sk_test_secret",
      CLERK_JWT_KEY: undefined,
      CLERK_AUTHORIZED_PARTIES: "http://localhost:3000"
    },
    async () => {
      const { service, users, oauthAccounts } = authServiceWithUsers();
      let verificationArgs: unknown[] = [];
      (service as any).verifyClerkSessionToken = async (...args: unknown[]) => {
        verificationArgs = args;
        return { sub: "clerk-user-1" };
      };
      (service as any).getClerkUser = async () => ({
        id: "clerk-user-1",
        username: "geo-user",
        firstName: "Geo",
        primaryEmailAddress: { emailAddress: "User@Example.com" }
      });

      const user = await service.loginWithClerkToken("clerk-session");

      assert.deepEqual(verificationArgs, [
        "clerk-session",
        "sk_test_secret",
        undefined,
        ["http://localhost:3000"]
      ]);
      assert.deepEqual(user, { id: "user-1", email: "user@example.com", username: "geo-user" });
      assert.deepEqual(users, [
        { id: "user-1", email: "user@example.com", username: "geo-user", passwordHash: null }
      ]);
      assert.deepEqual(oauthAccounts, [
        {
          id: "oauth-1",
          userId: "user-1",
          provider: "clerk",
          providerAccountId: "clerk-user-1",
          providerUsername: "geo-user"
        }
      ]);
    }
  );
});

test("Clerk token exchange rejects invalid sessions", async () => {
  await withEnv(
    {
      AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "sk_test_secret"
    },
    async () => {
      const { service } = authServiceWithUsers();
      (service as any).verifyClerkSessionToken = async () => {
        throw new UnauthorizedException("Invalid Clerk session token");
      };

      await assert.rejects(() => service.loginWithClerkToken("invalid-token"), {
        message: "Invalid Clerk session token"
      });
    }
  );
});

test("Clerk token exchange requires server credentials", async () => {
  await withEnv({ AUTH_MODE: "clerk", CLERK_SECRET_KEY: undefined }, async () => {
    const { service } = authServiceWithUsers();

    await assert.rejects(() => service.loginWithClerkToken("clerk-session"), {
      message: "Clerk auth is not configured"
    });
  });
});

test("Clerk mode keeps password registration as a staged-migration alternative", async () => {
  await withEnv({ AUTH_MODE: "clerk" }, async () => {
    const { service } = authServiceWithUsers();
    const user = await service.register("user@example.com", "user", "correct-password");
    assert.equal(user.email, "user@example.com");
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
    provider: "clerk",
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
    provider: "clerk",
    providerAccountId: "provider-user-1",
    providerUsername: "provider-user",
    email: user.email,
    username: user.username
  });

  assert.equal(result, user);
  assert.equal(updateCount, 0);
});
