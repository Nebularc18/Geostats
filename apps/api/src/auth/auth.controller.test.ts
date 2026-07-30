import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

class TestMobileExchangeCodeService {
  private nextCode = 0;
  private readonly records = new Map<string, { codeChallenge: string; serialized: string; token: string; user: any }>();

  async create(token: string, user: any, codeChallenge: string) {
    const code = `mobile-code-${this.nextCode += 1}`;
    const serialized = JSON.stringify({ codeChallenge, token, user });
    this.records.set(code, { codeChallenge, serialized, token, user });
    return code;
  }

  async get(code: string) {
    return this.records.get(code) ?? null;
  }

  async consume(code: string, serialized: string) {
    const record = this.records.get(code);
    if (!record || record.serialized !== serialized) {
      return false;
    }
    this.records.delete(code);
    return true;
  }
}

function testController(auth: any, mobileCodes = new TestMobileExchangeCodeService()) {
  return new AuthController(auth, mobileCodes as any);
}

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

test("external callback redirects to login when provider login fails", async () => {
  await withEnv({ WEB_ORIGIN: "http://localhost:3000" }, async () => {
    const auth = {
      loginWithExternalProvider: async () => {
        throw new UnauthorizedException("External OAuth token exchange failed");
      }
    };
    const redirects: string[] = [];
    const clearedCookies: string[] = [];
    let loggedError = false;
    const response = {
      req: {
        cookies: {
          geostats_oauth_state: "state",
          geostats_oauth_code_verifier: "verifier"
        }
      },
      clearCookie: (name: string) => {
        clearedCookies.push(name);
      },
      cookie: () => {
        throw new Error("session cookie should not be set");
      },
      redirect: (url: string) => {
        redirects.push(url);
      }
    };
    const controller = testController(auth);
    (controller as any).logger = {
      error: () => {
        loggedError = true;
      }
    };

    await controller.externalCallback("code", "state", response as any);

    assert.deepEqual(clearedCookies, ["geostats_oauth_state", "geostats_oauth_code_verifier"]);
    assert.deepEqual(redirects, ["http://localhost:3000/login?authError=external"]);
    assert.equal(loggedError, true);
  });
});

test("external callback redirects to login with auth error when code or state is invalid", async () => {
  await withEnv({ WEB_ORIGIN: "http://localhost:3000" }, async () => {
    const auth = {
      loginWithExternalProvider: async () => {
        throw new Error("login should not be attempted");
      }
    };
    const redirects: string[] = [];
    const response = {
      req: {
        cookies: {
          geostats_oauth_state: "state",
          geostats_oauth_code_verifier: "verifier"
        }
      },
      clearCookie: () => {},
      redirect: (url: string) => {
        redirects.push(url);
      }
    };
    const controller = testController(auth);

    await controller.externalCallback(undefined, "state", response as any);

    assert.deepEqual(redirects, ["http://localhost:3000/login?authError=external"]);
  });
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

test("mobile login returns a bearer token through the mobile endpoint only", async () => {
  const auth = {
    login: async () => ({ id: "user-1", email: "a@example.com", username: "a" }),
    sign: () => "jwt-token"
  };
  const controller = testController(auth);

  const loggedIn = await controller.mobileLogin({ email: "a@example.com", password: "password" });

  assert.deepEqual(loggedIn, { user: { id: "user-1", email: "a@example.com", username: "a" }, token: "jwt-token" });
});

test("development browser login redirects only to web app paths", async () => {
  await withEnv({ WEB_ORIGIN: "http://localhost:3000" }, async () => {
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
  });
});

const mobileCodeVerifier = "A".repeat(43);

test("mobile external callback redirects a verifier-bound one-time code instead of a bearer token", async () => {
  const auth = {
    loginWithExternalProvider: async () => ({ id: "user-1", email: "a@example.com", username: "a" }),
    sign: () => "jwt-token"
  };
  const redirects: string[] = [];
  const clearedCookies: string[] = [];
  const response = {
    req: {
      cookies: {
        geostats_oauth_state: "state",
        geostats_oauth_code_verifier: "verifier",
        geostats_mobile_redirect_uri: "geostats://auth",
        geostats_mobile_code_challenge: mobileCodeVerifier
      }
    },
    clearCookie: (name: string) => {
      clearedCookies.push(name);
    },
    cookie: () => {},
    redirect: (url: string) => {
      redirects.push(url);
    }
  };
  const mobileCodes = new TestMobileExchangeCodeService();
  const callbackController = testController(auth, mobileCodes);

  await callbackController.externalCallback("code", "state", response as any);

  assert.equal(redirects.length, 1);
  const redirectUrl = new URL(redirects[0]);
  const params = new URLSearchParams(redirectUrl.hash.slice(1));
  const exchangeCode = params.get("code");
  assert.equal(redirectUrl.protocol, "geostats:");
  assert.equal(params.has("token"), false);
  assert.match(exchangeCode ?? "", /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(clearedCookies, [
    "geostats_oauth_state",
    "geostats_oauth_code_verifier",
    "geostats_mobile_redirect_uri",
    "geostats_mobile_code_challenge"
  ]);

  const exchangeController = testController(auth, mobileCodes);
  await assert.rejects(
    () => exchangeController.mobileExchange({ code: exchangeCode, codeVerifier: "B".repeat(43) }),
    UnauthorizedException
  );

  assert.deepEqual(await exchangeController.mobileExchange({ code: exchangeCode, codeVerifier: mobileCodeVerifier }), {
    user: { id: "user-1", email: "a@example.com", username: "a" },
    token: "jwt-token"
  });
  await assert.rejects(
    () => exchangeController.mobileExchange({ code: exchangeCode, codeVerifier: mobileCodeVerifier }),
    UnauthorizedException
  );
});

test("mobile external start requires a verifier challenge", () => {
  const controller = testController({ externalAuthorizationUrl: () => "https://auth.example/start" });
  const response = {
    cookie: () => {},
    redirect: () => {}
  };

  assert.throws(
    () => controller.mobileExternal("geostats://auth", undefined, response as any),
    BadRequestException
  );
});

test("development mobile redirect validation accepts app and Expo auth URLs", () => {
  withEnv({ MOBILE_AUTH_REDIRECT_URI: undefined, NODE_ENV: "development" }, () => {
    const controller = testController({});

    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth/"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://10.11.18.75:8081/--/auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://192.168.1.50:8081/--/auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exps://10.11.18.75:8081/--/auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://8.8.8.8:8081/--/auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exps://8.8.8.8:8081/--/auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://example.com:8081/--/auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://10.11.18.75:8081/--/profile"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://anything/auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("https://example.com/auth"), false);
  });
});

test("production mobile redirect validation requires an exact configured URI", () => {
  withEnv({ MOBILE_AUTH_REDIRECT_URI: undefined, NODE_ENV: "production" }, () => {
    const controller = testController({});

    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://10.11.18.75:8081/--/auth"), false);
  });
  withEnv({ MOBILE_AUTH_REDIRECT_URI: "geostats://auth", NODE_ENV: "production" }, () => {
    const controller = testController({});

    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth/"), false);
  });
});
