import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { csvRow } from "./csv";

type Args = {
  server: string;
  token?: string;
  output: string;
  limitCaches?: number;
  pageSize: number;
  delayMs: number;
  profileDir: string;
  browser?: string;
  headless: boolean;
  upload: boolean;
};

type CacheState = {
  gcCode: string;
  name: string;
  existingLogIds: string[];
  existingLogKeys: string[];
};

type LogbookEntry = {
  LogID?: number | string;
  LogType?: string;
  Visited?: string;
  UserName?: string;
  LogText?: string;
};

type CollectorLog = {
  gcCode: string;
  logId: string | null;
  date: string;
  type: string;
  finder: string;
  text: string;
};

type CollectedCache = {
  gcCode: string;
  favoritePoints: number | null;
};

const DEFAULT_PROFILE_DIR = ".codex/geocaching-browser";
const DEFAULT_OUTPUT = "received-logs.csv";
const DEFAULT_SERVER = "http://127.0.0.1:3001";
const DEFAULT_HELIUM_PATH = "";
const CSV_HEADER = ["gcCode", "logId", "date", "type", "finder", "text"];

function workspaceRoot(): string {
  return resolve(process.env.INIT_CWD ?? "../..");
}

function workspacePath(path: string): string {
  return resolve(workspaceRoot(), path);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    server: process.env.GEOSTATS_SERVER_URL ?? DEFAULT_SERVER,
    token: process.env.GEOSTATS_COLLECTOR_TOKEN,
    output: DEFAULT_OUTPUT,
    pageSize: 100,
    delayMs: 1500,
    profileDir: DEFAULT_PROFILE_DIR,
    browser: existsSync(DEFAULT_HELIUM_PATH) ? DEFAULT_HELIUM_PATH : undefined,
    headless: false,
    upload: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--server" && next) {
      args.server = next;
      index += 1;
    } else if (arg === "--token" && next) {
      args.token = next;
      index += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      index += 1;
    } else if (arg === "--limit-caches" && next) {
      args.limitCaches = Number(next);
      index += 1;
    } else if (arg === "--page-size" && next) {
      args.pageSize = Number(next);
      index += 1;
    } else if (arg === "--delay-ms" && next) {
      args.delayMs = Number(next);
      index += 1;
    } else if (arg === "--profile-dir" && next) {
      args.profileDir = next;
      index += 1;
    } else if (arg === "--browser" && next) {
      args.browser = next;
      index += 1;
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--no-upload") {
      args.upload = false;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 500) {
    throw new Error("--page-size must be an integer from 1 to 500");
  }
  if (!Number.isInteger(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative integer");
  }
  if (args.limitCaches !== undefined && (!Number.isInteger(args.limitCaches) || args.limitCaches < 1)) {
    throw new Error("--limit-caches must be a positive integer");
  }

  args.server = args.server.replace(/\/$/, "");
  return args;
}

function printHelp() {
  console.log(`Collect owner-side geocaching.com logs and upload them to Geostats.

Usage:
  corepack pnpm collect-owner-logs -- --token <collector-token>
  server runner: set GEOSTATS_COLLECTOR_TOKEN, then run the Hides command from Profile.

Options:
  --server <url>          Geostats server URL. Default: ${DEFAULT_SERVER}
  --token <value>         Collector token. Can also use GEOSTATS_COLLECTOR_TOKEN.
  --output <path>         CSV backup path. Default: ${DEFAULT_OUTPUT}
  --limit-caches <n>      Collect only the first n owned caches.
  --page-size <n>         Logbook request size, 1-500. Default: 100
  --delay-ms <n>          Delay between requests. Default: 1500
  --profile-dir <path>    Browser profile dir. Default: ${DEFAULT_PROFILE_DIR}
  --browser <path>        Chromium/Helium executable path.
  --headless              Run without a visible browser after login is already stored.
  --no-upload             Write CSV only; do not upload to Geostats.
`);
}

function ensureOutput(path: string) {
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, `${csvRow(CSV_HEADER)}\n`, "utf8");
  }
}

function readExistingRows(path: string): Set<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  return new Set(readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).slice(1));
}

