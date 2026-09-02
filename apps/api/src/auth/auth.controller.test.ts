import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

function testController(auth: any) {
  return new AuthController(auth);
}

test("auth config reports Clerk by default", () => {
  const controller = testController({
    authMode: () => "clerk"
  });

  assert.deepEqual(controller.config(), { mode: "clerk", providerName: "Clerk" });
});

test("auth config exposes the Clerk publishable key without the secret", () => {
  const previousPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const previousPublicWebKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const previousSecretKey = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_mobile";
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_secret";
  try {
    const controller = testController({ authMode: () => "clerk" });

    assert.deepEqual(controller.config(), {
      mode: "clerk",
      providerName: "Clerk",
      clerkPublishableKey: "pk_test_mobile"
    });
  } finally {
    if (previousPublishableKey === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
    else process.env.CLERK_PUBLISHABLE_KEY = previousPublishableKey;
    if (previousPublicWebKey === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = previousPublicWebKey;
    if (previousSecretKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousSecretKey;
  }
});

test("logout clears the local browser session cookie", () => {
  let clearedCookie: string | null = null;
  const controller = testController({});

  const result = controller.logout({
    clearCookie: (name: string) => {
      clearedCookie = name;
    }
  } as any);

  assert.deepEqual(result, { ok: true });
  assert.equal(clearedCookie, "geostats_session");
});

test("browser login and register do not expose bearer tokens in response bodies", async () => {
  const auth = {
    register: async () => ({ id: "user-1", email: "a@example.com", username: "a" }),
    login: async () => ({ id: "user-1", email: "a@example.com", username: "a" }),
    sign: () => "jwt-token"
  };
  const cookies: Array<{ name: string; value: string }> = [];
  const response = {
    cookie: (name: string, value: string) => {
      cookies.push({ name, value });
    }
  };
  const controller = testController(auth);

  const registered = await controller.register({ email: "a@example.com", username: "a", password: "password" }, response as any);
  const loggedIn = await controller.login({ email: "a@example.com", password: "password" }, response as any);

  assert.deepEqual(registered, { user: { id: "user-1", email: "a@example.com", username: "a" } });
  assert.deepEqual(loggedIn, { user: { id: "user-1", email: "a@example.com", username: "a" } });
  assert.deepEqual(cookies, [
    { name: "geostats_session", value: "jwt-token" },
    { name: "geostats_session", value: "jwt-token" }
  ]);
});

test("browser Clerk exchange sets an HttpOnly session without returning a bearer token", async () => {
  let receivedToken = "";
  const auth = {
    loginWithClerkToken: async (token: string) => {
      receivedToken = token;
      return { id: "user-1", email: "a@example.com", username: "a" };
    },
    sign: () => "jwt-token"
  };
  const cookies: Array<{ name: string; value: string }> = [];
  const response = {
    cookie: (name: string, value: string) => {
      cookies.push({ name, value });
    }
  };
  const controller = testController(auth);

  const result = await controller.clerkExchange(
    { headers: { authorization: "Bearer clerk-session-token" } } as any,
    response as any
  );

  assert.equal(receivedToken, "clerk-session-token");
  assert.deepEqual(result, { user: { id: "user-1", email: "a@example.com", username: "a" } });
  assert.deepEqual(cookies, [{ name: "geostats_session", value: "jwt-token" }]);
});

test("Clerk exchange requires a bearer token", async () => {
  const controller = testController({ loginWithClerkToken: async () => { throw new Error("should not run"); } });

  await assert.rejects(
    () => controller.clerkExchange({ headers: {} } as any, { cookie: () => {} } as any),
    UnauthorizedException
  );
});

test("mobile Clerk exchange returns the local bearer token", async () => {
  const auth = {
    loginWithClerkToken: async (token: string) => {
      assert.equal(token, "clerk-session-token");
      return { id: "user-1", email: "a@example.com", username: "a" };
    },
    sign: () => "jwt-token"
  };
  const controller = testController(auth);

  const result = await controller.mobileClerk({
    headers: { authorization: "Bearer clerk-session-token" }
  } as any);

  assert.deepEqual(result, {
    user: { id: "user-1", email: "a@example.com", username: "a" },
    token: "jwt-token"
  });
});

test("development browser login redirects only to web app paths", async () => {
  const previous = process.env.WEB_ORIGIN;
  process.env.WEB_ORIGIN = "http://localhost:3000";
  try {
    const auth = {
      devUser: async () => ({ id: "user-1", email: "dev@example.com", username: "dev" }),
      sign: () => "jwt-token"
    };
    const cookies: Array<{ name: string; value: string }> = [];
    const redirects: string[] = [];
    const response = {
      cookie: (name: string, value: string) => {
        cookies.push({ name, value });
      },
      redirect: (url: string) => {
        redirects.push(url);
      }
    };
    const controller = testController(auth);

    await controller.dev("/scratch?country=SE", response as any);
    await controller.dev("https://example.com/steal", response as any);
    await controller.dev("//evil.com/steal", response as any);

    assert.deepEqual(cookies, [
      { name: "geostats_session", value: "jwt-token" },
      { name: "geostats_session", value: "jwt-token" },
      { name: "geostats_session", value: "jwt-token" }
    ]);
    assert.deepEqual(redirects, [
      "http://localhost:3000/scratch?country=SE",
      "http://localhost:3000/dashboard",
      "http://localhost:3000/dashboard"
    ]);
  } finally {
    if (previous === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previous;
  }
});
