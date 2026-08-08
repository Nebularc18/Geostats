import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthUser } from "@geostats/shared";
import { Prisma } from "@geostats/db";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { normalizeCountry } from "../common/geocaching.utils";
import { PrismaService } from "../common/prisma.service";
import { StatsService } from "../stats/stats.service";
import { CollectorTokenAuthService } from "./collector-token-auth.service";

type ReceivedLogInput = {
  gcCode?: string;
  logId?: string | number | null;
  date?: string;
  type?: string;
  finder?: string;
  finderCountry?: string | null;
  text?: string | null;
};

type ReceivedCacheInput = {
  gcCode?: string;
  favoritePoints?: number;
};

type FinderCountryInput = {
  country?: unknown;
  count?: unknown;
};

const TOKEN_PREFIX = "gst";
const COLLECTOR_SOURCE_PATH = resolve(process.cwd(), "apps/tools/src/collect-owner-logs.ts");
const PROJECT_GC_SOURCE_PATH = resolve(process.cwd(), "apps/tools/src/collect-project-gc-finder-countries.ts");
const COLLECTOR_CSV_MAX_BYTES = 10_485_760;
const COLLECTOR_CSV_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain"]);

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
$isWindowsPlatform = $env:OS -eq "Windows_NT"
$npmCommand = if ($isWindowsPlatform) { "npm.cmd" } else { "npm" }
$npxCommand = if ($isWindowsPlatform) { "npx.cmd" } else { "npx" }
if (-not (Get-Command $npmCommand -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js with npm, then run this command again."
}
if (-not (Get-Command $npxCommand -ErrorAction SilentlyContinue)) {
  throw "npx is required. Install Node.js with npm, then run this command again."
}

$baseDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\hides-runner" } else { Join-Path $HOME ".geostats\\hides-runner" }
$profileDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\geocaching-browser" } else { Join-Path $HOME ".geostats\\geocaching-browser" }
$downloadsPath = Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"
New-Item -ItemType Directory -Force -Path $downloadsPath | Out-Null
$outputPath = Join-Path $downloadsPath "geostats-received-logs.csv"
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
    & $npmCommand install --no-audit --no-fund
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
      & $npxCommand --yes playwright install chromium
    }
  }

  $runArgs = @($collectorPath, "--server", $server, "--token", $token, "--profile-dir", $profileDir, "--output", $outputPath)
  if ($env:GEOSTATS_COLLECTOR_NO_UPLOAD -eq "1") {
    $runArgs += @("--no-upload")
  }
  if ($browser) {
    $runArgs += @("--browser", $browser)
  }
  & $npxCommand --yes tsx @runArgs
} finally {
  Pop-Location
}
`;
}

function projectGcRunnerScript(serverUrl: string) {
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
$isWindowsPlatform = $env:OS -eq "Windows_NT"
$npmCommand = if ($isWindowsPlatform) { "npm.cmd" } else { "npm" }
$npxCommand = if ($isWindowsPlatform) { "npx.cmd" } else { "npx" }
if (-not (Get-Command $npmCommand -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js with npm, then run this command again."
}
if (-not (Get-Command $npxCommand -ErrorAction SilentlyContinue)) {
  throw "npx is required. Install Node.js with npm, then run this command again."
}

$baseDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\project-gc-runner" } else { Join-Path $HOME ".geostats\\project-gc-runner" }
$profileDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Geostats\\project-gc-browser" } else { Join-Path $HOME ".geostats\\project-gc-browser" }
$collectorPath = Join-Path $baseDir "collect-project-gc-finder-countries.ts"
$packagePath = Join-Path $baseDir "package.json"

New-Item -ItemType Directory -Force -Path $baseDir | Out-Null
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$packageJson = '{"private":true,"dependencies":{"playwright":"^1.51.1","tsx":"^4.19.2"}}'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($packagePath, $packageJson, $utf8NoBom)

Invoke-WebRequest -UseBasicParsing -Uri "$server/collector/project-gc.ts" -OutFile $collectorPath

Push-Location $baseDir
try {
  if (-not (Test-Path (Join-Path $baseDir "node_modules"))) {
    & $npmCommand install --no-audit --no-fund
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
      & $npxCommand --yes playwright install chromium
    }
  }

  $runArgs = @($collectorPath, "--server", $server, "--token", $token, "--profile-dir", $profileDir)
  if ($env:GEOSTATS_PROJECT_GC_HEADLESS -eq "1") {
    $runArgs += @("--headless")
  }
  if ($browser) {
    $runArgs += @("--browser", $browser)
  }
  & $npxCommand --yes tsx @runArgs
} finally {
  Pop-Location
}
`;
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
  if (log.finderCountry?.trim()) {
    raw["geostats:finder_country"] = log.finderCountry.trim();
  }
  return { gcCode, raw };
}

