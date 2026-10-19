import { expect, test } from "@playwright/test";
import { installations } from "./runtime.config.mjs";

for (const installation of installations) {
  const loginUrl = `http://127.0.0.1:${installation.port}/login`;

  test(`${installation.name}: initial HTML and first API request use runtime settings`, async ({ page, request }) => {
    const response = await request.get(loginUrl);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("sk_test_browser_only_never_public");
    const script = html.match(/<script\b[^>]*id="geostats-runtime-config"[^>]*>([\s\S]*?)<\/script>/);
    expect(script).not.toBeNull();
    expect(JSON.parse(script[1])).toEqual({
      apiUrl: installation.apiUrl,
      authMode: installation.name,
      authProviderName: `Provider ${installation.name}`,
      clerkPublishableKey: installation.key,
      devAutoLogin: installation.devAutoLogin
    });

    const apiRequests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/auth/**", async (route) => {
      apiRequests.push(route.request().url());
      await route.fulfill({
        headers: {
          "access-control-allow-origin": new URL(loginUrl).origin,
          "access-control-allow-credentials": "true"
        },
        json: { mode: installation.name, providerName: `Provider ${installation.name}` }
      });
    });
    const configResponse = page.waitForResponse(`${installation.apiUrl}/auth/config`);
    await page.goto(loginUrl);
    expect((await configResponse).ok()).toBe(true);
    if (installation.name === "password") {
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Continue in dev mode" })).toHaveAttribute("href", `${installation.apiUrl}/auth/dev`);
    }
    expect(apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests.every((url) => url === `${installation.apiUrl}/auth/config`)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${installation.name}: unavailable API uses runtime auth fallback`, async ({ page }) => {
    await page.route("**/auth/**", (route) => route.abort());
    await page.goto(loginUrl);
    if (installation.name === "password") {
      await expect(page.getByLabel("Email")).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Continue in dev mode" })).toHaveAttribute("href", `${installation.apiUrl}/auth/dev`);
    }
  });
}


test("GSAK script update banner clears after downloading the current connector", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  let updated = false;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      "/profile": { profile: { userId: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/imports": { imports: [] },
      "/collector/gsak/status": {
        connected: true, lastImportedAt: null,
        scriptVersion: updated ? "1.9" : "1.8",
        latestScriptVersion: "1.9", updateAvailable: !updated,
      },
      "/collector/gsak/setup": { fileName: "GeostatsImport.gsk", macro: "# MacVersion = 1.9" },
    };
    if (path === "/collector/gsak/setup" && route.request().method() === "POST") updated = true;
    await route.fulfill({
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      json: responses[path] ?? {},
    });
  });
  await page.goto(`${origin}/imports`);
  const banner = page.getByRole("status").filter({ hasText: "GSAK import script update available" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Your last download was version 1.8");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download updated script" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("GeostatsImport.gsk");
  await expect(banner).toHaveCount(0);
  await expect(page.getByText("Connector downloaded. Open GeostatsImport.gsk", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download a new connector" })).toBeVisible();
  expect(errors).toEqual([]);
});


test("Geocaching helper update banner detects legacy and outdated helpers and clears for the current version", async ({ page, request }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  const scriptResponse = await request.get(`${origin}/mysteries/tampermonkey.user.js`);
  expect(scriptResponse.ok()).toBe(true);
  const script = await scriptResponse.text();
  const latestVersion = script.match(/@version\s+(\S+)/)[1];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      "/profile": { profile: { userId: "user-1" } },
      "/auth/me": { user: { id: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/mysteries/owned": { mysteries: [], deletedClientIds: [] },
      "/mysteries/shared": { mysteries: [] },
    };
    await route.fulfill({
      headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
      json: responses[path] ?? {},
    });
  });
  await page.goto(`${origin}/mysteries`);
  const banner = page.getByRole("status", { name: "Geocaching helper update" });
  await expect(page.getByRole("heading", { name: "Mysteries", exact: true })).toBeVisible();
  await expect(banner).toHaveCount(0);
  // The existing released helper reports capabilities but has no version marker.
  await page.evaluate(() => document.documentElement.setAttribute("data-geostats-note-batch-support", "1"));
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Your helper does not report its version");
  await expect(banner.getByRole("link", { name: "Update browser script" })).toHaveAttribute("href", `/mysteries/tampermonkey.user.js?v=${latestVersion}`);
  await page.evaluate(() => document.documentElement.setAttribute("data-geostats-helper-version", "2.8.0"));
  await expect(banner).toContainText("Your helper is version 2.8.0");
  // Only a helper reporting the current installed version clears the notice.
  await page.evaluate((version) => document.documentElement.setAttribute("data-geostats-helper-version", version), latestVersion);
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});
