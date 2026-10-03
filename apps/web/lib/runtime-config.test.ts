import assert from "node:assert/strict";
import test from "node:test";
import { getPublicRuntimeConfig, isClerkEnabled, readPublicRuntimeConfig, RUNTIME_CONFIG_ID, serializePublicRuntimeConfig } from "./runtime-config.ts";

test("each installation supplies its own runtime API and Clerk configuration", () => {
  const first = readPublicRuntimeConfig({ NEXT_PUBLIC_API_URL: "https://first.example/api/", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_first" });
  const second = readPublicRuntimeConfig({ NEXT_PUBLIC_API_URL: "https://second.example/api", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_second" });
  assert.equal(first.apiUrl, "https://first.example/api");
  assert.equal(second.apiUrl, "https://second.example/api");
  assert.equal(first.clerkPublishableKey, "pk_test_first");
  assert.equal(second.clerkPublishableKey, "pk_test_second");
  assert.equal(isClerkEnabled(first), true);
  assert.equal(isClerkEnabled({ ...second, authMode: "password" }), false);
  assert.equal(isClerkEnabled({ ...second, authMode: "dev" }), false);
  assert.equal(isClerkEnabled(readPublicRuntimeConfig({})), false);
});

test("only public settings are serialized, with script-breaking values escaped", () => {
  const config = readPublicRuntimeConfig({
    NEXT_PUBLIC_API_URL: "https://example.com",
    NEXT_PUBLIC_AUTH_PROVIDER_NAME: '</script><script>alert("x")</script>&\u2028',
    CLERK_SECRET_KEY: "sk_live_never_public",
    DATABASE_URL: "postgresql://private"
  });
  const json = serializePublicRuntimeConfig(config);
  assert.equal(json.includes("<"), false);
  assert.equal(json.includes("&"), false);
  assert.equal(json.includes("sk_live"), false);
  assert.equal(json.includes("postgresql"), false);
  assert.deepEqual(JSON.parse(json), config);
});

test("browser reads bootstrapped configuration instead of server environment", () => {
  const config = readPublicRuntimeConfig({ NEXT_PUBLIC_API_URL: "https://runtime.example", NEXT_PUBLIC_AUTH_MODE: "dev", NEXT_PUBLIC_DEV_AUTO_LOGIN: "true" });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    getElementById: (id: string) => id === RUNTIME_CONFIG_ID ? { textContent: serializePublicRuntimeConfig(config) } : null
  } });
  try {
    assert.deepEqual(getPublicRuntimeConfig(), config);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
