import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
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

test("external auth mode disables password registration", async () => {
  await withEnv({ AUTH_MODE: "external" }, async () => {
    const { service } = authServiceWithUsers();
    await assert.rejects(() => service.register("user@example.com", "user", "correct-password"), ServiceUnavailableException);
  });
});
