import assert from "node:assert/strict";
import test from "node:test";
import { PublicStatsController, publicProfileContentSecurityPolicy } from "./public-stats.controller";

test("public profile route sets a restrictive nonce-based CSP", async () => {
  const headers = new Map<string, string>();
  const controller = new PublicStatsController({
    publicSnapshotForUsername: async () => ({ profile: { gcUsername: "alice" }, stats: {} })
  } as never);
  const html = await controller.profileStats("alice", {
    setHeader: (name: string, value: string) => { headers.set(name, value); }
  } as never);
  const policy = headers.get("Content-Security-Policy") ?? "";

  assert.match(policy, /script-src 'nonce-[A-Za-z0-9_-]+' https:\/\/unpkg\.com/);
  assert.match(policy, /object-src 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(html, /<script nonce="[A-Za-z0-9_-]+">/);
});

test("public profile CSP allows only the renderer's external hosts", () => {
  const policy = publicProfileContentSecurityPolicy("fixed");
  assert.match(policy, /connect-src https:\/\/raw\.githubusercontent\.com/);
  assert.match(policy, /style-src 'unsafe-inline' https:\/\/unpkg\.com/);
});
