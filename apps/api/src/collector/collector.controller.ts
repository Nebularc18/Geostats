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
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvRows, AuthUser } from "@geostats/shared";
import { Prisma } from "@geostats/db";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthService } from "../auth/auth.service";
import { AdminGuard } from "../admin/admin.guard";
import { normalizeCountry } from "../common/geocaching.utils";
import { PrismaService } from "../common/prisma.service";
import { StatsService } from "../stats/stats.service";
import { CollectorTokenAuthService } from "./collector-token-auth.service";
import { GsakImportService } from "./gsak-import.service";

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
const COLLECTOR_SOURCE_PATH = resolve(
  process.cwd(),
  "apps/tools/src/collect-owner-logs.ts",
);
const PROJECT_GC_SOURCE_PATH = resolve(
  process.cwd(),
  "apps/tools/src/collect-project-gc-finder-countries.ts",
);
const COLLECTOR_CSV_MAX_BYTES = 10_485_760;
const COLLECTOR_CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "text/plain",
]);
const GSAK_IMPORT_SCOPE = "GSAK_IMPORT";
const GSAK_ADMIN_IMPORT_SCOPE = "GSAK_ADMIN_IMPORT";

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken() {
  return `${TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

function tokenCipherKey() {
  const secret = process.env.COLLECTOR_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "COLLECTOR_TOKEN_ENCRYPTION_KEY is required to encrypt collector tokens",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenCipherKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
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
    const decipher = createDecipheriv(
      "aes-256-gcm",
      tokenCipherKey(),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
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
  const proto =
    firstHeader(request.headers?.["x-forwarded-proto"]) ??
    request.protocol ??
    "http";
  const host =
    firstHeader(request.headers?.["x-forwarded-host"]) ??
    firstHeader(request.headers?.host) ??
    `localhost:${process.env.API_PORT ?? "3001"}`;
  return `${proto}://${host}`.replace(/\/$/, "");
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function gsakImportBaseUrl(request: any) {
  const configured = process.env.GSAK_IMPORT_ORIGIN?.trim();
  if (!configured) return trustedBaseUrl(request);

  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GSAK_IMPORT_ORIGIN must be an http or https URL");
  }
  return url.toString().replace(/\/$/, "");
}

