import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

type Args = {
  server: string;
  token?: string;
  username?: string;
  profileDir: string;
  browser?: string;
  headless: boolean;
};

type FinderCountryRow = {
  country: string;
  count: number;
};

const DEFAULT_SERVER = "http://127.0.0.1:3001";
const DEFAULT_PROFILE_DIR = ".codex/project-gc-browser";

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
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false
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
    } else if (arg === "--username" && next) {
      args.username = next;
      index += 1;
    } else if (arg === "--profile-dir" && next) {
      args.profileDir = next;
      index += 1;
    } else if (arg === "--browser" && next) {
      args.browser = next;
      index += 1;
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  args.server = args.server.replace(/\/$/, "");
  return args;
}

function printHelp() {
  console.log(`Collect Project-GC Finders by country stats and upload them to Geostats.

Usage:
  corepack pnpm collect-project-gc-finder-countries -- --token <collector-token>

Options:
  --server <url>          Geostats server URL. Default: ${DEFAULT_SERVER}
  --token <value>         Collector token. Can also use GEOSTATS_COLLECTOR_TOKEN.
  --username <name>       Project-GC profile username. Defaults to your Geostats profile username.
  --profile-dir <path>    Browser profile dir. Default: ${DEFAULT_PROFILE_DIR}
  --browser <path>        Chromium/Helium executable path.
  --headless              Run without a visible browser after login is already stored.
`);
}

async function apiRequest<T>(args: Args, path: string, options: RequestInit = {}): Promise<T> {
  if (!args.token) {
    throw new Error("Pass --token <collector-token> or set GEOSTATS_COLLECTOR_TOKEN");
  }
  const response = await fetch(`${args.server}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.token}`,
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Geostats API ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

async function profileUsername(args: Args) {
  if (args.username?.trim()) {
    return args.username.trim();
  }
  const data = await apiRequest<{ gcUsername: string }>(args, "/collector/project-gc-profile");
  return data.gcUsername;
}

async function waitForFinderCountryTable(page: Page, headless: boolean) {
  const selector = 'article[data-ps-module-id="Hides:FindersByCountryModule"] table tr:nth-child(2) td';
  try {
    await page.waitForSelector(selector, { timeout: headless ? 30_000 : 10_000 });
    return;
  } catch {
    if (headless) {
      throw new Error("Project-GC Finders by country table was not available. Run once without --headless and sign in if needed.");
    }
  }

  console.log("Sign in or authenticate Project-GC in the opened browser if needed. The collector will continue automatically.");
  await page.waitForSelector(selector, { timeout: 10 * 60_000 });
}

async function extractFinderCountries(page: Page): Promise<FinderCountryRow[]> {
  return page.$$eval('article[data-ps-module-id="Hides:FindersByCountryModule"] table tr', (rows) =>
    rows
      .slice(1)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td")) as Array<{
          querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null;
          textContent: string | null;
        }>;
        const countryCell = cells[0];
        const countCell = cells[1];
        const country =
          countryCell?.querySelector("img")?.getAttribute("title")?.trim() ||
          countryCell?.querySelector("img")?.getAttribute("alt")?.trim() ||
          countryCell?.textContent?.replace(/^\s*\d+\s*[–-]\s*/, "").trim();
        const count = Number(countCell?.textContent?.replace(/[^\d]/g, ""));
        return country && Number.isInteger(count) && count > 0 ? { country, count } : null;
      })
      .filter((row): row is FinderCountryRow => Boolean(row))
  );
}

async function uploadRows(args: Args, rows: FinderCountryRow[]) {
  return apiRequest<{ rows: FinderCountryRow[] }>(args, "/collector/project-gc/finder-countries", {
    method: "POST",
    body: JSON.stringify({ rows })
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = await profileUsername(args);
  const profileDir = workspacePath(args.profileDir);
  mkdirSync(profileDir, { recursive: true });
  const url = `https://project-gc.com/ProfileStats/${encodeURIComponent(username)}#Hides`;

  console.log(`Opening ${url}`);
  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    executablePath: args.browser,
    viewport: { width: 1280, height: 900 }
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForFinderCountryTable(page, args.headless);
    const rows = await extractFinderCountries(page);
    if (rows.length === 0) {
      throw new Error("No finder country rows found on Project-GC.");
    }
    const result = await uploadRows(args, rows);
    console.log(`Uploaded ${result.rows.length} finder country rows.`);
    for (const row of result.rows) {
      console.log(`  ${row.country}: ${row.count}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