function appendRows(path: string, rows: string[]) {
  if (rows.length > 0) {
    appendFileSync(path, `${rows.join("\n")}\n`, "utf8");
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function isoDate(value: string | undefined): string {
  const text = value?.trim();
  if (!text) {
    throw new Error("Log entry is missing Visited date");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  throw new Error(`Could not parse log date: ${text}`);
}

function collectorLogKey(log: CollectorLog): string {
  return [
    log.date.trim(),
    log.type,
    log.finder,
    log.text
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u001f");
}

function fromLogbookEntry(gcCode: string, entry: LogbookEntry): CollectorLog {
  return {
    gcCode,
    logId: entry.LogID == null ? null : String(entry.LogID),
    date: isoDate(entry.Visited),
    type: entry.LogType?.trim() || "Found it",
    finder: entry.UserName?.trim() || "Unknown",
    text: stripHtml(entry.LogText ?? "")
  };
}

function tokenFromPage(html: string): string | null {
  return html.match(/userToken\s*=\s*'([^']+)'/)?.[1] ?? null;
}

export function favoritePointsFromHtml(html: string): number | null {
  const patterns = [
    /["'](?:favoritePoints|favoritePointCount|favorite_points|FavoritePoints)["']\s*[:=]\s*["']?([\d][\d,. ]*)/i,
    /([\d][\d,. ]*)\s*(?:favorite points?|favoritpoäng)/i,
    /(?:favorite points?|favoritpoäng)[\s\S]{0,160}?>([\d][\d,. ]*)</i
  ];
  for (const pattern of patterns) {
    const text = pattern.exec(html)?.[1]?.replace(/[^\d]/g, "");
    if (text !== undefined && text !== "") {
      const value = Number(text);
      if (Number.isSafeInteger(value) && value >= 0) {
        return value;
      }
    }
  }
  return null;
}

async function apiRequest<T>(args: Args, path: string, options: RequestInit = {}): Promise<T> {
  if (!args.token && args.upload) {
    throw new Error("Pass --token <collector-token> or set GEOSTATS_COLLECTOR_TOKEN");
  }
  const response = await fetch(`${args.server}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Geostats API ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

async function loadOwnedCaches(args: Args): Promise<CacheState[]> {
  const data = await apiRequest<{ caches: CacheState[] }>(args, "/collector/owned-caches");
  return args.limitCaches ? data.caches.slice(0, args.limitCaches) : data.caches;
}

async function uploadLogs(args: Args, logs: CollectorLog[], cache: CollectedCache) {
  if (!args.upload || (logs.length === 0 && cache.favoritePoints === null)) {
    return { added: 0, changedCaches: 0 };
  }
  return apiRequest<{ added: number; changedCaches: number }>(args, "/collector/received-logs", {
    method: "POST",
    body: JSON.stringify({ logs, caches: cache.favoritePoints === null ? [] : [cache] })
  });
}

async function ensureLoggedIn(context: BrowserContext, headless: boolean) {
  const page = await context.newPage();
  await page.goto("https://www.geocaching.com/account/dashboard", { waitUntil: "domcontentloaded" });
  if (await isLoggedIn(page)) {
    console.log("Already logged in to geocaching.com.");
    await page.close();
    return;
  }

  if (headless) {
    await page.close();
    throw new Error("Not logged in. Run once without --headless and log in in the opened browser.");
  }

  console.log("Log in to geocaching.com in the opened browser. The collector will continue automatically.");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (await isLoggedIn(page)) {
      console.log("geocaching.com login detected.");
      await page.close();
      return;
    }
  }
  await page.close();
  throw new Error("Timed out waiting for geocaching.com login.");
}

async function isLoggedIn(page: Page) {
  const url = page.url();
  if (/\/account\/signin/i.test(url)) {
    return false;
  }
  const passwordInputs = await page.locator("input[type='password']").count().catch(() => 0);
  return passwordInputs === 0;
}

async function fetchCacheInfo(context: BrowserContext, gcCode: string): Promise<{ token: string; favoritePoints: number | null }> {
  const page = await context.newPage();
  await page.goto(`https://www.geocaching.com/geocache/${gcCode}?decrypt=y`, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  const token = tokenFromPage(html);
  const favoritePoints = favoritePointsFromHtml(html);
  await page.close();
  if (!token) {
    throw new Error(`Could not find logbook token for ${gcCode}. Check that you can view the cache page while logged in.`);
  }
  return { token, favoritePoints };
}

async function fetchLogbookPage(context: BrowserContext, token: string, index: number, pageSize: number) {
  const page = await context.newPage();
  try {
    const url = new URL("https://www.geocaching.com/seek/geocache.logbook");
    url.searchParams.set("tkn", token);
    url.searchParams.set("idx", String(index));
    url.searchParams.set("num", String(pageSize));
    url.searchParams.set("decrypt", "false");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    return JSON.parse(await page.locator("body").innerText()) as { status?: string; data?: LogbookEntry[] };
  } finally {
    await page.close();
  }
}

async function fetchNewLogs(
  context: BrowserContext,
  cache: CacheState,
  token: string,
  pageSize: number,
  delayMs: number
): Promise<CollectorLog[]> {
  const knownIds = new Set(cache.existingLogIds.map(String));
  const knownKeys = new Set(cache.existingLogKeys);
  const collected: CollectorLog[] = [];
  const seenIds = new Set<string>();
  let index = 1;

  for (;;) {
    const body = await fetchLogbookPage(context, token, index, pageSize);
    if (body.status !== "success" || !Array.isArray(body.data)) {
      throw new Error(`Unexpected logbook response status: ${body.status ?? "missing"}`);
    }

    let reachedKnownLog = false;
    for (const entry of body.data) {
      const log = fromLogbookEntry(cache.gcCode, entry);
      if (log.logId && seenIds.has(log.logId)) {
        continue;
      }
      if (log.logId) {
        seenIds.add(log.logId);
      }
      if ((log.logId && knownIds.has(log.logId)) || knownKeys.has(collectorLogKey(log))) {
        reachedKnownLog = true;
        continue;
      }
      collected.push(log);
    }

    if (reachedKnownLog || body.data.length < pageSize) {
      break;
    }
    index += pageSize;
    if (delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }

  return collected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = workspacePath(args.output);
  const profileDir = workspacePath(args.profileDir);
  ensureOutput(outputPath);
  const existingRows = readExistingRows(outputPath);

  const caches = await loadOwnedCaches(args);
  if (caches.length === 0) {
    throw new Error("No owned caches found. Import your My Hides GPX first.");
  }

  console.log(`Collecting logs for ${caches.length} owned caches from ${args.server}`);
  console.log(`Writing CSV backup ${outputPath}`);
  mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    executablePath: args.browser,
    viewport: { width: 1280, height: 900 }
  });

  let totalUploaded = 0;
  try {
    await ensureLoggedIn(context, args.headless);
    for (let index = 0; index < caches.length; index += 1) {
      const cache = caches[index];
      console.log(`[${index + 1}/${caches.length}] ${cache.gcCode} ${cache.name}`);
      const cacheInfo = await fetchCacheInfo(context, cache.gcCode);
      const logs = await fetchNewLogs(context, cache, cacheInfo.token, args.pageSize, args.delayMs);
      const rows = logs.map((log) => csvRow([log.gcCode, log.logId ?? "", log.date, log.type, log.finder, log.text]));
      const newRows = rows.filter((row) => {
        if (existingRows.has(row)) {
          return false;
        }
        existingRows.add(row);
        return true;
      });
      appendRows(outputPath, newRows);
      const result = await uploadLogs(args, logs, { gcCode: cache.gcCode, favoritePoints: cacheInfo.favoritePoints });
      totalUploaded += result.added;
      const favoriteText = cacheInfo.favoritePoints === null ? "favorite total unavailable" : `${cacheInfo.favoritePoints} favorite points`;
      console.log(`  ${logs.length} new log candidates, ${result.added} accepted by server, ${favoriteText}`);
      if (args.delayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, args.delayMs));
      }
    }
  } finally {
    await context.close();
  }

  console.log(`Done. ${totalUploaded} new logs uploaded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
