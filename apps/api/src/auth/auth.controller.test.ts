import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

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
    const controller = new AuthController(auth as any);
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
    const controller = new AuthController(auth as any);

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
  const controller = new AuthController(auth as any);

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
  const controller = new AuthController(auth as any);

  const loggedIn = await controller.mobileLogin({ email: "a@example.com", password: "password" });

  assert.deepEqual(loggedIn, { user: { id: "user-1", email: "a@example.com", username: "a" }, token: "jwt-token" });
});

test("mobile external callback redirects bearer token in URL fragment", async () => {
  const auth = {
    loginWithExternalProvider: async () => ({ id: "user-1", email: "a@example.com", username: "a" }),
    sign: () => "jwt-token"
  };
  const redirects: string[] = [];
  const response = {
    req: {
      cookies: {
        geostats_oauth_state: "state",
        geostats_oauth_code_verifier: "verifier",
        geostats_mobile_redirect_uri: "geostats://auth"
      }
    },
    clearCookie: () => {},
    cookie: () => {},
    redirect: (url: string) => {
      redirects.push(url);
    }
  };
  const controller = new AuthController(auth as any);

  await controller.externalCallback("code", "state", response as any);

  assert.deepEqual(redirects, ["geostats://auth#token=jwt-token"]);
});

test("development mobile redirect validation accepts app and Expo auth URLs", () => {
  withEnv({ MOBILE_AUTH_REDIRECT_URI: undefined, NODE_ENV: "development" }, () => {
    const controller = new AuthController({} as any);

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
    const controller = new AuthController({} as any);

    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth"), false);
    assert.equal((controller as any).isAllowedMobileRedirectUri("exp://10.11.18.75:8081/--/auth"), false);
  });
  withEnv({ MOBILE_AUTH_REDIRECT_URI: "geostats://auth", NODE_ENV: "production" }, () => {
    const controller = new AuthController({} as any);

    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth"), true);
    assert.equal((controller as any).isAllowedMobileRedirectUri("geostats://auth/"), false);
  });
});
