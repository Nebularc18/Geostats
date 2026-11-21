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
      "/collector/gsak/setup": { fileName: "GeostatsImport.gsk", scriptVersion: "1.9", macro: "# MacVersion = 1.9" },
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

test("mystery listing excerpts can be saved as clues without copying the whole description", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  const owned = new Map();
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "PUT" && path.startsWith("/mysteries/")) {
      const { mystery, revision } = request.postDataJSON();
      owned.set(mystery.id, { clientId: mystery.id, mystery, revision, sharedWith: [] });
      return route.fulfill({ headers, json: { mystery, revision } });
    }
    const responses = {
      "/auth/me": { user: { id: "user-1" } },
      "/profile": { profile: { userId: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/mysteries/owned": { mysteries: [...owned.values()], deletedClientIds: [] },
      "/mysteries/shared": { mysteries: [] }
    };
    await route.fulfill({ headers, json: responses[path] ?? {} });
  });
  const listing = "Count the hats.\n\nThe circus comes to town.";
  const payload = { gcCode: "GC123", name: "Circus puzzle", latitude: 59, longitude: 18,
    clues: [`Puzzle listing:\n${listing}`, "Listing hint:\nLook up", "Remember the rabbits"] };
  await page.goto(`${origin}/mysteries#mystery-import=${encodeURIComponent(JSON.stringify(payload))}`);
  const clues = page.locator(".clue-strip");
  await expect(clues).toContainText("Look up");
  await expect(clues).toContainText("Remember the rabbits");
  await expect(clues).not.toContainText("The circus comes to town.");
  await page.getByText("Listing", { exact: true }).click();
  const listingText = page.getByRole("textbox", { name: "Cache listing text" });
  await expect(listingText).toHaveValue(listing);
  const save = page.getByRole("button", { name: "Add selection to clues" });
  await expect(save).toBeDisabled();
  await listingText.click({ clickCount: 3, position: { x: 24, y: 18 } });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(clues).toContainText("Count the hats.");
  await expect(clues).not.toContainText("The circus comes to town.");
  await expect.poll(() => [...owned.values()][0]?.mystery).toMatchObject({
    listingText: listing,
    clues: ["Listing hint:\nLook up", "Remember the rabbits", "Count the hats."]
  });
  await page.reload();
  await expect(clues).toContainText("Count the hats.");
  await expect(clues).toContainText("Remember the rabbits");

  const refreshed = { ...payload, listingText: "The circus returns next year.", clues: [] };
  const saved = [...owned.values()][0];
  owned.set(saved.clientId, { ...saved, revision: saved.revision + 1, mystery: { ...saved.mystery, notes: "Notes edited on another device." } });
  await page.goto(`${origin}/mysteries?refresh=1#mystery-import=${encodeURIComponent(JSON.stringify(refreshed))}`);
  await expect(clues).toContainText("Count the hats.");
  await expect(clues).toContainText("Remember the rabbits");
  await page.getByText("Listing", { exact: true }).click();
  await expect(listingText).toHaveValue(refreshed.listingText);
  await expect.poll(() => owned.get(saved.clientId)?.mystery).toMatchObject({
    listingText: refreshed.listingText, notes: "Notes edited on another device."
  });

  const large = { ...refreshed, listingText: "å".repeat(70 * 1024) };
  await page.goto(`${origin}/mysteries?refresh=2#mystery-import=${encodeURIComponent(JSON.stringify(large))}`);
  await page.getByText("Listing", { exact: true }).click();
  await expect(listingText).toHaveValue(large.listingText);
  await listingText.press("Control+a");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Clue not saved" })).toBeVisible();
  await expect(clues.getByRole("button")).toHaveCount(4);

  const oversized = { ...large, listingText: "å".repeat(128 * 1024 - 50) };
  await page.goto(`${origin}/mysteries?refresh=3#mystery-import=${encodeURIComponent(JSON.stringify(oversized))}`);
  await expect(page.getByRole("status").filter({ hasText: "Listing not refreshed" })).toBeVisible();
  await page.getByText("Listing", { exact: true }).click();
  await expect(listingText).toHaveValue(large.listingText);
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


