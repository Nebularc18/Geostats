import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
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
  const collectorTokenOwners = new Set<string>();
  const migrationBudget = { reservations: 0, available: true };
  const prisma = {
    $executeRaw: async () => {
      migrationBudget.reservations += 1;
      return migrationBudget.available ? 1 : 0;
    },
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
      updateMany: async ({ where, data }: any) => {
        const user = users.find((candidate) => candidate.id === where.id && candidate.passwordHash === where.passwordHash);
        if (user) user.passwordHash = data.passwordHash;
        return { count: user ? 1 : 0 };
      },
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
    },
    collectorToken: {
      deleteMany: async ({ where }: any) => { collectorTokenOwners.delete(where.userId); }
    },
    authSession: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (run: (tx: any) => Promise<unknown>) => run(prisma)
  };
  return { service: new AuthService(prisma as any, {} as any), users, oauthAccounts, collectorTokenOwners, migrationBudget };
}

test("password auth is the default mode", () => {
  withEnv({ AUTH_MODE: undefined }, () => {
    const { service } = authServiceWithUsers();
    assert.equal(service.authMode(), "password");
  });
});

test("Clerk admin access follows the immutable user-ID allowlist", () => {
  withEnv(
    {
      AUTH_MODE: "clerk",
      NODE_ENV: "development",
      ADMIN_USER_IDS: "user-1",
      ADMIN_EMAILS: " Owner@Example.com,second@example.com "
    },
    () => {
      const { service } = authServiceWithUsers();
      assert.equal(service.isAdmin({ id: "user-1", email: "owner@example.com" }), true);
      assert.equal(service.isAdmin({ id: "user-2", email: "other@example.com" }), false);
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
      assert.equal(service.isAdmin({ id: "user-1", email: "dev-admin@example.com" }), true);
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
      assert.equal(service.isAdmin({ id: "user-1", email: "dev-admin@example.com" }), false);
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
        primaryEmailAddress: { emailAddress: "User@Example.com", verification: { status: "verified" } }
      });

      const user = await service.loginWithClerkToken("clerk-session");

      assert.deepEqual(verificationArgs, [
        "clerk-session",
        "sk_test_secret",
        undefined,
        ["http://localhost:3000"],
        "web"
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

test("Clerk mode disables password registration and login", async () => {
  await withEnv({ AUTH_MODE: "clerk" }, async () => {
    const { service, users } = authServiceWithUsers();
    users.push({ id: "user-1", email: "user@example.com", username: "user", passwordHash: "unused" });
    await assert.rejects(() => service.register("other@example.com", "other", "correct-password"), {
      message: "Password auth is disabled"
    });
    await assert.rejects(() => service.login("user@example.com", "correct-password"), {
      message: "Password auth is disabled"
    });
  });
});

test("Clerk token exchange refuses to link an unverified primary email", async () => {
  await withEnv({ AUTH_MODE: "clerk", CLERK_SECRET_KEY: "sk_test_secret" }, async () => {
    const { service, users, oauthAccounts } = authServiceWithUsers();
    users.push({ id: "user-1", email: "admin@example.com", username: "admin", passwordHash: null });
    (service as any).verifyClerkSessionToken = async () => ({ sub: "clerk-attacker" });
    (service as any).getClerkUser = async () => ({
      id: "clerk-attacker",
      username: "attacker",
      firstName: null,
      primaryEmailAddress: { emailAddress: "admin@example.com", verification: { status: "unverified" } }
    });

    await assert.rejects(() => service.loginWithClerkToken("clerk-session"), {
      message: "Clerk primary email address must be verified"
    });
    assert.deepEqual(oauthAccounts, []);
  });
});

for (const password of ["", "legacy", "legacy-passphrase-".repeat(8)]) {
  test(`Clerk migration verifies a ${password.length}-character legacy password and retires credentials`, async () => {
    await withEnv({ AUTH_MODE: "clerk", CLERK_SECRET_KEY: "sk_test_secret" }, async () => {
      const { service, users, oauthAccounts, collectorTokenOwners } = authServiceWithUsers();
      const hash = await bcrypt.hash(password, 4);
      users.push({ id: "user-1", email: "user@example.com", username: "user", passwordHash: hash });
      collectorTokenOwners.add("user-1");
      collectorTokenOwners.add("unrelated");
      (service as any).verifyClerkSessionToken = async () => ({ sub: "clerk-user-1" });
      (service as any).getClerkUser = async () => ({
        id: "clerk-user-1",
        username: "clerk-user",
        firstName: null,
        primaryEmailAddress: { emailAddress: "User@Example.com", verification: { status: "verified" } }
      });

      await assert.rejects(() => service.loginWithClerkToken("clerk-session"), { status: 409 });
      await assert.rejects(() => service.loginWithClerkToken("clerk-session", "web", "wrong-test-password"), { status: 401 });
      assert.equal(oauthAccounts.length, 0);
      assert.equal(users[0]?.passwordHash, hash);
      assert.deepEqual(await service.loginWithClerkToken("clerk-session", "web", password), {
        id: "user-1",
        email: "user@example.com",
        username: "user"
      });
      assert.equal(oauthAccounts[0]?.userId, "user-1");
      assert.equal(oauthAccounts[0]?.providerAccountId, "clerk-user-1");
      assert.equal(users[0]?.passwordHash, null);
      assert.deepEqual([...collectorTokenOwners], ["unrelated"]);
      assert.equal((await service.loginWithClerkToken("clerk-session")).id, "user-1");
    });
  });
}

test("Clerk migration checks the shared account budget before verifying a password", async () => {
  await withEnv({ AUTH_MODE: "clerk", CLERK_SECRET_KEY: "sk_test_secret" }, async () => {
    const { service, users, migrationBudget } = authServiceWithUsers();
    users.push({ id: "user-1", email: "user@example.com", username: "user", passwordHash: "stored-hash" });
    (service as any).verifyClerkSessionToken = async () => ({ sub: "clerk-user-1" });
    (service as any).getClerkUser = async () => ({
      id: "clerk-user-1",
      primaryEmailAddress: { emailAddress: "user@example.com", verification: { status: "verified" } }
    });
    (service as any).verifyPassword = async () => { assert.fail("A locked account must not verify a password"); };
    migrationBudget.available = false;

    await assert.rejects(() => service.loginWithClerkToken("clerk-session"), { status: 409 });
    assert.equal(migrationBudget.reservations, 0);
    for (const source of ["web", "native"] as const) {
      await assert.rejects(() => service.loginWithClerkToken("clerk-session", source, "fixture-password"), { status: 429 });
    }
    assert.equal(migrationBudget.reservations, 2);
  });
});

test("Clerk token exchange preserves an existing provider-id link without a verified email", async () => {
  await withEnv({ AUTH_MODE: "clerk", CLERK_SECRET_KEY: "sk_test_secret" }, async () => {
    const { service, users, oauthAccounts } = authServiceWithUsers();
    users.push({ id: "user-1", email: "user@example.com", username: "user", passwordHash: null });
    oauthAccounts.push({ id: "oauth-1", userId: "user-1", provider: "clerk", providerAccountId: "clerk-user-1", providerUsername: "user" });
    (service as any).verifyClerkSessionToken = async () => ({ sub: "clerk-user-1" });
    (service as any).getClerkUser = async () => ({
      id: "clerk-user-1",
      username: "user",
      firstName: null,
      primaryEmailAddress: null
    });

    assert.deepEqual(await service.loginWithClerkToken("clerk-session"), {
      id: "user-1",
      email: "user@example.com",
      username: "user"
    });
  });
});

test("upsertOAuthUser preserves a provider link created during a concurrent request", async () => {
  const user = { id: "user-1", email: "user@example.com", username: "user", passwordHash: null };
  let accountLookupCount = 0;
  const prisma = {
    user: {
      findUnique: async ({ where }: any) => (where.email === user.email ? user : null)
    },
    oAuthAccount: {
      findUnique: async () => {
        accountLookupCount += 1;
        return accountLookupCount === 1 ? null : { id: "oauth-1", user };
      }
    }
  };
  const service = new AuthService(prisma as any, {} as any);

  const result = await (service as any).upsertOAuthUser({
    provider: "clerk",
    providerAccountId: "provider-user-1",
    providerUsername: "provider-user",
    email: user.email,
    emailVerified: true,
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


test("registering an administrator email never grants password-mode admin access", async () => {
  await withEnv({ AUTH_MODE: "password", NODE_ENV: "production", ADMIN_EMAILS: "owner@example.com", ADMIN_USER_IDS: "trusted-existing-id" }, async () => {
    const { service } = authServiceWithUsers();
    const attacker = await service.register("owner@example.com", "attacker", "correct-horse-battery");
    assert.equal(service.isAdmin(attacker), false);
    assert.equal(service.isAdmin({ id: "trusted-existing-id", email: "different@example.com" }), true);
    assert.equal(service.isAdmin({ id: "TRUSTED-EXISTING-ID", email: "owner@example.com" }), false);
  });
});

test("password mode does not inherit the development administrator email", () => {
  withEnv({ AUTH_MODE: "password", NODE_ENV: "development", ADMIN_EMAILS: "dev-admin@example.com", ADMIN_USER_IDS: undefined, DEV_AUTH_EMAIL: "dev-admin@example.com" }, () => {
    const { service } = authServiceWithUsers();
    assert.equal(service.isAdmin({ id: "self-registered", email: "dev-admin@example.com" }), false);
  });
});


test("older and password-mode JWTs are rejected after switching to Clerk", async () => {
  await withEnv({ AUTH_MODE: "password", NODE_ENV: "production", ADMIN_EMAILS: "owner@example.com", ADMIN_USER_IDS: undefined }, async () => {
    const user = { id: "attacker", email: "owner@example.com", username: "attacker" };
    let payload: any;
    const service = new AuthService({ authSession: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => undefined,
      findFirst: async () => ({ user })
    } } as any, {
      sign: (value: unknown) => { payload = value; return "signed"; },
      verifyAsync: async () => payload,
    } as any);
    await service.sign(user);
    assert.deepEqual(await service.verify("signed"), user);
    process.env.AUTH_MODE = "clerk";
    await assert.rejects(() => service.verify("signed"), UnauthorizedException);
    delete payload.authMode;
    await assert.rejects(() => service.verify("signed"), UnauthorizedException);
    await service.sign(user);
    assert.deepEqual(await service.verify("signed"), user);
  });
});

test("revoking a session leaves the account's other session active", async () => {
  const user = { id: "user-1", username: "example", email: "example@example.test" };
  const sessions = new Map<string, Date>();
  const claims = new Map<string, { jti: string; sub: string; authMode: string }>();
  const service = new AuthService({ authSession: {
    create: async ({ data }: any) => { sessions.set(data.id, data.expiresAt); },
    deleteMany: async ({ where }: any) => { if (where.id) sessions.delete(where.id); },
    findFirst: async ({ where }: any) => where.userId === user.id && sessions.has(where.id) ? { user } : null
  } } as any, {
    sign: (value: { jti: string; sub: string; authMode: string }) => { claims.set(value.jti, value); return value.jti; },
    verifyAsync: async (key: string) => claims.get(key)
  } as any);
  const first = await service.sign(user);
  const second = await service.sign(user);
  assert.deepEqual(await service.verify(first), user);
  await service.revoke(first);
  await service.revoke(first);
  await assert.rejects(() => service.verify(first), UnauthorizedException);
  assert.deepEqual(await service.verify(second), user);
});


// Exercise the real Clerk verifier with locally signed tokens, without network calls.
const clerkTestKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const clerkTestPublicKey = clerkTestKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
function signedClerkToken(overrides: Record<string, unknown> = {}, key = clerkTestKeys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://test.clerk.accounts.dev", sub: "clerk-user", sid: "sess_test",
    iat: now, nbf: now - 1, exp: now + 60, ...overrides
  })).toString("base64url");
  const data = `${header}.${payload}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}
function verifyTestClerkToken(token: string, source: "web" | "native") {
  const { service } = authServiceWithUsers();
  return (service as any).verifyClerkSessionToken(token, "", clerkTestPublicKey, ["https://geostats.example.com"], source);
}

test("mobile Clerk exchange accepts a verified token without a browser origin", async () => {
  const verified = await verifyTestClerkToken(signedClerkToken(), "native");
  assert.equal(verified.sub, "clerk-user");
});

test("browser Clerk exchange still requires a trusted origin", async () => {
  await assert.rejects(() => verifyTestClerkToken(signedClerkToken(), "web"), UnauthorizedException);
  assert.equal((await verifyTestClerkToken(signedClerkToken({ azp: "https://geostats.example.com" }), "web")).sub, "clerk-user");
});

test("mobile Clerk exchange rejects an untrusted origin when one is present", async () => {
  for (const azp of ["https://attacker.example", "", null]) {
    await assert.rejects(() => verifyTestClerkToken(signedClerkToken({ azp }), "native"), UnauthorizedException);
  }
  assert.equal((await verifyTestClerkToken(signedClerkToken({ azp: "https://geostats.example.com" }), "native")).sub, "clerk-user");
});

test("mobile Clerk exchange still rejects expired and incorrectly signed tokens", async () => {
  await assert.rejects(() => verifyTestClerkToken(signedClerkToken({ exp: Math.floor(Date.now() / 1000) - 120 }), "native"), UnauthorizedException);
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(() => verifyTestClerkToken(signedClerkToken({}, otherKey), "native"), UnauthorizedException);
});

test("scheduled session cleanup covers expired sessions across all accounts", async () => {
  const queries: Array<{ where: { expiresAt: { lte: Date } } }> = [];
  const service = new AuthService({ authSession: {
    deleteMany: async (query: typeof queries[number]) => { queries.push(query); }
  } } as any, {} as any);
  try {
    service.onModuleInit();
    assert.deepEqual(queries, [{ where: { expiresAt: { lte: queries[0]?.where.expiresAt.lte } } }]);
    assert.ok(queries[0].where.expiresAt.lte instanceof Date);
  } finally {
    service.onModuleDestroy();
  }
});