function gsakString(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function gsakImportMacro(serverUrl: string, token: string) {
  const server = gsakString(serverUrl);
  const credential = gsakString(token);
  return `# MacDescription = Send found, owned, and trackable journey caches from GSAK to Geostats
# MacVersion = 1.9
# NoVersionCheck

$server = ${server}
$token = ${credential}
$endpoint = $server + "/collector/gsak/import"
$cacheBatchSize = 50
$logBatchSize = 25
$cacheFilter = "(ifnull(FoundByMeDate,'') <> '' or IsOwner = 1 or Code in (select GeocacheCode from GeostatsTrackableCodes))"
$logFilter = "(c.IsOwner = 1)"

# Make GSAK use the active Geocaching account when identifying finds and hides.
ShowStatus msg="Checking the active Geocaching account..."
GcUpdateUserInfo UpdateHome=N UpdateMatching=Y
$currentUser = SysInfo("CurrentUser")
If IsEmpty($currentUser)
  Cancel Msg="GSAK is not connected to a Geocaching account. Use Geocaching.com access > Get another access token, then run this macro again."
EndIf

# Settings used when a missing found cache is loaded by GC code.
<data> VarName=$geostatsCodeSettings
[GcGeocaches]
cbxDifMax.Text=5.0
cbxDifMin.Text=1.0
cbxLoadSettings.Text=* Use GSAK defaults *
cbxTerMax.Text=5.0
cbxTerMin.Text=1.0
chkArchived.Checked=True
chkFoundByMe.Checked=True
chkLarge.Checked=True
chkMicro.Checked=True
chkNotChosen.Checked=True
chkOther.Checked=True
chkPremium.Checked=True
chkRegular.Checked=True
chkSmall.Checked=True
chkVirtual.Checked=True
edtHiddenBy.Text=
edtLogsPerCache.Text=30
edtMax.Text=10000
edtNotFoundBy.Text=
rbtFull.Checked=True
rbtLite.Checked=False
cbxref.Text=
edtDistance.Text=
d1.Checked=True
d2.Checked=False
edtNotHiddenBy.Text=
edtbbBottom.Text=
rbtRectangle.Checked=False
rbtCircle.Checked=False
edtbbtop.Text=
edtFavmin.Text=0
edtFavMax.Text=99999
rbtCode.Checked=True
cbxPublishDate.Text=Not applicable
edtDuringDays.Text=
rbtCtyState.Checked=False
rbtCountry.Checked=False
rbtNone.Checked=True
rbtState.Checked=False
edtSaveCountry.Text=
edtSaveState.Text=
edtCountry.Text=
edtState.Text=
edtProvince.Text=
rbtOther.Checked=False
edtName.Text=
cbxSort.Text=Cache id ascending
edtSkip.Text=0
cbxCountry.Text=
cbxState.Text=0
NotCacheTypes=
cbxsort=0
edtPublishFrom=1899-12-30
edtPublishTo=1899-12-30
edtCodes.Text=
<enddata>
MacroSet Dialog=GcGeocaches VarName=$geostatsCodeSettings Name=<macro>

# Trackable imports can contain cache coordinates before the matching cache
# record exists in GSAK. Ask Geostats for those codes in small pages, load them
# through GcGetCaches, and include them in the cache export below.
$result = Sqlite("sql","drop table if exists GeostatsTrackableCodes")
$result = Sqlite("sql","create temp table GeostatsTrackableCodes (GeocacheCode text primary key)")
$journeySkip = 0
$journeyTake = 500
$journeyTotal = 1
ShowStatus msg="Loading trackable journey caches..."
While $journeySkip < $journeyTotal
  $post = "'token'," + SqlQuote($token) + ",'kind','trackable-codes','skip'," + NumToStr($journeySkip) + ",'take'," + NumToStr($journeyTake)
  $result = PostUrl($endpoint,$post,"Loading journey cache codes",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  $journeyTotal = Val(RegExSub($_Quote + "total" + $_Quote + ":[ ]*(\\d+)",$result,1,1))
  $journeyCodes = RegExSub($_Quote + "codes" + $_Quote + ":[ ]*" + $_Quote + "([^" + $_Quote + "]*)" + $_Quote,$result,1,1)
  If not(IsEmpty($journeyCodes))
    $journeyValues = "('" + Replace($journeyCodes,",","'),('") + "')"
    $result = Sqlite("sql","insert or ignore into GeostatsTrackableCodes values " + $journeyValues)
    GcGetCaches Settings=<macro> GcCodes=$journeyCodes Load=Y ShowSummary=No
  EndIf
  $journeySkip = $journeySkip + $journeyTake
EndWhile

# Get every found, attended, and webcam log from the active account. Cache
# records missing from this GSAK database are loaded during this pass; all
# relevant cache records are refreshed before the export below.
$result = Sqlite("sql","drop table if exists GeostatsUserLogs")
$result = Sqlite("sql","create temp table GeostatsUserLogs (ReferenceCode text, GeocacheCode text, LoggedDate text, Text text, Type text)")
$apiSkip = 0
$apiTake = 50
$apiTotal = 1
ShowStatus msg="Finding missing caches in GSAK..."
While $apiSkip < $apiTotal
  $apiPath = "users/me/geocachelogs?logTypes=2,10,11&skip=" + NumToStr($apiSkip) + "&take=" + NumToStr($apiTake) + "&fields=referenceCode,geocacheCode,loggedDate,text,type"
  $apiResult = GcApi2($apiPath)
  If Left($apiResult,7) = "*Error*"
    Cancel Msg=$apiResult
  EndIf
  If $apiSkip = 0
    $apiTotal = Val(RegExSub("x-total-count: (\\d+)",$_GcApi2Header,1,1))
  EndIf
  $result = Sqlite("sql","insert into GeostatsUserLogs select ReferenceCode, GeocacheCode, LoggedDate, Text, Type from ApiMaster")
  $missingCodes = Sqlite("sql","select group_concat(distinct a.GeocacheCode) from ApiMaster a where not exists (select 1 from Caches c where c.Code = a.GeocacheCode)")
  If not(IsEmpty($missingCodes))
    GcGetCaches Settings=<macro> GcCodes=$missingCodes Load=Y ShowSummary=No
  EndIf
  $apiSkip = $apiSkip + $apiTake
EndWhile

# Load every cache placed by the active account. This also repairs ownership in
# a GSAK database that did not already contain all of the user's hides.
$geostatsOwnedSettings = Replace("edtHiddenBy.Text=","edtHiddenBy.Text=" + $currentUser,$geostatsCodeSettings)
$geostatsOwnedSettings = Replace("rbtCode.Checked=True","rbtCode.Checked=False",$geostatsOwnedSettings)
$geostatsOwnedSettings = Replace("rbtOther.Checked=False","rbtOther.Checked=True",$geostatsOwnedSettings)
MacroSet Dialog=GcGeocaches VarName=$geostatsOwnedSettings Name=<macro>
ShowStatus msg="Finding caches you have placed..."
GcGetCaches Settings=<macro> Load=Y ShowSummary=No

# Correct GSAK's own found flags and dates from the authoritative account logs.
# New caches were just loaded above with full details (GcGetCaches), so only
# those need a full refresh. Refreshing every found cache each run takes hours
# on large databases and exhausts the daily Full quota, so existing caches keep
# their stored details; statuses are updated lightly below.
$result = Sqlite("sql","update Caches set Found=1, FoundByMeDate=(select substr(max(g.LoggedDate),1,10) from GeostatsUserLogs g where g.GeocacheCode=Caches.Code) where Code in (select GeocacheCode from GeostatsUserLogs)")
ReSync

# Update statuses for all relevant caches and collect new logs on owned caches.
# GcStatusCheck is lightweight compared to a full GcRefresh, so it still runs
# over the whole found/owned filter to keep archived/disabled flags fresh.
MFilter Expression=$d_Found OR IsOwner()
If $_FilterCount > 0
  ShowStatus msg="Updating cache statuses in GSAK..."
  GcStatusCheck Scope=Filter ShowSummary=N
EndIf
MFilter Expression=IsOwner()
If $_FilterCount > 0
  ShowStatus msg="Updating logs for your placed caches..."
  GcGetLogs Scope=Filter Type=Newer ShowSummary=N
EndIf
MFilter Expression=$d_Found OR IsOwner()

ShowStatus msg="Sending caches to Geostats..."
$total = Val(Sqlite("sql","select count(*) from Caches where " + $cacheFilter))
$offset = 0
While $offset < $total
  $sql = "select Code as gcCode, Name as name, g_CacheType(CacheType) as cacheType, Difficulty as difficulty, Terrain as terrain, Container as size, case when HasCorrected = 1 and LatOriginal not in ('','0.0') then LatOriginal else Latitude end as latitude, case when HasCorrected = 1 and LonOriginal not in ('','0.0') then LonOriginal else Longitude end as longitude, Country as country, State as region, County as county, PlacedDate as hiddenDate, OwnerName as ownerName, FoundByMeDate as foundDate, FTF as isFtf, IsOwner as isOwner, FavPoints as favoritePoints, Elevation as elevationMeters, Status as status, IsPremium as isPremium, Latitude as correctedLatitude, Longitude as correctedLongitude, HasCorrected as hasCorrected, ifnull((select UserNote from CacheMemo where CacheMemo.Code = Caches.Code),'') as userNote, ifnull((select group_concat(aId || ':' || aInc,'|') from Attributes where Attributes.aCode = Caches.Code),'') as attributes from Caches where " + $cacheFilter + " order by Code limit " + NumToStr($cacheBatchSize) + " offset " + NumToStr($offset)
  $csv = Sqlite("sql",$sql,"Delim=*csv* Headings=Yes")
  $post = "'token'," + SqlQuote($token) + ",'kind','caches','csv'," + SqlQuote($csv)
  $result = PostUrl($endpoint,$post,"Sending cache data",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  If not(At($_Quote + "caches" + $_Quote + ":",$result) > 0)
    Pause Msg="Geostats rejected the cache batch:" + $_NewLine + $result
    Cancel
  EndIf
  $offset = $offset + $cacheBatchSize
EndWhile

ShowStatus msg="Sending logs from your placed caches to Geostats..."
$total = Val(Sqlite("sql","select count(*) from LogsAll l join Caches c on c.Code = l.lParent where " + $logFilter))
$offset = 0
While $offset < $total
  $sql = "select l.lParent as gcCode, l.lLogId as logId, l.lType as type, l.lBy as finder, l.lDate as date, l.lTime as time, l.lLat as latitude, l.lLon as longitude, l.lOwnerId as ownerId, l.lIsOwner as isOwnLog, l.lText as text, c.IsOwner as cacheIsOwned from LogsAll l join Caches c on c.Code = l.lParent where " + $logFilter + " order by l.lParent, l.lDate, l.lTime, l.lLogId limit " + NumToStr($logBatchSize) + " offset " + NumToStr($offset)
  $csv = Sqlite("sql",$sql,"Delim=*csv* Headings=Yes")
  $post = "'token'," + SqlQuote($token) + ",'kind','logs','csv'," + SqlQuote($csv)
  $result = PostUrl($endpoint,$post,"Sending log data",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  If not(At($_Quote + "logs" + $_Quote + ":",$result) > 0)
    Pause Msg="Geostats rejected the placed-cache log batch:" + $_NewLine + $result
    Cancel
  EndIf
  $offset = $offset + $logBatchSize
EndWhile

# Send the account logs as well. This covers older finds whose personal log is
# no longer among the recent logs attached to the cache in GSAK.
ShowStatus msg="Sending account logs to Geostats..."
$total = Val(Sqlite("sql","select count(*) from GeostatsUserLogs"))
$offset = 0
While $offset < $total
  $sql = "select g.GeocacheCode as gcCode, g.ReferenceCode as logId, g.Type as type, " + SqlQuote($currentUser) + " as finder, substr(g.LoggedDate,1,10) as date, '' as time, '' as latitude, '' as longitude, '' as ownerId, 1 as isOwnLog, ifnull(g.Text,'') as text, c.IsOwner as cacheIsOwned from GeostatsUserLogs g join Caches c on c.Code = g.GeocacheCode order by g.LoggedDate, g.ReferenceCode limit " + NumToStr($logBatchSize) + " offset " + NumToStr($offset)
  $csv = Sqlite("sql",$sql,"Delim=*csv* Headings=Yes")
  $post = "'token'," + SqlQuote($token) + ",'kind','logs','csv'," + SqlQuote($csv)
  $result = PostUrl($endpoint,$post,"Sending account logs",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  If not(At($_Quote + "logs" + $_Quote + ":",$result) > 0)
    Pause Msg="Geostats rejected the account-log batch:" + $_NewLine + $result
    Cancel
  EndIf
  $offset = $offset + $logBatchSize
EndWhile

ShowStatus msg="Finishing Geostats import..."
$post = "'token'," + SqlQuote($token) + ",'kind','complete'"
$result = PostUrl($endpoint,$post,"Finishing import",120)
If Left($result,7) = "*Error*"
  Pause Msg=$result
  Cancel
EndIf
If not(At($_Quote + "completed" + $_Quote + ":true",$result) > 0)
  Pause Msg="Geostats did not complete the import:" + $_NewLine + $result
  Cancel
EndIf

ShowStatus msg=""
MsgOk Msg="GSAK data was sent to Geostats successfully."
`;
}

export function gsakMissingCacheMacro(serverUrl: string, token: string) {
  const server = gsakString(serverUrl);
  const credential = gsakString(token);
  return `# MacDescription = Import missing cache metadata from GSAK to Geostats
# MacVersion = 1.8
# NoVersionCheck

$server = ${server}
$token = ${credential}
$endpoint = $server + "/collector/gsak/import"
$cacheBatchSize = 50
$missingSkip = 0
$missingTake = 500
$missingTotal = 1

# Settings used when a missing cache is loaded by GC code.
<data> VarName=$geostatsCodeSettings
[GcGeocaches]
cbxDifMax.Text=5.0
cbxDifMin.Text=1.0
cbxLoadSettings.Text=* Use GSAK defaults *
cbxTerMax.Text=5.0
cbxTerMin.Text=1.0
chkArchived.Checked=True
chkFoundByMe.Checked=True
chkLarge.Checked=True
chkMicro.Checked=True
chkNotChosen.Checked=True
chkOther.Checked=True
chkPremium.Checked=True
chkRegular.Checked=True
chkSmall.Checked=True
chkVirtual.Checked=True
edtHiddenBy.Text=
edtLogsPerCache.Text=30
edtMax.Text=10000
edtNotFoundBy.Text=
rbtFull.Checked=True
rbtLite.Checked=False
cbxref.Text=
edtDistance.Text=
d1.Checked=True
d2.Checked=False
edtNotHiddenBy.Text=
edtbbBottom.Text=
rbtRectangle.Checked=False
rbtCircle.Checked=False
edtbbtop.Text=
edtFavmin.Text=0
edtFavMax.Text=99999
rbtCode.Checked=True
cbxPublishDate.Text=Not applicable
edtDuringDays.Text=
rbtCtyState.Checked=False
rbtCountry.Checked=False
rbtNone.Checked=True
rbtState.Checked=False
edtSaveCountry.Text=
edtSaveState.Text=
edtCountry.Text=
edtState.Text=
edtProvince.Text=
rbtOther.Checked=False
edtName.Text=
cbxSort.Text=Cache id ascending
edtSkip.Text=0
cbxCountry.Text=
cbxState.Text=0
NotCacheTypes=
cbxsort=0
edtPublishFrom=1899-12-30
edtPublishTo=1899-12-30
edtCodes.Text=
<enddata>
MacroSet Dialog=GcGeocaches VarName=$geostatsCodeSettings Name=<macro>

# Ask Geostats for the current unresolved codes. The endpoint is scoped to the
# admin token and returns only codes referenced by mysteries, checkers, or
# unlinked trackable journey logs.
$result = Sqlite("sql","drop table if exists GeostatsMissingCodes")
$result = Sqlite("sql","create temp table GeostatsMissingCodes (GeocacheCode text primary key)")
ShowStatus msg="Finding missing cache records..."
While $missingSkip < $missingTotal
  $post = "'token'," + SqlQuote($token) + ",'kind','admin-missing-codes','skip'," + NumToStr($missingSkip) + ",'take'," + NumToStr($missingTake)
  $result = PostUrl($endpoint,$post,"Finding missing cache records",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  $missingTotal = Val(RegExSub($_Quote + "total" + $_Quote + ":[ ]*(\\d+)",$result,1,1))
  $missingCodes = RegExSub($_Quote + "codes" + $_Quote + ":[ ]*" + $_Quote + "([^" + $_Quote + "]*)" + $_Quote,$result,1,1)
  If not(IsEmpty($missingCodes))
    $missingValues = "('" + Replace($missingCodes,",","'),('") + "')"
    $result = Sqlite("sql","insert or ignore into GeostatsMissingCodes values " + $missingValues)
    GcGetCaches Settings=<macro> GcCodes=$missingCodes Load=Y ShowSummary=No
  EndIf
  $missingSkip = $missingSkip + $missingTake
EndWhile

If $missingTotal = 0
  ShowStatus msg=""
  MsgOk Msg="No missing cache records need importing."
  Cancel
EndIf

# Export only the codes Geostats requested. This connector never sends finds,
# hides, notes, or logs; the admin endpoint stores shared cache metadata only.
ShowStatus msg="Sending missing cache metadata to Geostats..."
$cacheFilter = "Code in (select GeocacheCode from GeostatsMissingCodes)"
$total = Val(Sqlite("sql","select count(*) from Caches where " + $cacheFilter))
If $total = 0
  Pause Msg="GSAK could not load any of the missing cache codes. Check the active Geocaching.com connection and run the connector again."
  Cancel
EndIf
$offset = 0
While $offset < $total
  $sql = "select Code as gcCode, Name as name, g_CacheType(CacheType) as cacheType, Difficulty as difficulty, Terrain as terrain, Container as size, case when HasCorrected = 1 and LatOriginal not in ('','0.0') then LatOriginal else Latitude end as latitude, case when HasCorrected = 1 and LonOriginal not in ('','0.0') then LonOriginal else Longitude end as longitude, Country as country, State as region, County as county, PlacedDate as hiddenDate, OwnerName as ownerName, FoundByMeDate as foundDate, FTF as isFtf, IsOwner as isOwner, FavPoints as favoritePoints, Elevation as elevationMeters, Status as status, IsPremium as isPremium, Latitude as correctedLatitude, Longitude as correctedLongitude, HasCorrected as hasCorrected, ifnull((select UserNote from CacheMemo where CacheMemo.Code = Caches.Code),'') as userNote, ifnull((select group_concat(aId || ':' || aInc,'|') from Attributes where Attributes.aCode = Caches.Code),'') as attributes from Caches where " + $cacheFilter + " order by Code limit " + NumToStr($cacheBatchSize) + " offset " + NumToStr($offset)
  $csv = Sqlite("sql",$sql,"Delim=*csv* Headings=Yes")
  $post = "'token'," + SqlQuote($token) + ",'kind','admin-caches','csv'," + SqlQuote($csv)
  $result = PostUrl($endpoint,$post,"Sending missing cache data",120)
  If Left($result,7) = "*Error*"
    Pause Msg=$result
    Cancel
  EndIf
  If not(At($_Quote + "caches" + $_Quote + ":",$result) > 0)
    Pause Msg="Geostats rejected the missing cache batch:" + $_NewLine + $result
    Cancel
  EndIf
  $offset = $offset + $cacheBatchSize
EndWhile

ShowStatus msg=""
MsgOk Msg="Missing cache data was imported from GSAK. Refresh the Geostats admin page to see what remains."
`;
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, any>) }
    : {};
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
    if (
      value &&
      typeof value === "object" &&
      "text" in value &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text.trim();
    }
  }
  return null;
}