test("GSAK download clears the banner despite an older in-flight poll and later poll failures", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  let statusRequests = 0;
  let releaseOldPoll;
  const oldPoll = new Promise((resolve) => { releaseOldPoll = resolve; });
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/collector/gsak/status") {
      statusRequests++;
      if (statusRequests === 2) await oldPoll;
      if (statusRequests > 2) return route.abort();
    }
    const responses = {
      "/profile": { profile: { userId: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/imports": { imports: [] },
      "/collector/gsak/status": { connected: true, lastImportedAt: null, scriptVersion: "1.8", latestScriptVersion: "1.9", updateAvailable: true },
      "/collector/gsak/setup": { fileName: "GeostatsImport.gsk", macro: "# MacVersion = 1.9", scriptVersion: "1.9" },
    };
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
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => statusRequests).toBe(2);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download updated script" }).click();
  await download;
  await expect(banner).toHaveCount(0);
  const staleResponse = page.waitForResponse(`${installation.apiUrl}/collector/gsak/status`);
  releaseOldPoll();
  await staleResponse;
  // A later failing poll must also keep the successful download state.
  await expect.poll(() => statusRequests).toBeGreaterThan(2);
  await expect(page.getByRole("button", { name: "Download a new connector" })).toBeEnabled();
  await expect(banner).toHaveCount(0);
});


test("sidebar entry to Mysteries loads a new document so the legacy helper can run", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      "/profile": { profile: { userId: "user-1" } },
      "/auth/me": { user: { id: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/imports": { imports: [] },
      "/collector/gsak/status": { connected: false, lastImportedAt: null, updateAvailable: false },
      "/mysteries/owned": { mysteries: [], deletedClientIds: [] },
      "/mysteries/shared": { mysteries: [] },
    };
    await route.fulfill({
      headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
      json: responses[path] ?? {},
    });
  });
  // Simulate Tampermonkey's document-scoped URL matching for an existing helper.
  await page.addInitScript(() => {
    if (location.pathname.startsWith("/mysteries")) {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.setAttribute("data-geostats-note-batch-support", "1");
      });
    }
  });
  await page.goto(`${origin}/imports`);
  await expect(page.getByRole("heading", { name: "Import history" })).toBeVisible();
  const navigation = page.waitForEvent("request", (request) => request.isNavigationRequest() && request.url() === `${origin}/mysteries`);
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Mysteries", exact: true }).click();
  await navigation;
  await expect(page.getByRole("status", { name: "Geocaching helper update" })).toBeVisible();
});

