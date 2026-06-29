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

test("external auth requires email_verified to be true by default", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL: undefined,
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

test("external auth can allow unverified email only when explicitly configured", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL: "false",
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

        const user = await service.loginWithExternalProvider("code", "verifier");

        assert.equal(user.email, "user@example.com");
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

test("shoo external auth builds a Shoo authorize URL with PII consent", () => {
  withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_PROVIDER_ID: "shoo",
      EXTERNAL_AUTH_CALLBACK_URL: "https://api.example.com/auth/external/callback",
      SHOO_BASE_URL: "https://shoo.dev",
      SHOO_REQUEST_PII: "true"
    },
    () => {
      const { service } = authServiceWithUsers();
      const url = new URL(service.externalAuthorizationUrl("state", "challenge"));

      assert.equal(url.origin, "https://shoo.dev");
      assert.equal(url.pathname, "/authorize");
      assert.equal(url.searchParams.get("client_id"), "origin:https://api.example.com");
      assert.equal(url.searchParams.get("redirect_uri"), "https://api.example.com/auth/external/callback");
      assert.equal(url.searchParams.get("state"), "state");
      assert.equal(url.searchParams.get("code_challenge"), "challenge");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("pii"), "true");
    }
  );
});

test("shoo external auth exchanges codes against the Shoo token endpoint", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_PROVIDER_ID: "shoo",
      EXTERNAL_AUTH_CALLBACK_URL: "https://api.example.com/auth/external/callback",
      SHOO_BASE_URL: "https://shoo.dev"
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedBody = "";
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrl = input.toString();
        requestedBody = init?.body?.toString() ?? "";
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 });
      }) as typeof fetch;
      try {
        const { service } = authServiceWithUsers();

        await assert.rejects(() => service.loginWithExternalProvider("code", "verifier"), {
          message: "invalid_grant"
        });

        assert.equal(requestedUrl, "https://shoo.dev/token");
        const body = new URLSearchParams(requestedBody);
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("client_id"), "origin:https://api.example.com");
        assert.equal(body.get("redirect_uri"), "https://api.example.com/auth/external/callback");
        assert.equal(body.get("code"), "code");
        assert.equal(body.get("code_verifier"), "verifier");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("shoo external auth ignores unverified response body pairwise_sub", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_PROVIDER_ID: "shoo",
      EXTERNAL_AUTH_CALLBACK_URL: "https://api.example.com/auth/external/callback",
      SHOO_BASE_URL: "https://shoo.dev"
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ id_token: "verified-token", pairwise_sub: "unverified-body-sub" }), {
          status: 200
        })) as typeof fetch;
      try {
        const { service } = authServiceWithUsers();
        (service as any).importJose = async () => ({
          createRemoteJWKSet: () => "jwks",
          jwtVerify: async () => ({
            payload: {
              email: "user@example.com",
              email_verified: true,
              name: "User"
            }
          })
        });

        await assert.rejects(() => service.loginWithExternalProvider("code", "verifier"), {
          message: "Shoo token missing pairwise_sub"
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("shoo JWKS fetcher is cached across token exchanges", async () => {
  await withEnv(
    {
      AUTH_MODE: "external",
      EXTERNAL_AUTH_PROVIDER_ID: "shoo",
      EXTERNAL_AUTH_CALLBACK_URL: "https://api.example.com/auth/external/callback",
      SHOO_BASE_URL: "https://shoo.dev"
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response(JSON.stringify({ id_token: "verified-token" }), { status: 200 })) as typeof fetch;
      try {
        const { service } = authServiceWithUsers();
        let jwksCreationCount = 0;
        let verifyCount = 0;
        (service as any).importJose = async () => ({
          createRemoteJWKSet: () => {
            jwksCreationCount += 1;
            return "jwks";
          },
          jwtVerify: async () => {
            verifyCount += 1;
            return {
              payload: {
                pairwise_sub: `shoo-user-${verifyCount}`,
                email: "user@example.com",
                email_verified: true,
                name: "User"
              }
            };
          }
        });

        await (service as any).exchangeAndVerifyShooCode("code-1", "verifier-1");
        await (service as any).exchangeAndVerifyShooCode("code-2", "verifier-2");

        assert.equal(jwksCreationCount, 1);
        assert.equal(verifyCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
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
