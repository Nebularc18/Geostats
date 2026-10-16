import { defineConfig } from "@playwright/test";

export const installations = [
  { name: "password", port: 3310, apiUrl: "https://password-api.example.invalid", key: "pk_test_password", devAutoLogin: false },
  { name: "dev", port: 3311, apiUrl: "https://dev-api.example.invalid", key: "pk_test_dev", devAutoLogin: true }
];

export default defineConfig({
  testDir: ".",
  testMatch: "runtime.spec.mjs",
  outputDir: "../test-results",
  fullyParallel: true,
  use: { browserName: "chromium" },
  webServer: installations.map((installation) => ({
    command: `corepack pnpm exec next start --hostname 127.0.0.1 --port ${installation.port}`,
    cwd: new URL("..", import.meta.url).pathname,
    url: `http://127.0.0.1:${installation.port}/login`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_API_URL: installation.apiUrl,
      NEXT_PUBLIC_AUTH_MODE: installation.name,
      NEXT_PUBLIC_AUTH_PROVIDER_NAME: `Provider ${installation.name}`,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: installation.key,
      NEXT_PUBLIC_DEV_AUTO_LOGIN: String(installation.devAutoLogin),
      CLERK_SECRET_KEY: "sk_test_browser_only_never_public"
    }
  }))
});