export function cacheLogs(raw: unknown): Array<Record<string, any>> {
  const root = rawObject(raw);
  const extension = rawObject(root["groundspeak:cache"] ?? root.cache);
  return rawArray<Record<string, any>>(
    extension["groundspeak:logs"]?.["groundspeak:log"] ?? extension.logs?.log,
  );
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
    logTextKey(rawText(log["groundspeak:text"], log.text)),
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u001f");
}

function normalizeDate(value: string | undefined) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException("date is required");
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : new Date(text);
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
    "groundspeak:text": log.text?.trim() ?? "",
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
  if (
    !Number.isSafeInteger(cache.favoritePoints) ||
    Number(cache.favoritePoints) < 0
  ) {
    throw new BadRequestException(
      "favoritePoints must be a non-negative integer",
    );
  }
  return { gcCode, favoritePoints: Number(cache.favoritePoints) };
}

export function rawWithFavoritePoints(raw: unknown, favoritePoints: number) {
  const root = rawObject(raw);
  const cacheKey =
    root["groundspeak:cache"] !== undefined || root.cache === undefined
      ? "groundspeak:cache"
      : "cache";
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
      "groundspeak:favorite_points": String(favoritePoints),
    },
  };
}

function countReceivedLogs(logs: Array<Record<string, any>>) {
  return logs.filter(
    (log) =>
      rawText(log["groundspeak:type"], log.type)?.toLowerCase() !==
      "publish listing",
  ).length;
}