function normalizedCacheInput(cache: ReceivedCacheInput) {
  const gcCode = cache.gcCode?.trim().toUpperCase();
  if (!gcCode) {
    throw new BadRequestException("gcCode is required for cache metadata");
  }
  if (!Number.isSafeInteger(cache.favoritePoints) || Number(cache.favoritePoints) < 0) {
    throw new BadRequestException("favoritePoints must be a non-negative integer");
  }
  return { gcCode, favoritePoints: Number(cache.favoritePoints) };
}

export function rawWithFavoritePoints(raw: unknown, favoritePoints: number) {
  const root = rawObject(raw);
  const cacheKey = root["groundspeak:cache"] !== undefined || root.cache === undefined ? "groundspeak:cache" : "cache";
  const extension = rawObject(root[cacheKey]);
  delete extension["groundspeak:favorite_points"];
  delete extension["groundspeak:favorites"];
  delete extension.favorite_points;
  delete extension.favorites;
  delete extension.favpoints;
  return {
    ...root,
    [cacheKey]: {
      ...extension,
      "groundspeak:favorite_points": String(favoritePoints)
    }
  };
}

function countReceivedLogs(logs: Array<Record<string, any>>) {
  return logs.filter((log) => rawText(log["groundspeak:type"], log.type)?.toLowerCase() !== "publish listing").length;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (inQuotes) {
    throw new BadRequestException("CSV contains an unclosed quoted field");
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((csvRow) => csvRow.some((value) => value.trim()));
}

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function fieldIndex(headers: string[], ...names: string[]) {
  const wanted = new Set(names.map(normalizedHeader));
  return headers.findIndex((header) => wanted.has(normalizedHeader(header)));
}

export function parseReceivedLogsCsv(content: string): ReceivedLogInput[] {
  const rows = parseCsv(content);
  if (rows.length < 2) {
    throw new BadRequestException("CSV must contain a header row and at least one log row");
  }
  const headers = rows[0];
  const indexes = {
    gcCode: fieldIndex(headers, "gcCode", "GC Code"),
    logId: fieldIndex(headers, "logId", "Log ID"),
    date: fieldIndex(headers, "date", "visited"),
    type: fieldIndex(headers, "type", "logType"),
    finder: fieldIndex(headers, "finder", "userName"),
    finderCountry: fieldIndex(headers, "finderCountry", "finder_country", "country"),
    text: fieldIndex(headers, "text", "logText")
  };
  const missing = [
    ["gcCode", indexes.gcCode],
    ["date", indexes.date],
    ["finder", indexes.finder]
  ].filter(([, index]) => index === -1);
  if (missing.length > 0) {
    throw new BadRequestException(`CSV is missing required columns: ${missing.map(([name]) => name).join(", ")}`);
  }

  return rows.slice(1).map((row) => ({
    gcCode: row[indexes.gcCode],
    logId: indexes.logId === -1 ? null : row[indexes.logId],
    date: row[indexes.date],
    type: indexes.type === -1 ? "Found it" : row[indexes.type],
    finder: row[indexes.finder],
    finderCountry: indexes.finderCountry === -1 ? null : row[indexes.finderCountry],
    text: indexes.text === -1 ? "" : row[indexes.text]
  }));
}

export function normalizeFinderCountryRows(rows: FinderCountryInput[] | undefined): Array<{ country: string; count: number }> {
  if (!Array.isArray(rows)) {
    throw new BadRequestException("rows must be an array");
  }
  const byCountry = new Map<string, number>();
  for (const row of rows) {
    const country = normalizeCountry(row.country);
    const count = Number(row.count);
    if (!country || !Number.isInteger(count) || count < 1) {
      throw new BadRequestException("rows must contain country and positive integer count");
    }
    byCountry.set(country, (byCountry.get(country) ?? 0) + count);
  }
  return [...byCountry.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
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
  private readonly logger = new Logger(CollectorController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
    private readonly collectorTokenAuth?: CollectorTokenAuthService
  ) {}

  private async tokenUser(authorization: string | undefined) {
    if (this.collectorTokenAuth) return this.collectorTokenAuth.userId(authorization);
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new UnauthorizedException("Missing collector bearer token");
    const found = await this.prisma.collectorToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { id: true, userId: true }
    });
    if (!found) throw new UnauthorizedException("Invalid collector token");
    await this.prisma.collectorToken.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
    return found.userId;
  }

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

  @Get("project-gc.ps1")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "no-store")
  projectGcPowerShell(@Req() request: any) {
    return projectGcRunnerScript(trustedBaseUrl(request));
  }

  @Get("project-gc.ts")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "no-store")
  projectGcSource() {
    if (!existsSync(PROJECT_GC_SOURCE_PATH)) {
      throw new NotFoundException("Project-GC collector source is not available in this deployment.");
    }
    return readFileSync(PROJECT_GC_SOURCE_PATH, "utf8");
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
        const logs = cacheLogs(hide.receivedLogsRaw);
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

  @Get("project-gc-profile")
  async projectGcProfile(@Headers("authorization") authorization?: string) {
    const userId = await this.tokenUser(authorization);
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
    if (!profile?.gcUsername?.trim()) {
      throw new BadRequestException("Set a Geocaching username in Profile first");
    }
    return { gcUsername: profile.gcUsername };
  }

  @Post("received-logs")
  async receivedLogs(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { logs?: ReceivedLogInput[]; caches?: ReceivedCacheInput[] }
  ) {
    const userId = await this.tokenUser(authorization);
    return this.importReceivedLogsForUser(userId, body);
  }

  @Post("project-gc/finder-countries")
  async projectGcFinderCountries(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { rows?: FinderCountryInput[] }
  ) {
    const userId = await this.tokenUser(authorization);
    const rows = normalizeFinderCountryRows(body.rows);
    if (rows.length === 0) {
      throw new BadRequestException("No finder-country rows found");
    }
    if (rows.length > 250) {
      throw new BadRequestException("Too many finder-country rows");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ownerFinderCountryStat.deleteMany({ where: { userId } });
      await tx.ownerFinderCountryStat.createMany({
        data: rows.map((row) => ({
          userId,
          country: row.country,
          count: row.count
        }))
      });
      await tx.statSnapshot.deleteMany({ where: { userId } });
    });
    return { rows };
  }

  @Post("received-logs/csv")
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: COLLECTOR_CSV_MAX_BYTES } }))
  async receivedLogsCsv(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Upload a CSV file using the file field");
    }
    if (!file.originalname.toLowerCase().endsWith(".csv") || !COLLECTOR_CSV_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Only CSV files are supported for owner log imports");
    }
    const logs = parseReceivedLogsCsv(file.buffer.toString("utf8"));
    return this.importReceivedLogsForUser(user.id, { logs });
  }

  private async importReceivedLogsForUser(userId: string, body: { logs?: ReceivedLogInput[]; caches?: ReceivedCacheInput[] }) {
    const logs = body.logs ?? [];
    if (!Array.isArray(logs)) {
      throw new BadRequestException("logs must be an array");
    }
    const byCode = new Map<string, Array<Record<string, any>>>();
    for (const log of logs) {
      const normalized = rawFromInput(log);
      byCode.set(normalized.gcCode, [...(byCode.get(normalized.gcCode) ?? []), normalized.raw]);
    }
    const caches = body.caches ?? [];
    if (!Array.isArray(caches)) {
      throw new BadRequestException("caches must be an array");
    }
    const cacheTotals = new Map(caches.map(normalizedCacheInput).map((cache) => [cache.gcCode, cache.favoritePoints]));
    const codes = Array.from(new Set([...byCode.keys(), ...cacheTotals.keys()]));
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
      for (const gcCode of codes) {
        const cacheLogsToAdd = byCode.get(gcCode) ?? [];
        const hide = hidesByCode.get(gcCode);
        if (!hide) {
          continue;
        }
        const current = await tx.hide.findFirst({
          where: { id: hide.id, userId },
          include: { cache: true }
        });
        if (!current) {
          throw new BadRequestException(`Unknown owned caches: ${gcCode}`);
        }
        const merged = mergedRaw(current.receivedLogsRaw, cacheLogsToAdd);
        const logsChanged = merged.added > 0 || current.receivedLogCount !== merged.receivedLogCount;
        const favoriteTotal = cacheTotals.get(gcCode);
        const cacheRoot = rawObject(current.cache.raw);
        const currentFavoriteText = rawText(
          rawObject(cacheRoot["groundspeak:cache"] ?? cacheRoot.cache)["groundspeak:favorite_points"]
        );
        const currentFavoriteTotal = currentFavoriteText === null ? null : Number(currentFavoriteText);
        const favoriteChanged = favoriteTotal !== undefined && currentFavoriteTotal !== favoriteTotal;
        if (logsChanged) {
          const updated = await tx.hide.updateMany({
            where: { id: current.id, userId, updatedAt: current.updatedAt },
            data: {
              receivedLogCount: merged.receivedLogCount,
              receivedLogsRaw: merged.raw as Prisma.InputJsonValue
            }
          });
          if (updated.count !== 1) {
            throw new ConflictException(`Hide changed while receiving logs: ${gcCode}`);
          }
        }
        if (favoriteChanged) {
          const updated = await tx.cache.updateMany({
            where: { id: current.cache.id, updatedAt: current.cache.updatedAt },
            data: { raw: rawWithFavoritePoints(current.cache.raw, favoriteTotal) as Prisma.InputJsonValue }
          });
          if (updated.count !== 1) {
            throw new ConflictException(`Cache changed while receiving favorite points: ${gcCode}`);
          }
        }
        added += merged.added;
        if (logsChanged || favoriteChanged) {
          changedCaches += 1;
        }
      }
    });
    if (changedCaches > 0) {
      try {
        const stats = await this.stats.buildSnapshotForUser(userId);
        await this.prisma.$transaction((tx) => this.stats.replaceSnapshotForUser(userId, stats, tx));
      } catch (error) {
        this.logger.error(`Stats rebuild failed after received-log import for user ${userId}`, error);
      }
    }
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