test("signed-in Travel migrates a browser trip, saves stop order, and downloads GPX", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const trip = {
    id: "browser-trip", name: "Saturday route", mode: "nearby", createdAt: "2026-01-01T00:00:00.000Z",
    radiusKm: 5, origin: { label: "Start", latitude: 59, longitude: 18 },
    caches: [
      { id: "point-one", gcCode: "GCONE", name: "First stop", latitude: 59.01, longitude: 18, cacheType: "Traditional Cache", distanceKm: 1 },
      { id: "point-two", gcCode: "GCTWO", name: "Second stop", latitude: 59.02, longitude: 18, cacheType: null, distanceKm: 2 }
    ]
  };
  const storageKey = `geostats-travel-plans-v3:${encodeURIComponent(installation.apiUrl)}:user-1`;
  await page.addInitScript(({ storageKey, trip }) => {
    if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, JSON.stringify([trip]));
  }, { storageKey, trip });

  let savedPlans = [];
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "content-type, x-geostats-account-id"
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/travel-plans/migrate" && request.method() === "POST") {
      expect(request.headers()["x-geostats-account-id"]).toBe("user-1");
      const { plans } = request.postDataJSON();
      savedPlans = plans.map((plan) => ({ ...plan, version: 1 }));
      return route.fulfill({ headers, json: { plans: savedPlans } });
    }
    if (path === "/travel-plans/browser-trip" && request.method() === "PUT") {
      const { version, plan } = request.postDataJSON();
      expect(version).toBe(1);
      savedPlans = [{ ...plan, version: 2 }];
      return route.fulfill({ headers, json: { plan: savedPlans[0] } });
    }
    const fixture = {
      "/auth/me": { user: { id: "user-1" } },
      "/profile": { profile: { userId: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/map/travel-pool": { total: 0, found: 0, unfound: 0, poolTruncated: false, types: [] },
      "/mysteries/owned": { mysteries: [], deletedClientIds: [] },
      "/mysteries/shared": { mysteries: [] },
      "/travel-plans": { plans: savedPlans }
    };
    await route.fulfill({ headers, json: fixture[path] ?? {} });
  });

  await page.goto(`${origin}/travel`);
  const browserCard = page.locator("article").filter({ hasText: "This browser" });
  await expect(browserCard.getByRole("link", { name: "First stop" })).toBeVisible();
  await expect(browserCard.getByRole("link", { name: "Route" })).toHaveAttribute("href", /google\.com\/maps/);
  const browserDownload = page.waitForEvent("download");
  await browserCard.getByRole("button", { name: "GPX" }).click();
  expect((await browserDownload).suggestedFilename()).toBe("Saturday-route.gpx");
  await page.getByRole("button", { name: "Review browser trips" }).click();
  await expect(page.getByText("Saturday route · 2 stops", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Move 1 to my account" }).click();
  await expect(page.getByRole("button", { name: "Review browser trips" })).toHaveCount(0);
  await expect(browserCard).toHaveCount(0);
  await page.getByRole("button", { name: "Move Second stop earlier" }).click();
  await expect.poll(() => savedPlans[0]?.caches.map(({ gcCode }) => gcCode)).toEqual(["GCTWO", "GCONE"]);
  await page.reload();
  const savedCard = page.locator("article").filter({ hasText: "Saturday route" });
  await expect(savedCard.getByRole("link", { name: "Second stop" })).toBeVisible();
  const download = page.waitForEvent("download");
  await savedCard.getByRole("button", { name: "GPX" }).click();
  expect((await download).suggestedFilename()).toBe("Saturday-route.gpx");
  expect(errors).toEqual([]);
});

test("renamed upload sends the chosen mode and a retry shows its receipt", async ({ page }) => {
  const installation = installations[0];
  const origin = `http://127.0.0.1:${installation.port}`;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let status = null;
  await page.route(`${installation.apiUrl}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "POST" && path === "/imports/upload") {
      expect(request.postData()).toMatch(/name="purpose"\r\n\r\nhides/);
      status = "FAILED";
      return route.fulfill({ headers, json: { import: { id: "import-1", status } } });
    }
    if (request.method() === "POST" && path === "/imports/import-1/retry") {
      status = "COMPLETED";
      return route.fulfill({ headers, json: { import: { id: "import-1", status } } });
    }
    const responses = {
      "/profile": { profile: { userId: "user-1" } },
      "/admin/access": { isAdmin: false },
      "/collector/gsak/status": { connected: false, lastImportedAt: null },
      "/imports": { imports: status ? [{
        id: "import-1", fileName: "renamed.gpx", source: "MY_HIDES_GPX", status, createdAt: "2026-01-01T00:00:00Z",
        retryable: status === "FAILED", errorMessage: status === "FAILED" ? "Temporary import error" : null,
        receipt: status === "COMPLETED" ? { caches: 1, hides: 1, finds: 0, skippedWaypoints: 0, unmatchedFinds: 0 } : null
      }] : [] }
    };
    await route.fulfill({ headers, json: responses[path] ?? {} });
  });

  await page.goto(`${origin}/upload`);
  await page.getByLabel("GPX or ZIP file").setInputFiles({
    name: "renamed.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from("<gpx/>")
  });
  await page.getByLabel("What does the file contain?").selectOption("hides");
  await page.getByRole("button", { name: "Queue import" }).click();
  await expect(page.getByText("The import could not queue.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "View import history" }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("1 cache · 0 finds · 1 hide", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