function parseCsv(text: string): string[][] {
  try {
    return parseCsvRows(text).filter((row) => row.some((value) => value.trim()));
  } catch {
    throw new BadRequestException("CSV contains an unclosed quoted field");
  }
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
    throw new BadRequestException(
      "CSV must contain a header row and at least one log row",
    );
  }
  const headers = rows[0];
  const indexes = {
    gcCode: fieldIndex(headers, "gcCode", "GC Code"),
    logId: fieldIndex(headers, "logId", "Log ID"),
    date: fieldIndex(headers, "date", "visited"),
    type: fieldIndex(headers, "type", "logType"),
    finder: fieldIndex(headers, "finder", "userName"),
    finderCountry: fieldIndex(
      headers,
      "finderCountry",
      "finder_country",
      "country",
    ),
    text: fieldIndex(headers, "text", "logText"),
  };
  const missing = [
    ["gcCode", indexes.gcCode],
    ["date", indexes.date],
    ["finder", indexes.finder],
  ].filter(([, index]) => index === -1);
  if (missing.length > 0) {
    throw new BadRequestException(
      `CSV is missing required columns: ${missing.map(([name]) => name).join(", ")}`,
    );
  }

  return rows.slice(1).map((row) => ({
    gcCode: row[indexes.gcCode],
    logId: indexes.logId === -1 ? null : row[indexes.logId],
    date: row[indexes.date],
    type: indexes.type === -1 ? "Found it" : row[indexes.type],
    finder: row[indexes.finder],
    finderCountry:
      indexes.finderCountry === -1 ? null : row[indexes.finderCountry],
    text: indexes.text === -1 ? "" : row[indexes.text],
  }));
}

