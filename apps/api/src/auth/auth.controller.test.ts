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

    await controller.externalCallback("code", "state", response as any);

    assert.deepEqual(clearedCookies, ["geostats_oauth_state", "geostats_oauth_code_verifier"]);
    assert.deepEqual(redirects, ["http://localhost:3000/login?authError=external"]);
  });
});
