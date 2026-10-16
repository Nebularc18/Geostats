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