export function normalizeFinderCountryRows(
  rows: FinderCountryInput[] | undefined,
): Array<{ country: string; count: number }> {
  if (!Array.isArray(rows)) {
    throw new BadRequestException("rows must be an array");
  }
  const byCountry = new Map<string, number>();
  for (const row of rows) {
    const country = normalizeCountry(row.country);
    const count = Number(row.count);
    if (!country || !Number.isInteger(count) || count < 1) {
      throw new BadRequestException(
        "rows must contain country and positive integer count",
      );
    }
    byCountry.set(country, (byCountry.get(country) ?? 0) + count);
  }
  return [...byCountry.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

export function mergedRaw(raw: unknown, newLogs: Array<Record<string, any>>) {
  const root = rawObject(raw);
  const cacheKey =
    root["groundspeak:cache"] !== undefined || root.cache === undefined
      ? "groundspeak:cache"
      : "cache";
  const extension = rawObject(root[cacheKey]);
  const logsKey =
    extension["groundspeak:logs"] !== undefined || extension.logs === undefined
      ? "groundspeak:logs"
      : "logs";
  const logKeyName = logsKey === "groundspeak:logs" ? "groundspeak:log" : "log";
  const existingLogs = cacheLogs(raw);
  const mergedLogs = [...existingLogs];
  const seenIds = new Set(
    existingLogs.map(logId).filter((value): value is string => Boolean(value)),
  );
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
          [logKeyName]: mergedLogs,
        },
      },
    },
  };
}

