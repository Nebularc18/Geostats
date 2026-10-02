import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";

test("account-bound requests reject a changed cookie identity before reaching the handler", async () => {
  const guard = new AuthGuard({ verify: async () => ({ id: "bob", email: "bob@example.com", username: "bob" }) } as any);
  for (const expected of ["alice", "", ["bob"]]) {
    const request = { cookies: { geostats_session: "bob-cookie" }, headers: { "x-geostats-account-id": expected } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    await assert.rejects(guard.canActivate(context), UnauthorizedException);
  }
  for (const headers of [{}, { "x-geostats-account-id": "bob" }]) {
    const request = { cookies: { geostats_session: "bob-cookie" }, headers };
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any), true);
  }
});

test("account binding also applies to development authentication", async () => {
  const guard = new AuthGuard({ authMode: () => "dev", devUser: async () => ({ id: "dev-user" }) } as any);
  const request = { headers: { "x-geostats-account-id": "old-user" } };
  await assert.rejects(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any), UnauthorizedException);
});
