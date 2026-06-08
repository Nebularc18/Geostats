import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthUser } from "@geostats/shared";
import { Prisma } from "@geostats/db";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";
import { StatsService } from "../stats/stats.service";

type ReceivedLogInput = {
  gcCode?: string;
  logId?: string | number | null;
  date?: string;
  type?: string;
  finder?: string;
  text?: string | null;
};

const TOKEN_PREFIX = "gst";
const COLLECTOR_SOURCE_PATH = resolve(process.cwd(), "apps/tools/src/collect-owner-logs.ts");

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken() {
  return `${TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

function tokenCipherKey() {
  const secret = process.env.COLLECTOR_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("COLLECTOR_TOKEN_ENCRYPTION_KEY is required to encrypt collector tokens");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenCipherKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptToken(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    const [ivText, tagText, ciphertextText] = value.split(".");
    if (!ivText || !tagText || !ciphertextText) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", tokenCipherKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function trustedBaseUrl(request: any) {
  const configured = process.env.API_ORIGIN?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("API_ORIGIN must be an http or https URL");
    }
    return url.toString().replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("API_ORIGIN must be set in production");
  }
  const proto = firstHeader(request.headers?.["x-forwarded-proto"]) ?? request.protocol ?? "http";
  const host = firstHeader(request.headers?.["x-forwarded-host"]) ?? firstHeader(request.headers?.host) ?? `localhost:${process.env.API_PORT ?? "3001"}`;
  return `${proto}://${host}`.replace(/\/$/, "");
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function hidesRunnerScript(serverUrl: string) {
  const server = powershellString(serverUrl);
  return `$ErrorActionPreference = "Stop"

$server = ${server}
$token = $env:GEOSTATS_COLLECTOR_TOKEN
if (-not $token) {
  $token = Read-Host "Paste Geostats collector token"
}
if (-not $token) {
  throw "Collector token is required."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or newer is required. Install Node.js, then run this command again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js with npm, then run this command again."
}

$baseDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\hides-runner" } else { Join-Path $HOME ".geostats\\hides-runner" }
$profileDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\geocaching-browser" } else { Join-Path $HOME ".geostats\\geocaching-browser" }
$outputPath = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "geostats-received-logs.csv"
$collectorPath = Join-Path $baseDir "collect-owner-logs.ts"
$packagePath = Join-Path $baseDir "package.json"

New-Item -ItemType Directory -Force -Path $baseDir | Out-Null
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$packageJson = '{"private":true,"dependencies":{"playwright":"^1.51.1","tsx":"^4.19.2"}}'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($packagePath, $packageJson, $utf8NoBom)

Invoke-WebRequest -UseBasicParsing -Uri "$server/collector/hides.ts" -OutFile $collectorPath

Push-Location $baseDir
try {
  if (-not (Test-Path (Join-Path $baseDir "node_modules"))) {
    npm install --no-audit --no-fund
  }

  function Get-CommandExecutable([string] $command) {
    if (-not $command) {
      return $null
    }
    $trimmed = $command.Trim()
    if ($trimmed.StartsWith('"')) {
      $end = $trimmed.IndexOf('"', 1)
      if ($end -gt 1) {
        return $trimmed.Substring(1, $end - 1)
      }
    }
    return ($trimmed -split "\\s+")[0]
  }

  function Get-DefaultBrowserExecutable {
    try {
      $choice = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" -ErrorAction Stop
      if ($choice.ProgId) {
        $commandItem = Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\$($choice.ProgId)\\shell\\open\\command" -ErrorAction Stop
        $exe = Get-CommandExecutable $commandItem.'(default)'
        if ($exe -and (Test-Path $exe)) {
          return $exe
        }
      }
    } catch {
    }
    return $null
  }

  $browser = $null
  $defaultBrowser = Get-DefaultBrowserExecutable
  $browserCandidates = @(
    $defaultBrowser,
    (Join-Path $env:LOCALAPPDATA "imput\\Helium\\Application\\chrome.exe"),
    (Join-Path \${env:ProgramFiles} "Microsoft\\Edge\\Application\\msedge.exe"),
    (Join-Path \${env:ProgramFiles(x86)} "Microsoft\\Edge\\Application\\msedge.exe"),
    (Join-Path \${env:ProgramFiles} "Google\\Chrome\\Application\\chrome.exe"),
    (Join-Path \${env:ProgramFiles(x86)} "Google\\Chrome\\Application\\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\\Chrome\\Application\\chrome.exe")
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
  if ($browserCandidates.Count -gt 0) {
    $browser = $browserCandidates[0]
    Write-Host "Using browser: $browser"
  } else {
    $playwrightCache = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "ms-playwright" } else { Join-Path $HOME ".cache\\ms-playwright" }
    $hasCachedChromium = (Test-Path $playwrightCache) -and ((Get-ChildItem -Path $playwrightCache -Directory -Filter "chromium-*" -ErrorAction SilentlyContinue | Select-Object -First 1) -ne $null)
    if (-not $hasCachedChromium) {
      npx --yes playwright install chromium
    }
  }

  $runArgs = @($collectorPath, "--server", $server, "--token", $token, "--profile-dir", $profileDir, "--output", $outputPath)
  if ($browser) {
    $runArgs += @("--browser", $browser)
  }
  npx --yes tsx @runArgs
} finally {
  Pop-Location
}
`;
}

function authToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function rawObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
}

function rawArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function rawText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (value && typeof value === "object" && "text" in value && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text.trim();
    }
  }
  return null;
}

export function cacheLogs(raw: unknown): Array<Record<string, any>> {
  const root = rawObject(raw);
  const extension = rawObject(root["groundspeak:cache"] ?? root.cache);
  return rawArray<Record<string, any>>(extension["groundspeak:logs"]?.["groundspeak:log"] ?? extension.logs?.log);
}

function logId(log: Record<string, any>): string | null {
  return rawText(log["geostats:log_id"], log.logId, log.LogID, log.id);
}

function logDateKey(value: unknown): string {
  const text = rawText(value) ?? "";
  const day = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (day) {
    return day;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function logTextKey(value: unknown): string {
  const text = rawText(value) ?? "";
  return text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function logKey(log: Record<string, any>): string {
  return [
    logDateKey(rawText(log["groundspeak:date"], log.date)),
    rawText(log["groundspeak:type"], log.type) ?? "",
    rawText(log["groundspeak:finder"], log.finder) ?? "",
    logTextKey(rawText(log["groundspeak:text"], log.text))
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u001f");
}

function normalizeDate(value: string | undefined) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException("date is required");
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`invalid date: ${text}`);
  }
  return date;
}

export function rawFromInput(log: ReceivedLogInput) {
  const gcCode = log.gcCode?.trim().toUpperCase();
  const finder = log.finder?.trim();
  if (!gcCode) {
    throw new BadRequestException("gcCode is required");
  }
  if (!finder) {
    throw new BadRequestException("finder is required");
  }
  const raw: Record<string, string> = {
    "groundspeak:date": normalizeDate(log.date).toISOString(),
    "groundspeak:type": log.type?.trim() || "Found it",
    "groundspeak:finder": finder,
    "groundspeak:text": log.text?.trim() ?? ""
  };
  if (log.logId != null && String(log.logId).trim()) {
    raw["geostats:log_id"] = String(log.logId).trim();
  }
  return { gcCode, raw };
}

function countReceivedLogs(logs: Array<Record<string, any>>) {
  return logs.filter((log) => rawText(log["groundspeak:type"], log.type)?.toLowerCase() !== "publish listing").length;
}

export function mergedRaw(raw: unknown, newLogs: Array<Record<string, any>>) {
  const root = rawObject(raw);
  const cacheKey = root["groundspeak:cache"] !== undefined || root.cache === undefined ? "groundspeak:cache" : "cache";
  const extension = rawObject(root[cacheKey]);
  const logsKey = extension["groundspeak:logs"] !== undefined || extension.logs === undefined ? "groundspeak:logs" : "logs";
  const logKeyName = logsKey === "groundspeak:logs" ? "groundspeak:log" : "log";
  const existingLogs = cacheLogs(raw);
  const mergedLogs = [...existingLogs];
  const seenIds = new Set(existingLogs.map(logId).filter((value): value is string => Boolean(value)));
  const seenKeys = new Set(existingLogs.map(logKey));
  let added = 0;

  for (const log of newLogs) {
    const id = logId(log);
    const key = logKey(log);
    if ((id && seenIds.has(id)) || seenKeys.has(key)) {
      continue;
    }
    if (id) {
      seenIds.add(id);
    }
    seenKeys.add(key);
    mergedLogs.push(log);
    added += 1;
  }

  return {
    added,
    receivedLogCount: countReceivedLogs(mergedLogs),
    raw: {
      ...root,
      [cacheKey]: {
        ...extension,
        [logsKey]: {
          ...rawObject(extension[logsKey]),
          [logKeyName]: mergedLogs
        }
      }
    }
  };
}

@Controller("collector")
export class CollectorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService
  ) {}

  @Get("hides.ps1")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "no-store")
  hidesPowerShell(@Req() request: any) {
    return hidesRunnerScript(trustedBaseUrl(request));
  }

  @Get("hides.ts")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "no-store")
  hidesSource() {
    if (!existsSync(COLLECTOR_SOURCE_PATH)) {
      throw new NotFoundException("Collector source is not available in this deployment.");
    }
    return readFileSync(COLLECTOR_SOURCE_PATH, "utf8");
  }

  private async tokenUser(authorization: string | undefined) {
    const token = authToken(authorization);
    if (!token) {
      throw new UnauthorizedException("Missing collector bearer token");
    }
    const found = await this.prisma.collectorToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { id: true, userId: true }
    });
    if (!found) {
      throw new UnauthorizedException("Invalid collector token");
    }
    await this.prisma.collectorToken.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
    return found.userId;
  }

  @Get("owned-caches")
  async ownedCaches(@Headers("authorization") authorization?: string) {
    const userId = await this.tokenUser(authorization);
    const hides = await this.prisma.hide.findMany({
      where: { userId },
      include: { cache: true },
      orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }]
    });
    return {
      caches: hides.map((hide) => {
        const logs = cacheLogs(hide.cache.raw);
        return {
          gcCode: hide.cache.gcCode,
          name: hide.cache.name,
          receivedLogCount: hide.receivedLogCount,
          existingLogIds: logs.map(logId).filter(Boolean),
          existingLogKeys: logs.map(logKey)
        };
      })
    };
  }

  @Post("received-logs")
  async receivedLogs(@Headers("authorization") authorization: string | undefined, @Body() body: { logs?: ReceivedLogInput[] }) {
    const userId = await this.tokenUser(authorization);
    const logs = body.logs ?? [];
    if (!Array.isArray(logs)) {
      throw new BadRequestException("logs must be an array");
    }
    const byCode = new Map<string, Array<Record<string, any>>>();
    for (const log of logs) {
      const normalized = rawFromInput(log);
      byCode.set(normalized.gcCode, [...(byCode.get(normalized.gcCode) ?? []), normalized.raw]);
    }
    const codes = Array.from(byCode.keys());
    const hides = await this.prisma.hide.findMany({
      where: { userId, cache: { gcCode: { in: codes } } },
      include: { cache: true }
    });
    const hidesByCode = new Map(hides.map((hide) => [hide.cache.gcCode, hide]));
    const missing = codes.filter((code) => !hidesByCode.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown owned caches: ${missing.join(", ")}`);
    }

    let added = 0;
    let changedCaches = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const [gcCode, cacheLogsToAdd] of byCode) {
        const hide = hidesByCode.get(gcCode);
        if (!hide) {
          continue;
        }
        const merged = mergedRaw(hide.cache.raw, cacheLogsToAdd);
        if (merged.added === 0 && hide.receivedLogCount === merged.receivedLogCount) {
          continue;
        }
        await tx.cache.update({ where: { id: hide.cacheId }, data: { raw: merged.raw as Prisma.InputJsonValue } });
        await tx.hide.update({ where: { id: hide.id }, data: { receivedLogCount: merged.receivedLogCount } });
        added += merged.added;
        changedCaches += 1;
      }
      if (added > 0) {
        await this.stats.refreshSnapshotForUser(userId, tx);
      }
    });
    return { added, changedCaches };
  }
}

@Controller("collector/tokens")
@UseGuards(AuthGuard)
export class CollectorTokenController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const tokens = await this.prisma.collectorToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, tokenPrefix: true, tokenCiphertext: true, createdAt: true, lastUsedAt: true }
    });
    return {
      tokens: tokens.map(({ tokenCiphertext, ...token }) => ({
        ...token,
        token: decryptToken(tokenCiphertext)
      }))
    };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: { name?: string }) {
    const token = newToken();
    const created = await this.prisma.collectorToken.create({
      data: {
        userId: user.id,
        name: body.name?.trim() || "Collector",
        tokenPrefix: token.slice(0, 12),
        tokenHash: tokenHash(token),
        tokenCiphertext: encryptToken(token)
      },
      select: { id: true, name: true, tokenPrefix: true, tokenCiphertext: true, createdAt: true, lastUsedAt: true }
    });
    const { tokenCiphertext, ...collectorToken } = created;
    return { token, collectorToken: { ...collectorToken, token } };
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const result = await this.prisma.collectorToken.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) {
      throw new NotFoundException("Collector token not found");
    }
    return { ok: true };
  }
}