@Controller("collector")
export class CollectorController {
  private readonly logger = new Logger(CollectorController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
    private readonly collectorTokenAuth?: CollectorTokenAuthService,
    private readonly gsakImporter?: GsakImportService,
    private readonly auth?: AuthService,
  ) {}

  private async tokenUser(
    authorization: string | undefined,
    requiredScope = "FULL",
  ) {
    if (this.collectorTokenAuth)
      return this.collectorTokenAuth.userId(authorization, requiredScope);
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token)
      throw new UnauthorizedException("Missing collector bearer token");
    return this.tokenUserValue(token, requiredScope);
  }

  private async tokenUserValue(token: string, requiredScope = "FULL") {
    if (this.collectorTokenAuth)
      return this.collectorTokenAuth.userIdForToken(token, requiredScope);
    const found = await this.prisma.collectorToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { id: true, userId: true, scope: true },
    });
    if (!found) throw new UnauthorizedException("Invalid collector token");
    if ((found.scope ?? "FULL") !== requiredScope)
      throw new UnauthorizedException(
        "Collector token does not allow this operation",
      );
    await this.prisma.collectorToken.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    });
    return found.userId;
  }

  private async assertAdminCollectorUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user || !this.auth?.isAdmin(user)) {
      throw new UnauthorizedException(
        "Admin GSAK import token is no longer authorized",
      );
    }
  }

  @Post("gsak/setup")
  @UseGuards(AuthGuard)
  async setupGsak(@CurrentUser() user: AuthUser, @Req() request: any) {
    const token = newToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.collectorToken.deleteMany({
        where: { userId: user.id, scope: GSAK_IMPORT_SCOPE },
      });
      await tx.collectorToken.create({
        data: {
          userId: user.id,
          name: "GSAK import",
          scope: GSAK_IMPORT_SCOPE,
          tokenPrefix: token.slice(0, 12),
          tokenHash: tokenHash(token),
          tokenCiphertext: encryptToken(token),
        },
      });
    });
    return {
      fileName: "GeostatsImport.gsk",
      macro: gsakImportMacro(gsakImportBaseUrl(request), token),
    };
  }

  @Post("gsak/admin-setup")
  @UseGuards(AuthGuard, AdminGuard)
  async setupAdminGsak(@CurrentUser() user: AuthUser, @Req() request: any) {
    const token = newToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.collectorToken.deleteMany({
        where: { userId: user.id, scope: GSAK_ADMIN_IMPORT_SCOPE },
      });
      await tx.collectorToken.create({
        data: {
          userId: user.id,
          name: "GSAK admin cache import",
          scope: GSAK_ADMIN_IMPORT_SCOPE,
          tokenPrefix: token.slice(0, 12),
          tokenHash: tokenHash(token),
          tokenCiphertext: encryptToken(token),
        },
      });
    });
    return {
      fileName: "GeostatsMissingCaches.gsk",
      macro: gsakMissingCacheMacro(gsakImportBaseUrl(request), token),
    };
  }

  @Get("gsak/status")
  @UseGuards(AuthGuard)
  async gsakStatus(@CurrentUser() user: AuthUser) {
    const token = await this.prisma.collectorToken.findFirst({
      where: { userId: user.id, scope: GSAK_IMPORT_SCOPE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const latestImport = token
      ? await this.prisma.import.findFirst({
          where: {
            userId: user.id,
            source: "GSAK",
            status: "COMPLETED",
            createdAt: { gte: token.createdAt },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true },
        })
      : null;
    return {
      connected: Boolean(token),
      createdAt: token?.createdAt ?? null,
      lastImportedAt: latestImport?.createdAt ?? null,
    };
  }

  @Post("gsak/import")
  async importGsak(
    @Body()
    body: {
      token?: unknown;
      kind?: unknown;
      csv?: unknown;
      skip?: unknown;
      take?: unknown;
    },
  ) {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) throw new UnauthorizedException("Missing GSAK import token");
    const adminKind =
      body.kind === "admin-missing-codes" || body.kind === "admin-caches";
    const userId = await this.tokenUserValue(
      token,
      adminKind ? GSAK_ADMIN_IMPORT_SCOPE : GSAK_IMPORT_SCOPE,
    );
    if (adminKind) await this.assertAdminCollectorUser(userId);
    if (!this.gsakImporter)
      throw new NotFoundException(
        "GSAK importer is not available in this deployment",
      );
    if (body.kind === "trackable-codes")
      return this.gsakImporter.trackableCacheCodes(
        userId,
        body.skip,
        body.take,
      );
    if (body.kind === "admin-missing-codes")
      return this.gsakImporter.adminMissingCacheCodes(body.skip, body.take);
    if (body.kind === "admin-caches")
      return this.gsakImporter.importAdminCacheBatch(body.csv);
    return this.gsakImporter.importBatch(userId, body.kind, body.csv);
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
      throw new NotFoundException(
        "Collector source is not available in this deployment.",
      );
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
      throw new NotFoundException(
        "Project-GC collector source is not available in this deployment.",
      );
    }
    return readFileSync(PROJECT_GC_SOURCE_PATH, "utf8");
  }

  @Get("owned-caches")
  async ownedCaches(@Headers("authorization") authorization?: string) {
    const userId = await this.tokenUser(authorization);
    const hides = await this.prisma.hide.findMany({
      where: { userId },
      include: { cache: true },
      orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }],
    });
    return {
      caches: hides.map((hide) => {
        const logs = cacheLogs(hide.receivedLogsRaw);
        return {
          gcCode: hide.cache.gcCode,
          name: hide.cache.name,
          receivedLogCount: hide.receivedLogCount,
          existingLogIds: logs.map(logId).filter(Boolean),
          existingLogKeys: logs.map(logKey),
        };
      }),
    };
  }

  @Get("project-gc-profile")
  async projectGcProfile(@Headers("authorization") authorization?: string) {
    const userId = await this.tokenUser(authorization);
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true },
    });
    if (!profile?.gcUsername?.trim()) {
      throw new BadRequestException(
        "Set a Geocaching username in Profile first",
      );
    }
    return { gcUsername: profile.gcUsername };
  }

  @Post("received-logs")
  async receivedLogs(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { logs?: ReceivedLogInput[]; caches?: ReceivedCacheInput[] },
  ) {
    const userId = await this.tokenUser(authorization);
    return this.importReceivedLogsForUser(userId, body);
  }

  @Post("project-gc/finder-countries")
  async projectGcFinderCountries(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { rows?: FinderCountryInput[] },
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
          count: row.count,
        })),
      });
      await tx.statSnapshot.deleteMany({ where: { userId } });
    });
    return { rows };
  }

  @Post("received-logs/csv")
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: COLLECTOR_CSV_MAX_BYTES } }),
  )
  async receivedLogsCsv(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("Upload a CSV file using the file field");
    }
    if (
      !file.originalname.toLowerCase().endsWith(".csv") ||
      !COLLECTOR_CSV_MIME_TYPES.has(file.mimetype)
    ) {
      throw new BadRequestException(
        "Only CSV files are supported for owner log imports",
      );
    }
    const logs = parseReceivedLogsCsv(file.buffer.toString("utf8"));
    return this.importReceivedLogsForUser(user.id, { logs });
  }

  private async importReceivedLogsForUser(
    userId: string,
    body: { logs?: ReceivedLogInput[]; caches?: ReceivedCacheInput[] },
  ) {
    const logs = body.logs ?? [];
    if (!Array.isArray(logs)) {
      throw new BadRequestException("logs must be an array");
    }
    const byCode = new Map<string, Array<Record<string, any>>>();
    for (const log of logs) {
      const normalized = rawFromInput(log);
      byCode.set(normalized.gcCode, [
        ...(byCode.get(normalized.gcCode) ?? []),
        normalized.raw,
      ]);
    }
    const caches = body.caches ?? [];
    if (!Array.isArray(caches)) {
      throw new BadRequestException("caches must be an array");
    }
    const cacheTotals = new Map(
      caches
        .map(normalizedCacheInput)
        .map((cache) => [cache.gcCode, cache.favoritePoints]),
    );
    const codes = Array.from(
      new Set([...byCode.keys(), ...cacheTotals.keys()]),
    );
    const hides = await this.prisma.hide.findMany({
      where: { userId, cache: { gcCode: { in: codes } } },
      include: {
        cache: { include: { userData: { where: { userId }, take: 1 } } },
      },
    });
    const hidesByCode = new Map(hides.map((hide) => [hide.cache.gcCode, hide]));
    const missing = codes.filter((code) => !hidesByCode.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown owned caches: ${missing.join(", ")}`,
      );
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
          include: {
            cache: { include: { userData: { where: { userId }, take: 1 } } },
          },
        });
        if (!current) {
          throw new BadRequestException(`Unknown owned caches: ${gcCode}`);
        }
        const merged = mergedRaw(current.receivedLogsRaw, cacheLogsToAdd);
        const logsChanged =
          merged.added > 0 ||
          current.receivedLogCount !== merged.receivedLogCount;
        const favoriteTotal = cacheTotals.get(gcCode);
        const currentUserCacheData = current.cache.userData?.[0];
        const cacheRoot = rawObject(currentUserCacheData?.raw);
        const currentFavoriteText = rawText(
          rawObject(cacheRoot["groundspeak:cache"] ?? cacheRoot.cache)[
            "groundspeak:favorite_points"
          ],
        );
        const currentFavoriteTotal =
          currentFavoriteText === null ? null : Number(currentFavoriteText);
        const favoriteChanged =
          favoriteTotal !== undefined && currentFavoriteTotal !== favoriteTotal;
        if (logsChanged) {
          const updated = await tx.hide.updateMany({
            where: { id: current.id, userId, updatedAt: current.updatedAt },
            data: {
              receivedLogCount: merged.receivedLogCount,
              receivedLogsRaw: merged.raw as Prisma.InputJsonValue,
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException(
              `Hide changed while receiving logs: ${gcCode}`,
            );
          }
        }
        if (favoriteChanged) {
          const raw = rawWithFavoritePoints(
            currentUserCacheData?.raw,
            favoriteTotal,
          ) as Prisma.InputJsonValue;
          if (currentUserCacheData) {
            const updated = await tx.userCacheData.updateMany({
              where: {
                id: currentUserCacheData.id,
                userId,
                updatedAt: currentUserCacheData.updatedAt,
              },
              data: { raw },
            });
            if (updated.count !== 1) {
              throw new ConflictException(
                `Cache data changed while receiving favorite points: ${gcCode}`,
              );
            }
          } else {
            await tx.userCacheData.create({
              data: { userId, cacheId: current.cache.id, raw },
            });
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
        await this.prisma.$transaction((tx) =>
          this.stats.replaceSnapshotForUser(userId, stats, tx),
        );
      } catch (error) {
        this.logger.error(
          `Stats rebuild failed after received-log import for user ${userId}`,
          error,
        );
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
      where: { userId: user.id, scope: "FULL" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        scope: true,
        tokenPrefix: true,
        tokenCiphertext: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return {
      tokens: tokens.map(({ tokenCiphertext, ...token }) => ({
        ...token,
        token: decryptToken(tokenCiphertext),
      })),
    };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: { name?: string }) {
    const token = newToken();
    const created = await this.prisma.collectorToken.create({
      data: {
        userId: user.id,
        name: body.name?.trim() || "Collector",
        scope: "FULL",
        tokenPrefix: token.slice(0, 12),
        tokenHash: tokenHash(token),
        tokenCiphertext: encryptToken(token),
      },
      select: {
        id: true,
        name: true,
        scope: true,
        tokenPrefix: true,
        tokenCiphertext: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    const { tokenCiphertext, ...collectorToken } = created;
    return { token, collectorToken: { ...collectorToken, token } };
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const result = await this.prisma.collectorToken.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) {
      throw new NotFoundException("Collector token not found");
    }
    return { ok: true };
  }
}
