"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseCoordinate } from "@geostats/shared";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Import,
  MapPin,
  Plus,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
  X
} from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import {
  fieldMergeDecision,
  formatMysteryCoordinate as formatCoordinate,
  mergeMysteryAttempts,
  mergeMysteryCaches,
  stableJsonStringify,
  type MysteryCacheMergeOptions
} from "../../lib/mystery-cache-merge";
import { normalizeMysteryArea } from "../../lib/mystery-area";
import { MYSTERY_USERSCRIPT_VERSION } from "../../lib/mystery-userscript";
import { bulkAttemptKey, parseBulkFailedAttempts, parseFailedCoordinateCsv } from "../../lib/mystery-bulk-attempts";
import { automaticSyncRetryDelay } from "../../lib/mystery-sync-policy";

type CheckState = "correct" | "wrong" | "unchecked" | "planned";
type MysteryStatus = "solving" | "solved" | "planned";
type AttemptKind = "coordinate" | "keyword" | "approach";

type CoordinateAttempt = {
  id: string;
  kind?: AttemptKind;
  latitude?: number;
  longitude?: number;
  answer?: string;
  finalLatitude?: number;
  finalLongitude?: number;
  state: CheckState;
  createdAt: string;
  updatedAt?: string;
  geocachingSyncedAt?: string;
  note?: string;
  source?: string;
};

type SolvedCoordinate = {
  attempt: CoordinateAttempt;
  latitude: number;
  longitude: number;
};

type AppUser = {
  id: string;
  username: string;
};

type MysterySyncConflicts = {
  notes?: { server: string; device: string };
  image?: { server: string | null; device: string | null };
};

type MysteryCache = {
  id: string;
  gcCode: string;
  name: string;
  area: string;
  county?: string;
  country: string;
  region?: string;
  locality?: string;
  locationHierarchy?: string[];
  status: MysteryStatus;
  trip?: string;
  tripUpdatedAt?: string;
  publishedLatitude: number;
  publishedLongitude: number;
  notes: string;
  clues: string[];
  sharedWith: AppUser[];
  attempts: CoordinateAttempt[];
  image?: string;
  syncConflicts?: MysterySyncConflicts;
  sharedBy?: AppUser;
  sharedWorkspaceId?: string;
};

type SharedMysteryGrant = {
  workspaceId: string;
  mystery: MysteryCache;
  owner: AppUser;
  sharedWith: AppUser[];
};

type OwnedMysterySnapshot = {
  clientId: string;
  mystery: MysteryCache;
  revision: number;
  sharedWith: AppUser[];
};

type MysterySharingPreference = {
  recipient: AppUser;
  statuses: MysteryStatus[];
};

type MysterySyncMetadata = {
  revision: number;
  fingerprint: string;
  notesFingerprint?: string;
  imageFingerprint?: string;
};

type BrowserImport = {
  gcCode?: unknown;
  name?: unknown;
  area?: unknown;
  county?: unknown;
  country?: unknown;
  region?: unknown;
  locality?: unknown;
  locationHierarchy?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type GeocachingSyncReceipt = {
  cacheId?: unknown;
  attemptId?: unknown;
  gcCode?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  syncedAt?: unknown;
};

type GeocachingSyncPayload = {
  cacheId: string;
  attemptId: string;
  gcCode: string;
  latitude: number;
  longitude: number;
  coordinateText: string;
  solved: true;
  issuedAt: number;
};

const STORAGE_KEY = "geostats-mysteries-v1";
const SYNC_METADATA_STORAGE_KEY = "geostats-mystery-sync-metadata-v1";
const DEDUP_BACKUP_KEY = "geostats-mysteries-backup-before-dedup-v1";
const DELETION_STORAGE_KEY = "geostats-mystery-deletions-v1";
const DELETION_CHANNEL = "geostats-mystery-deletions";
const MAX_REASONABLE_DISTANCE_KM = 3.2;

function snapshotFingerprint(value: string) {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function downloadFile(name: string, content: string, type: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function stateLabel(state: CheckState) {
  if (state === "correct") return "Correct";
  if (state === "wrong") return "Didn't work";
  if (state === "planned") return "Not tried";
  return "Result unknown";
}

function inputCoordinate(attempt: CoordinateAttempt) {
  return Number.isFinite(attempt.latitude) && Number.isFinite(attempt.longitude)
    ? { latitude: attempt.latitude!, longitude: attempt.longitude! }
    : null;
}

function revealedCoordinate(attempt: CoordinateAttempt) {
  return Number.isFinite(attempt.finalLatitude) && Number.isFinite(attempt.finalLongitude)
    ? { latitude: attempt.finalLatitude!, longitude: attempt.finalLongitude! }
    : null;
}

function solvedCoordinateForAttempt(attempt: CoordinateAttempt): SolvedCoordinate | null {
  if (attempt.state !== "correct") return null;
  const coordinate = revealedCoordinate(attempt) ?? (attempt.kind !== "keyword" ? inputCoordinate(attempt) : null);
  return coordinate ? { attempt, ...coordinate } : null;
}

function finalCoordinate(cache: MysteryCache) {
  for (const attempt of cache.attempts) {
    const solved = solvedCoordinateForAttempt(attempt);
    if (solved) return solved;
  }
  return null;
}

function attemptKind(attempt: CoordinateAttempt): AttemptKind {
  return attempt.kind === "keyword" || attempt.kind === "approach" ? attempt.kind : "coordinate";
}

function attemptKindLabel(attempt: CoordinateAttempt) {
  if (attemptKind(attempt) === "keyword") return "Keyword";
  if (attemptKind(attempt) === "approach") return "Approach";
  return "Coordinate";
}

function attemptInputLabel(attempt: CoordinateAttempt) {
  const coordinate = inputCoordinate(attempt);
  return attemptKind(attempt) !== "coordinate"
    ? attempt.answer || attemptKindLabel(attempt)
    : coordinate
      ? formatCoordinate(coordinate.latitude, coordinate.longitude, 4)
      : "Coordinate";
}

function locationLabel(cache: MysteryCache) {
  return [cache.locality, cache.area, cache.county, cache.region, cache.country]
    .map(normalizeMysteryArea)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

function newId(prefix = "mystery") {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAppUser(value: unknown): value is AppUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<AppUser>;
  return typeof user.id === "string" && user.id.length > 0 && typeof user.username === "string" && user.username.length > 0;
}

function mysteryFieldFingerprint(value: unknown) {
  return snapshotFingerprint(stableJsonStringify(value ?? null));
}

function deviceMergeOptions(cache: MysteryCache, serverCache: MysteryCache, metadata: MysterySyncMetadata | undefined): MysteryCacheMergeOptions {
  const hasNotesBaseline = typeof metadata?.notesFingerprint === "string";
  const hasImageBaseline = typeof metadata?.imageFingerprint === "string";
  const localSnapshotChanged = !metadata || snapshotFingerprint(stableJsonStringify(shareableMystery(cache))) !== metadata.fingerprint;
  const notesDecision = fieldMergeDecision(
    mysteryFieldFingerprint(cache.notes),
    mysteryFieldFingerprint(serverCache.notes),
    metadata?.notesFingerprint
  );
  const imageDecision = fieldMergeDecision(
    mysteryFieldFingerprint(cache.image),
    mysteryFieldFingerprint(serverCache.image),
    metadata?.imageFingerprint
  );
  return {
    // Device-only edits apply directly. Concurrent and legacy-ambiguous edits
    // keep the server active while preserving the device value for review.
    preferIncomingNotes: notesDecision.preferIncoming,
    preferIncomingImage: imageDecision.preferIncoming,
    preserveNotesConflict: notesDecision.preserveConflict || (!hasNotesBaseline && localSnapshotChanged),
    preserveImageConflict: imageDecision.preserveConflict || (!hasImageBaseline && localSnapshotChanged)
  };
}

function verifiedStoredShares(caches: MysteryCache[], mergeOptions?: MysteryCacheMergeOptions) {
  const normalized = caches.map((cache) => ({
    ...cache,
    gcCode: typeof cache.gcCode === "string" ? cache.gcCode.trim().toUpperCase() : "",
    name: typeof cache.name === "string"
      ? cache.name.replace(/(?:\s*\(device edits\))+$/gi, "").trim()
      : "",
    area: normalizeMysteryArea(cache.area),
    county: normalizeMysteryArea(cache.county),
    country: normalizeMysteryArea(cache.country),
    region: normalizeMysteryArea(cache.region),
    locality: normalizeMysteryArea(cache.locality),
    locationHierarchy: Array.isArray(cache.locationHierarchy)
      ? cache.locationHierarchy.map(normalizeMysteryArea).filter(Boolean)
      : [],
    clues: Array.isArray(cache.clues) ? cache.clues.filter((clue): clue is string => typeof clue === "string") : [],
    attempts: Array.isArray(cache.attempts)
      ? mergeMysteryAttempts(cache.attempts.map((attempt): CoordinateAttempt => ({
          ...attempt,
          state: attempt.state === "correct" || attempt.state === "wrong" || attempt.state === "planned" ? attempt.state : "unchecked"
        })))
      : [],
    sharedWith: Array.isArray(cache.sharedWith) ? cache.sharedWith.filter(isAppUser) : []
  }));

  const merged = new Map<string, MysteryCache>();
  for (const cache of normalized) {
    const key = cache.sharedWorkspaceId
      ? `shared:${cache.sharedWorkspaceId}`
      : cache.gcCode
        ? `owned:${cache.gcCode}`
        : `id:${cache.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, cache);
      continue;
    }

    merged.set(key, mergeMysteryCaches(existing, cache, mergeOptions));
  }
  return [...merged.values()];
}

function shareableMystery(cache: MysteryCache) {
  const { sharedBy: _sharedBy, sharedWorkspaceId: _sharedWorkspaceId, syncConflicts: _syncConflicts, ...mystery } = cache;
  return mystery;
}

function importedMystery(value: BrowserImport): MysteryCache | null {
  const gcCode = typeof value.gcCode === "string" ? value.gcCode.trim().toUpperCase() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const area = normalizeMysteryArea(value.area);
  const county = normalizeMysteryArea(value.county);
  const country = normalizeMysteryArea(value.country);
  const region = normalizeMysteryArea(value.region);
  const locality = normalizeMysteryArea(value.locality);
  const locationHierarchy = Array.isArray(value.locationHierarchy)
    ? value.locationHierarchy.map(normalizeMysteryArea).filter(Boolean)
    : [];
  const publishedLatitude = typeof value.latitude === "number" ? value.latitude : Number.NaN;
  const publishedLongitude = typeof value.longitude === "number" ? value.longitude : Number.NaN;
  if (!/^GC[A-Z0-9]+$/.test(gcCode) || !name || !Number.isFinite(publishedLatitude) || !Number.isFinite(publishedLongitude) || Math.abs(publishedLatitude) > 90 || Math.abs(publishedLongitude) > 180) {
    return null;
  }
  return {
    id: newId(),
    gcCode,
    name,
    area,
    county,
    country,
    region,
    locality,
    locationHierarchy,
    status: "solving",
    publishedLatitude,
    publishedLongitude,
    notes: "",
    clues: [],
    sharedWith: [],
    attempts: []
  };
}

function applyGeocachingSyncReceipt(caches: MysteryCache[], value: GeocachingSyncReceipt) {
  const cacheId = typeof value.cacheId === "string" ? value.cacheId : "";
  const attemptId = typeof value.attemptId === "string" ? value.attemptId : "";
  const gcCode = typeof value.gcCode === "string" ? value.gcCode.toUpperCase() : "";
  const latitude = typeof value.latitude === "number" ? value.latitude : Number.NaN;
  const longitude = typeof value.longitude === "number" ? value.longitude : Number.NaN;
  const syncedAt = typeof value.syncedAt === "string" && Number.isFinite(Date.parse(value.syncedAt)) ? value.syncedAt : "";
  let applied = false;

  const next = caches.map((cache) => {
    if (cache.id !== cacheId || cache.gcCode.toUpperCase() !== gcCode) return cache;
    const attempts = cache.attempts.map((attempt) => {
      const solved = solvedCoordinateForAttempt(attempt);
      if (
        attempt.id !== attemptId ||
        !solved ||
        Math.abs(solved.latitude - latitude) >= 0.000001 ||
        Math.abs(solved.longitude - longitude) >= 0.000001 ||
        !syncedAt
      ) {
        return attempt;
      }
      applied = true;
      return { ...attempt, geocachingSyncedAt: syncedAt };
    });
    return { ...cache, attempts };
  });

  return { caches: next, applied };
}

export default function MysteriesPage() {
  const initialized = useRef(false);
  const persistedCaches = useRef<MysteryCache[]>([]);
  const latestCaches = useRef<MysteryCache[]>([]);
  const serverSnapshots = useRef(new Map<string, string>());
  const snapshotRevisions = useRef(new Map<string, number>());
  const syncMetadata = useRef(new Map<string, MysterySyncMetadata>());
  const shareMutationRevisions = useRef(new Map<string, number>());
  const deletedCacheIds = useRef(new Set<string>());
  const deletionChannel = useRef<BroadcastChannel | null>(null);
  const syncRetryCount = useRef(0);
  const syncRetryBatch = useRef("");
  const serverLoadRetryCount = useRef(0);
  const serverLoadInFlight = useRef(false);
  const lastFailedServerLoadSnapshot = useRef("");
  const [caches, setCaches] = useState<MysteryCache[]>([]);
  const [persistedForSync, setPersistedForSync] = useState<MysteryCache[] | null>(null);
  const [serverSyncReady, setServerSyncReady] = useState(false);
  const [serverLoadAttempt, setServerLoadAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MysteryStatus>("all");
  const [attemptType, setAttemptType] = useState<AttemptKind>("coordinate");
  const [coordinate, setCoordinate] = useState("");
  const [coordinateState, setCoordinateState] = useState<CheckState>("wrong");
  const [attemptSearch, setAttemptSearch] = useState("");
  const [finalCoordinateText, setFinalCoordinateText] = useState("");
  const [coordinateError, setCoordinateError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBrowserImport, setShowBrowserImport] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkTries, setBulkTries] = useState("");
  const [bulkImportError, setBulkImportError] = useState("");
  const [bulkCsvName, setBulkCsvName] = useState("");
  const [bulkCsvSummary, setBulkCsvSummary] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [showSharingSettings, setShowSharingSettings] = useState(false);
  const [sharingPreferences, setSharingPreferences] = useState<MysterySharingPreference[]>([]);
  const [cacheToDelete, setCacheToDelete] = useState<MysteryCache | null>(null);
  const [deletingCache, setDeletingCache] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<AppUser[]>([]);
  const [userSearchState, setUserSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [sharingUserId, setSharingUserId] = useState("");
  const [savingPreferenceId, setSavingPreferenceId] = useState("");
  const [userscript, setUserscript] = useState("");
  const [userscriptError, setUserscriptError] = useState("");
  const [scriptCopied, setScriptCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const scriptTextRef = useRef<HTMLTextAreaElement>(null);

  latestCaches.current = caches;

  function persistSyncMetadata() {
    try {
      localStorage.setItem(SYNC_METADATA_STORAGE_KEY, JSON.stringify(Object.fromEntries(syncMetadata.current)));
    } catch {
      // Mystery data remains the primary offline copy when metadata cannot be persisted.
    }
  }

  function rememberServerSnapshot(cacheId: string, revision: number, serialized: string) {
    rememberSnapshotRevision(cacheId, revision);
    serverSnapshots.current.set(cacheId, serialized);
    let snapshot: Partial<MysteryCache> = {};
    try {
      snapshot = JSON.parse(serialized) as Partial<MysteryCache>;
    } catch {
      // The full fingerprint still protects reconciliation if field parsing fails.
    }
    syncMetadata.current.set(cacheId, {
      revision,
      fingerprint: snapshotFingerprint(serialized),
      notesFingerprint: mysteryFieldFingerprint(snapshot.notes),
      imageFingerprint: mysteryFieldFingerprint(snapshot.image)
    });
    persistSyncMetadata();
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const storedMetadata = JSON.parse(localStorage.getItem(SYNC_METADATA_STORAGE_KEY) ?? "{}") as Record<string, MysterySyncMetadata>;
      syncMetadata.current = new Map(Object.entries(storedMetadata).filter((entry): entry is [string, MysterySyncMetadata] => {
        const [cacheId, metadata] = entry;
        return Boolean(cacheId) && Number.isSafeInteger(metadata?.revision) && metadata.revision >= 0 && typeof metadata.fingerprint === "string";
      }));
    } catch {
      localStorage.removeItem(SYNC_METADATA_STORAGE_KEY);
    }
    try {
      const storedDeletionIds = JSON.parse(localStorage.getItem(DELETION_STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(storedDeletionIds)) {
        deletedCacheIds.current = new Set(storedDeletionIds.filter((cacheId): cacheId is string => typeof cacheId === "string" && cacheId.length > 0));
      }
    } catch {
      localStorage.removeItem(DELETION_STORAGE_KEY);
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    let initial: MysteryCache[] = [];
    if (saved) {
      try {
        const storedCaches = JSON.parse(saved) as MysteryCache[];
        initial = verifiedStoredShares(storedCaches);
        if (initial.length < storedCaches.length && !localStorage.getItem(DEDUP_BACKUP_KEY)) {
          localStorage.setItem(DEDUP_BACKUP_KEY, saved);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    initial = initial.filter((cache) => !deletedCacheIds.current.has(cache.id));
    const lastStoredCaches = initial;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const requestedCacheId = new URLSearchParams(window.location.search).get("cache");
    const encodedImport = hashParams.get("mystery-import");
    const encodedSyncReceipt = hashParams.get("geocaching-synced");
    if (encodedImport) {
      try {
        const imported = importedMystery(JSON.parse(encodedImport) as BrowserImport);
        if (imported) {
          const existing = initial.find((cache) => cache.gcCode.toUpperCase() === imported.gcCode);
          if (existing) {
            initial = initial.map((cache) => cache.id === existing.id ? {
              ...cache,
              area: imported.area || cache.area,
              county: imported.county || cache.county,
              country: imported.country || cache.country,
              region: imported.region || cache.region,
              locality: imported.locality || cache.locality,
              locationHierarchy: imported.locationHierarchy?.length
                ? imported.locationHierarchy
                : cache.locationHierarchy
            } : cache);
            setSelectedId(existing.id);
            setNotice(`${imported.gcCode} location refreshed`);
          } else {
            initial = [imported, ...initial];
            setSelectedId(imported.id);
            setNotice(`${imported.gcCode} imported from geocaching.com`);
          }
        } else {
          setNotice("The cache page did not contain valid coordinates");
        }
      } catch {
        setNotice("Could not read the Tampermonkey import");
      }
    }
    if (encodedSyncReceipt) {
      try {
        const result = applyGeocachingSyncReceipt(initial, JSON.parse(encodedSyncReceipt) as GeocachingSyncReceipt);
        initial = result.caches;
        const receipt = JSON.parse(encodedSyncReceipt) as GeocachingSyncReceipt;
        if (typeof receipt.cacheId === "string") setSelectedId(receipt.cacheId);
        setNotice(result.applied ? "Confirmed as synced to Geocaching" : "Could not match the Geocaching sync receipt");
      } catch {
        setNotice("Could not read the Geocaching sync receipt");
      }
    }
    if (encodedImport || encodedSyncReceipt) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    setCaches(initial);
    persistedCaches.current = lastStoredCaches;
    setSelectedId((current) => current || initial.find((cache) => cache.id === requestedCacheId)?.id || initial[0]?.id || "");
    setReady(true);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/mysteries-sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(caches);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      persistedCaches.current = caches;
      setPersistedForSync(caches);
    } catch {
      const currentById = new Map(caches.map((cache) => [cache.id, cache]));
      const rollback = persistedCaches.current.filter((cache) => !deletedCacheIds.current.has(cache.id)).map((cache) => {
        const current = currentById.get(cache.id);
        return current ? {
          ...cache,
          sharedWith: current.sharedWith,
          sharedBy: current.sharedBy,
          sharedWorkspaceId: current.sharedWorkspaceId
        } : cache;
      });
      const persistedWorkspaceIds = new Set(rollback.map((cache) => cache.sharedWorkspaceId).filter(Boolean));
      rollback.push(...caches.filter((cache) => cache.sharedWorkspaceId && !persistedWorkspaceIds.has(cache.sharedWorkspaceId)));
      if (JSON.stringify(rollback) !== serialized) setCaches(rollback);
      setNotice("Browser storage is full. Your last change was not saved.");
    }
  }, [caches, ready]);

  useEffect(() => {
    if (!ready || !serverSyncReady || !persistedForSync) return;
    const currentOwnedByGcCode = new Map(latestCaches.current
      .filter((cache) => !cache.sharedBy)
      .map((cache) => [cache.gcCode.trim().toUpperCase(), cache]));
    const pendingCaches = persistedForSync.flatMap((cache) => {
      if (cache.sharedBy || deletedCacheIds.current.has(cache.id)) return [];
      // A reconnect can replace an offline-generated ID with the server's ID.
      // Never submit the stale identity after that cache has been reconciled.
      const canonicalCache = currentOwnedByGcCode.get(cache.gcCode.trim().toUpperCase());
      if (!canonicalCache || canonicalCache.id !== cache.id) return [];
      const serialized = stableJsonStringify(shareableMystery(canonicalCache));
      return serverSnapshots.current.get(canonicalCache.id) === serialized
        ? []
        : [{ cache: canonicalCache, serialized }];
    });
    if (!pendingCaches.length) return;

    const batchSignature = snapshotFingerprint(stableJsonStringify(
      pendingCaches.map(({ cache, serialized }) => [cache.id, serialized])
    ));
    if (syncRetryBatch.current !== batchSignature) {
      syncRetryBatch.current = batchSignature;
      syncRetryCount.current = 0;
    }

    let active = true;
    let retryTimeout: number | undefined;
    const timeout = window.setTimeout(() => {
      void Promise.all(pendingCaches.map(({ cache, serialized }) => {
        const requestedRevision = nextSnapshotRevision(cache.id);
        const baseMetadata = syncMetadata.current.get(cache.id);
        return apiFetch<{ revision: number; mystery: MysteryCache }>(`/mysteries/${encodeURIComponent(cache.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            mystery: shareableMystery(cache),
            revision: requestedRevision
          })
        }).then(({ revision, mystery }) => {
          const storedSerialized = stableJsonStringify(mystery);
          rememberServerSnapshot(cache.id, revision, storedSerialized);
          if (storedSerialized !== serialized) {
            const authoritative = verifiedStoredShares([{ ...mystery, sharedWith: cache.sharedWith }])[0];
            setCaches((current) => verifiedStoredShares(current.map((item) => {
              if (item.id !== cache.id) return item;
              const merged = verifiedStoredShares([authoritative, item], deviceMergeOptions(item, authoritative, baseMetadata))[0];
              return { ...merged, id: authoritative.id, sharedWith: authoritative.sharedWith };
            })));
            setNotice(`Merged offline and server changes for ${cache.gcCode}.`);
          }
        });
      })).then(() => {
        if (!active) return;
        syncRetryCount.current = 0;
        syncRetryBatch.current = "";
      }).catch(() => {
        if (!active) return;
        const retryDelay = automaticSyncRetryDelay(syncRetryCount.current);
        syncRetryCount.current += 1;
        setNotice("Saved offline; account sync will retry with reduced frequency.");
        retryTimeout = window.setTimeout(() => {
          if (!navigator.onLine) return;
          setPersistedForSync([...persistedCaches.current]);
        }, retryDelay);
      });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [persistedForSync, ready, serverSyncReady]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let retryTimeout: number | undefined;
    serverLoadInFlight.current = true;
    const ownedAtRequest = new Map(caches.filter((cache) => !cache.sharedBy).map((cache) => [
      cache.id,
      stableJsonStringify(shareableMystery(cache))
    ]));
    const knownSyncMetadata = new Map(syncMetadata.current);
    void apiFetch<{ mysteries: SharedMysteryGrant[] }>("/mysteries/shared")
      .then(({ mysteries }) => {
        if (!active) return;
        const sharedCaches = mysteries.flatMap((grant) => {
          if (!grant?.mystery || !isAppUser(grant.owner) || typeof grant.workspaceId !== "string") return [];
          return [{
            ...grant.mystery,
            area: normalizeMysteryArea(grant.mystery.area),
            county: normalizeMysteryArea(grant.mystery.county),
            country: normalizeMysteryArea(grant.mystery.country),
            region: normalizeMysteryArea(grant.mystery.region),
            locality: normalizeMysteryArea(grant.mystery.locality),
            locationHierarchy: Array.isArray(grant.mystery.locationHierarchy)
              ? grant.mystery.locationHierarchy.map(normalizeMysteryArea).filter(Boolean)
              : [],
            id: `shared:${grant.workspaceId}`,
            sharedWith: Array.isArray(grant.sharedWith) ? grant.sharedWith.filter(isAppUser) : [],
            sharedBy: grant.owner,
            sharedWorkspaceId: grant.workspaceId
          }];
        });
        setCaches((current) => [...current.filter((cache) => !cache.sharedWorkspaceId), ...sharedCaches]);
      })
      .catch(() => {
        // Keep the last locally cached shared snapshot while offline.
      });
    void apiFetch<{ mysteries: OwnedMysterySnapshot[]; deletedClientIds: string[] }>("/mysteries/owned")
      .then(({ mysteries, deletedClientIds }) => {
        if (!active) return;
        const serverDeletedIds = Array.isArray(deletedClientIds)
          ? deletedClientIds.filter((cacheId): cacheId is string => typeof cacheId === "string" && cacheId.length > 0)
          : [];
        serverDeletedIds.forEach(rememberDeletedCache);
        const ownedEntries = mysteries.flatMap(({ clientId, mystery, revision, sharedWith }) => {
          if (!mystery || typeof mystery !== "object" || mystery.id !== clientId || deletedCacheIds.current.has(clientId)) return [];
          const cache = verifiedStoredShares([{
            ...mystery,
            id: clientId,
            sharedWith: Array.isArray(sharedWith) ? sharedWith.filter(isAppUser) : []
          }])[0];
          const serialized = stableJsonStringify(shareableMystery(cache));
          return [{ cache, revision, serialized }];
        });
        const serverIds = new Set(ownedEntries.map(({ cache }) => cache.id));
        const serverGcCodes = new Set(ownedEntries.map(({ cache }) => cache.gcCode));
        const current = latestCaches.current;
        const currentById = new Map(current.filter((cache) => !cache.sharedBy).map((cache) => [cache.id, cache]));
        const currentByGcCode = new Map(current.filter((cache) => !cache.sharedBy).map((cache) => [cache.gcCode.trim().toUpperCase(), cache]));
        let mergedConflictCount = 0;
        const reconciledOwned = ownedEntries.map(({ cache: serverCache, revision, serialized: serverSerialized }) => {
          const currentCache = currentById.get(serverCache.id) ?? currentByGcCode.get(serverCache.gcCode);
          if (!currentCache) return serverCache;
          const metadata = knownSyncMetadata.get(currentCache.id) ?? knownSyncMetadata.get(serverCache.id);
          const mergeOptions = deviceMergeOptions(currentCache, serverCache, metadata);
          if (currentCache.id !== serverCache.id) {
            serverSnapshots.current.delete(currentCache.id);
            snapshotRevisions.current.delete(currentCache.id);
            syncMetadata.current.delete(currentCache.id);
            shareMutationRevisions.current.delete(currentCache.id);
            const merged = verifiedStoredShares([
              serverCache,
              { ...currentCache, id: serverCache.id, sharedWith: serverCache.sharedWith }
            ], mergeOptions)[0];
            return { ...merged, id: serverCache.id, sharedWith: serverCache.sharedWith };
          }
          const currentSerialized = stableJsonStringify(shareableMystery(currentCache));
          const requestSerialized = ownedAtRequest.get(serverCache.id);
          const localChanged = metadata
            ? snapshotFingerprint(currentSerialized) !== metadata.fingerprint
            : currentSerialized !== serverSerialized;
          const serverChanged = metadata
            ? revision !== metadata.revision
            : requestSerialized !== undefined && requestSerialized !== serverSerialized;
          const changedDuringRequest = requestSerialized !== undefined && currentSerialized !== requestSerialized;
          if ((localChanged || changedDuringRequest) && !serverChanged) return currentCache;
          if (localChanged || changedDuringRequest) {
            mergedConflictCount += 1;
            const merged = verifiedStoredShares([serverCache, currentCache], mergeOptions)[0];
            return { ...merged, id: serverCache.id, sharedWith: serverCache.sharedWith };
          }
          return serverCache;
        });
        ownedEntries.forEach(({ cache, revision, serialized }) => rememberServerSnapshot(cache.id, revision, serialized));
        const localOnly = current.filter((cache) =>
          !cache.sharedBy &&
          !serverIds.has(cache.id) &&
          !serverGcCodes.has(cache.gcCode.trim().toUpperCase()) &&
          !deletedCacheIds.current.has(cache.id)
        );
        const receivedShares = current.filter((cache) =>
          cache.sharedBy && !deletedCacheIds.current.has(cache.id)
        );
        setCaches(verifiedStoredShares([...reconciledOwned, ...localOnly, ...receivedShares]));
        if (mergedConflictCount) {
          setNotice(`Merged offline and server changes for ${mergedConflictCount} ${mergedConflictCount === 1 ? "cache" : "caches"}.`);
        }
        serverLoadInFlight.current = false;
        serverLoadRetryCount.current = 0;
        lastFailedServerLoadSnapshot.current = "";
        setServerSyncReady(true);
      })
      .catch(() => {
        if (!active) return;
        serverLoadInFlight.current = false;
        setServerSyncReady(false);
        lastFailedServerLoadSnapshot.current = stableJsonStringify(
          latestCaches.current.filter((cache) => !cache.sharedBy).map(shareableMystery)
        );
        const retryDelay = automaticSyncRetryDelay(serverLoadRetryCount.current);
        serverLoadRetryCount.current += 1;
        setNotice("Could not reach account sync; retrying with reduced frequency.");
        retryTimeout = window.setTimeout(() => {
          if (!navigator.onLine) return;
          setServerLoadAttempt((attempt) => attempt + 1);
        }, retryDelay);
      });
    return () => {
      active = false;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [ready, serverLoadAttempt]);

  useEffect(() => {
    if (!ready || serverSyncReady || !persistedForSync) return;
    const localSnapshot = stableJsonStringify(
      persistedForSync.filter((cache) => !cache.sharedBy).map(shareableMystery)
    );
    if (localSnapshot === lastFailedServerLoadSnapshot.current) return;
    const timeout = window.setTimeout(() => {
      if (serverLoadInFlight.current) return;
      lastFailedServerLoadSnapshot.current = localSnapshot;
      serverLoadRetryCount.current = 0;
      setServerLoadAttempt((attempt) => attempt + 1);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [persistedForSync, ready, serverSyncReady]);

  useEffect(() => {
    const retryServerLoad = () => {
      serverLoadRetryCount.current = 0;
      syncRetryCount.current = 0;
      lastFailedServerLoadSnapshot.current = "";
      setServerLoadAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("online", retryServerLoad);
    return () => {
      window.removeEventListener("online", retryServerLoad);
    };
  }, []);

  useEffect(() => {
    const applyDeletion = (cacheId: string) => {
      if (!cacheId) return;
      rememberDeletedCache(cacheId);
      setCaches((current) => current.filter((cache) => cache.id !== cacheId));
      setCacheToDelete((current) => current?.id === cacheId ? null : current);
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DELETION_CHANNEL);
    deletionChannel.current = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as { type?: unknown; cacheId?: unknown } | null;
        if (message?.type === "cache-deleted" && typeof message.cacheId === "string") {
          applyDeletion(message.cacheId);
        }
      };
    }

    const receiveStorageUpdate = (event: StorageEvent) => {
      if (event.key === DELETION_STORAGE_KEY && event.newValue) {
        try {
          const cacheIds = JSON.parse(event.newValue) as unknown;
          if (Array.isArray(cacheIds)) {
            const validCacheIds = cacheIds.filter(
              (cacheId): cacheId is string => typeof cacheId === "string" && cacheId.length > 0
            );
            rememberDeletedCaches(validCacheIds);
            setCaches((current) => current.filter((cache) => !deletedCacheIds.current.has(cache.id)));
            setCacheToDelete((current) => current && deletedCacheIds.current.has(current.id) ? null : current);
          }
        } catch {
          // Ignore malformed tombstones from another tab.
        }
        return;
      }
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const updated = verifiedStoredShares(JSON.parse(event.newValue) as MysteryCache[])
          .filter((cache) => !deletedCacheIds.current.has(cache.id));
        persistedCaches.current = updated;
        setCaches(updated);
      } catch {
        // Ignore malformed updates from another tab.
      }
    };
    window.addEventListener("storage", receiveStorageUpdate);
    return () => {
      window.removeEventListener("storage", receiveStorageUpdate);
      channel?.close();
      deletionChannel.current = null;
    };
  }, []);

  useEffect(() => {
    const receiveSyncReceipt = () => {
      const root = document.documentElement;
      const rawReceipt = root.getAttribute("data-geostats-sync-receipt");
      if (!rawReceipt) return;
      root.removeAttribute("data-geostats-sync-receipt");
      try {
        const receipt = JSON.parse(rawReceipt) as GeocachingSyncReceipt;
        setCaches((current) => applyGeocachingSyncReceipt(current, receipt).caches);
        if (typeof receipt.cacheId === "string") setSelectedId(receipt.cacheId);
        setNotice("Confirmed as synced to Geocaching");
      } catch {
        setNotice("Could not read the Geocaching sync receipt");
      }
    };
    document.addEventListener("geostats-sync-receipt", receiveSyncReceipt);
    receiveSyncReceipt();
    return () => document.removeEventListener("geostats-sync-receipt", receiveSyncReceipt);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!showBrowserImport || userscript) return;
    let active = true;
    setUserscriptError("");
    void fetch(`/mysteries/tampermonkey.user.js?v=${MYSTERY_USERSCRIPT_VERSION}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load userscript");
        return response.text();
      })
      .then((text) => {
        if (active) setUserscript(text);
      })
      .catch(() => {
        if (active) setUserscriptError("Could not generate the script. Close this window and try again.");
      });
    return () => {
      active = false;
    };
  }, [showBrowserImport, userscript]);

  useEffect(() => {
    const normalizedQuery = userQuery.trim();
    if ((!showShare && !showSharingSettings) || normalizedQuery.length < 2) {
      setUserResults([]);
      setUserSearchState("idle");
      return;
    }

    let active = true;
    setUserSearchState("loading");
    const timeout = window.setTimeout(() => {
      void apiFetch<{ users: AppUser[] }>(`/auth/users?query=${encodeURIComponent(normalizedQuery)}`)
        .then(({ users }) => {
          if (!active) return;
          setUserResults(users);
          setUserSearchState("idle");
        })
        .catch(() => {
          if (!active) return;
          setUserResults([]);
          setUserSearchState("error");
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [showShare, showSharingSettings, userQuery]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void apiFetch<{ preferences: MysterySharingPreference[] }>("/mysteries/sharing-preferences")
      .then(({ preferences }) => {
        if (!active) return;
        setSharingPreferences(preferences.filter((preference) =>
          isAppUser(preference.recipient) && Array.isArray(preference.statuses)
        ));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [ready, serverLoadAttempt]);

  const selected = caches.find((cache) => cache.id === selectedId) ?? caches[0];
  const selectedCacheId = selected?.id;
  useEffect(() => {
    setAttemptSearch("");
  }, [selectedCacheId]);
  const normalizedAttemptSearch = attemptSearch.trim().toLocaleLowerCase();
  const matchingAttempts = selected?.attempts.filter((attempt) =>
    !normalizedAttemptSearch || attemptInputLabel(attempt).toLocaleLowerCase().includes(normalizedAttemptSearch)
  ) ?? [];
  const matchingWorkedAttempts = matchingAttempts.filter((attempt) => attempt.state === "correct");
  const matchingFailedAttempts = matchingAttempts.filter((attempt) => attempt.state === "wrong");
  const matchingUnknownAttempts = matchingAttempts.filter((attempt) => attempt.state === "unchecked");
  const matchingPlannedAttempts = matchingAttempts.filter((attempt) => attempt.state === "planned");
  const syncableCaches = useMemo(() => caches.flatMap((cache) => {
    if (cache.status !== "solved") return [];
    const solved = finalCoordinate(cache);
    return solved && !solved.attempt.geocachingSyncedAt ? [{ cache, ...solved }] : [];
  }), [caches]);
  const filteredCaches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return caches.filter((cache) => {
      const matchesFilter = filter === "all" || cache.status === filter;
      const matchesQuery = !normalized || [
        cache.gcCode,
        cache.name,
        cache.area,
        cache.county,
        cache.country,
        cache.region,
        cache.locality,
        ...(cache.locationHierarchy ?? [])
      ].filter(Boolean).join(" ").toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [caches, filter, query]);

  function updateSelected(patch: Partial<MysteryCache>) {
    if (!selected || selected.sharedBy) return;
    setCaches((current) => current.map((cache) => (cache.id === selected.id ? { ...cache, ...patch } : cache)));
  }

  function resolveSyncConflict(field: "notes" | "image", useDevice: boolean) {
    if (!selected?.syncConflicts || selected.sharedBy) return;
    if (!selected.syncConflicts[field]) return;
    const remaining = { ...selected.syncConflicts };
    delete remaining[field];
    const patch: Partial<MysteryCache> = {
      syncConflicts: Object.keys(remaining).length ? remaining : undefined
    };
    if (useDevice) {
      if (field === "notes") patch.notes = selected.syncConflicts.notes!.device;
      else patch.image = selected.syncConflicts.image!.device ?? undefined;
    }
    updateSelected(patch);
    setNotice(useDevice ? `Restored offline ${field}.` : `Kept server ${field}.`);
  }

  function rememberDeletedCache(cacheId: string) {
    rememberDeletedCaches([cacheId]);
  }

  function rememberDeletedCaches(cacheIds: string[]) {
    cacheIds.forEach((cacheId) => {
      deletedCacheIds.current.add(cacheId);
      serverSnapshots.current.delete(cacheId);
      snapshotRevisions.current.delete(cacheId);
      syncMetadata.current.delete(cacheId);
    });
    persistSyncMetadata();
    persistedCaches.current = persistedCaches.current.filter((cache) => !deletedCacheIds.current.has(cache.id));
    try {
      localStorage.setItem(DELETION_STORAGE_KEY, JSON.stringify([...deletedCacheIds.current]));
    } catch {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedCaches.current));
      } catch {
        // The in-memory tombstone still protects this page.
      }
    }
  }

  function rememberSnapshotRevision(cacheId: string, revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    snapshotRevisions.current.set(cacheId, Math.max(snapshotRevisions.current.get(cacheId) ?? 0, revision));
  }

  function nextSnapshotRevision(cacheId: string) {
    const revision = (snapshotRevisions.current.get(cacheId) ?? 0) + 1;
    snapshotRevisions.current.set(cacheId, revision);
    return revision;
  }

  function rememberShareMutation(cacheId: string) {
    shareMutationRevisions.current.set(cacheId, (shareMutationRevisions.current.get(cacheId) ?? 0) + 1);
  }

  function addAttempt(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const answer = coordinate.trim();
    const parsed = attemptType === "coordinate" ? parseCoordinate(answer) : null;
    if (attemptType === "coordinate" && !parsed) {
      setCoordinateError("Use decimal coordinates or N 59° 20.123' E 018° 04.321'.");
      return;
    }
    if (attemptType !== "coordinate" && !answer) {
      setCoordinateError(attemptType === "keyword" ? "Enter the keyword you tried." : "Describe the solving approach.");
      return;
    }
    const revealed = finalCoordinateText.trim() ? parseCoordinate(finalCoordinateText) : null;
    if (finalCoordinateText.trim() && !revealed) {
      setCoordinateError("Use valid final coordinates, for example 59.40582, 18.36120.");
      return;
    }
    if (attemptType === "keyword" && coordinateState === "correct" && !revealed) {
      setCoordinateError("Enter the final coordinates revealed by the checker.");
      return;
    }
    const duplicate = selected.attempts.some((attempt) => {
      if (attemptKind(attempt) !== attemptType) return false;
      const sameResult = attempt.state === coordinateState;
      const previousFinal = revealedCoordinate(attempt);
      const sameFinal = previousFinal && revealed
        ? Math.abs(previousFinal.latitude - revealed.latitude) < 0.000001 && Math.abs(previousFinal.longitude - revealed.longitude) < 0.000001
        : previousFinal === revealed;
      if (!sameResult || !sameFinal) return false;
      if (attemptType !== "coordinate") return attempt.answer?.trim().toLocaleLowerCase() === answer.toLocaleLowerCase();
      const previous = inputCoordinate(attempt);
      return Boolean(previous && parsed && Math.abs(previous.latitude - parsed.latitude) < 0.000001 && Math.abs(previous.longitude - parsed.longitude) < 0.000001);
    });
    if (duplicate) {
      setCoordinateError(`You have already tried this ${attemptType}.`);
      return;
    }
    const nextAttempt: CoordinateAttempt = {
      id: newId("attempt"),
      kind: attemptType,
      ...(parsed ?? {}),
      ...(attemptType !== "coordinate" ? { answer } : {}),
      ...(revealed ? { finalLatitude: revealed.latitude, finalLongitude: revealed.longitude } : {}),
      state: coordinateState,
      createdAt: new Date().toISOString()
    };
    const solved = Boolean(solvedCoordinateForAttempt(nextAttempt));
    updateSelected({
      attempts: [nextAttempt, ...selected.attempts],
      status: solved ? "solved" : selected.status
    });
    setCoordinate("");
    setFinalCoordinateText("");
    setCoordinateError("");
    setNotice(serverSyncReady ? "Checker try saved to your account" : "Checker try saved offline");
  }

  function deleteAttempt(attemptId: string) {
    if (!selected) return;
    const remainingAttempts = selected.attempts.filter((attempt) => attempt.id !== attemptId);
    updateSelected({
      attempts: remainingAttempts,
      status: selected.status === "solved" && !remainingAttempts.some((attempt) => solvedCoordinateForAttempt(attempt)) ? "solving" : selected.status
    });
  }

  function syncAttempts(items: Array<{ cache: MysteryCache } & SolvedCoordinate>) {
    const eligible = items.filter(({ cache, attempt }) =>
      cache.status === "solved" &&
      attempt.state === "correct" &&
      !attempt.geocachingSyncedAt &&
      finalCoordinate(cache)?.attempt.id === attempt.id
    );
    if (!eligible.length) {
      setNotice("Only solved, unsynced caches can be synced");
      return;
    }

    const issuedAt = Date.now();
    const payloads: GeocachingSyncPayload[] = eligible.map(({ cache, attempt, latitude, longitude }) => ({
      cacheId: cache.id,
      attemptId: attempt.id,
      gcCode: cache.gcCode,
      latitude,
      longitude,
      coordinateText: formatCoordinate(latitude, longitude),
      solved: true,
      issuedAt
    }));
    const batchId = payloads.length > 1 ? newId("sync-batch") : "";
    const request = JSON.stringify(batchId ? { batchId, requests: payloads } : payloads[0]);
    const acknowledgement = batchId || `${payloads[0].attemptId}:${payloads[0].issuedAt}`;
    const root = document.documentElement;
    let finished = false;

    const cleanup = () => {
      document.removeEventListener("geostats-sync-ready", handleReady);
      root.removeAttribute("data-geostats-sync-request");
      root.removeAttribute("data-geostats-sync-ready");
    };
    const handleReady = () => {
      if (finished || root.getAttribute("data-geostats-sync-ready") !== acknowledgement) return;
      finished = true;
      cleanup();
      const firstPayload = payloads[0];
      const payloadRequest = JSON.stringify(firstPayload);
      const target = `https://coord.info/${encodeURIComponent(firstPayload.gcCode)}#geostats-sync=${encodeURIComponent(payloadRequest)}`;
      window.open(target, "_blank", "noopener,noreferrer");
      setNotice(payloads.length === 1 ? "Geocaching opened — automatic sync is running" : `Syncing ${payloads.length} solved caches in one Geocaching tab`);
    };

    document.addEventListener("geostats-sync-ready", handleReady);
    root.setAttribute("data-geostats-sync-request", request);
    document.dispatchEvent(new Event("geostats-sync-request"));
    window.setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      setNotice("The current helper is not active here. Install/update it, then try again.");
    }, 500);
  }

  function syncAttempt(cache: MysteryCache, attempt: CoordinateAttempt) {
    const solved = solvedCoordinateForAttempt(attempt);
    if (solved) syncAttempts([{ cache, ...solved }]);
  }

  function addCache(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const published = parseCoordinate(String(data.get("published") ?? ""));
    if (!published) return;
    const cache: MysteryCache = {
      id: newId(),
      gcCode: String(data.get("gcCode") ?? "").trim().toUpperCase(),
      name: String(data.get("name") ?? "").trim(),
      area: String(data.get("area") ?? "").trim(),
      county: String(data.get("county") ?? "").trim(),
      country: String(data.get("country") ?? "").trim(),
      region: String(data.get("region") ?? "").trim(),
      locality: String(data.get("locality") ?? "").trim(),
      locationHierarchy: [],
      status: "solving",
      publishedLatitude: published.latitude,
      publishedLongitude: published.longitude,
      notes: "",
      clues: [],
      sharedWith: [],
      attempts: []
    };
    setCaches((current) => [cache, ...current]);
    setSelectedId(cache.id);
    setShowAdd(false);
    setNotice("Mystery cache added");
  }

  async function deleteCache() {
    if (!cacheToDelete) return;
    const deleting = cacheToDelete;
    setDeletingCache(true);
    try {
      await apiFetch(`/mysteries/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    } catch (error) {
      setDeletingCache(false);
      const message = error instanceof Error && error.message
        ? error.message
        : "The request failed";
      setNotice(`Could not delete ${deleting.gcCode}: ${message}`);
      return;
    }

    rememberDeletedCache(deleting.id);
    deletionChannel.current?.postMessage({ type: "cache-deleted", cacheId: deleting.id });
    const deletedIndex = caches.findIndex((cache) => cache.id === deleting.id);
    const remainingCaches = caches.filter((cache) => cache.id !== deleting.id);
    const nextCache = remainingCaches[Math.min(Math.max(deletedIndex, 0), remainingCaches.length - 1)];

    setCaches(remainingCaches);
    setSelectedId(nextCache?.id ?? "");
    setCacheToDelete(null);
    setShowShare(false);
    setDeletingCache(false);
    setNotice(`${deleting.gcCode} deleted`);
  }

  function addClue() {
    if (!selected) return;
    const clue = window.prompt("Add a short clue");
    if (clue?.trim()) updateSelected({ clues: [...selected.clues, clue.trim()] });
  }

  function openBulkImport() {
    setBulkTries("");
    setBulkImportError("");
    setBulkCsvName("");
    setBulkCsvSummary("");
    setShowBulkImport(true);
  }

  async function loadBulkFailedCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBulkImportError("");
    setBulkCsvSummary("");
    if (file.size > 2_000_000) {
      setBulkImportError("Choose a CSV file smaller than 2 MB.");
      return;
    }
    const parsed = parseFailedCoordinateCsv(await file.text());
    if (!parsed.attempts.length) {
      setBulkCsvName(file.name);
      setBulkImportError("No valid coordinates were found. Use Latitude and Longitude columns, or a Coordinates column.");
      return;
    }
    const lines = parsed.attempts.flatMap((attempt) => attempt.kind === "coordinate"
      ? [`${attempt.latitude.toFixed(6)}, ${attempt.longitude.toFixed(6)}`]
      : []);
    setBulkTries(lines.join("\n"));
    setBulkCsvName(file.name);
    setBulkCsvSummary(`${lines.length} ${lines.length === 1 ? "coordinate" : "coordinates"} ready${parsed.ignoredRows ? `; ignored ${parsed.ignoredRows} rows without coordinates` : ""}.`);
  }

  function importBulkFailedTries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.sharedBy) return;
    const parsed = parseBulkFailedAttempts(bulkTries);
    if (parsed.errors.length) {
      setBulkImportError(parsed.errors.join(" · "));
      return;
    }
    if (!parsed.attempts.length) {
      setBulkImportError("Paste at least one keyword, coordinate, or approach.");
      return;
    }

    const attempts = [...selected.attempts];
    const existingIndexes = new Map(attempts.map((attempt, index) => [bulkAttemptKey(attempt), index]));
    const importedAt = Date.now();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    parsed.attempts.forEach((attempt) => {
      const key = bulkAttemptKey(attempt);
      const existingIndex = existingIndexes.get(key);
      if (existingIndex !== undefined) {
        const existing = attempts[existingIndex];
        if (existing.state === "planned" || existing.state === "unchecked") {
          attempts[existingIndex] = { ...existing, state: "wrong", updatedAt: new Date(importedAt + updated).toISOString() };
          updated += 1;
        } else {
          // Never replace the one correct answer, and do not duplicate an existing failed try.
          skipped += 1;
        }
        return;
      }
      const next: CoordinateAttempt = {
        id: newId("attempt"),
        ...attempt,
        state: "wrong",
        createdAt: new Date(importedAt + added + updated).toISOString()
      };
      existingIndexes.set(key, attempts.length);
      attempts.push(next);
      added += 1;
    });
    if (!added && !updated) {
      setBulkImportError("Every entry is already in this mystery's history.");
      return;
    }
    updateSelected({ attempts });
    setShowBulkImport(false);
    setBulkTries("");
    setBulkImportError("");
    setBulkCsvName("");
    setBulkCsvSummary("");
    const imported = added + updated;
    setNotice(`Imported ${imported} failed ${imported === 1 ? "try" : "tries"}${updated ? ` (${updated} updated)` : ""}${skipped ? `; skipped ${skipped} already recorded or correct` : ""}`);
  }

  function openShare() {
    if (!selected || selected.sharedBy) return;
    setUserQuery("");
    setUserResults([]);
    setUserSearchState("idle");
    setShowShare(true);
  }

  function openSharingSettings() {
    setUserQuery("");
    setUserResults([]);
    setUserSearchState("idle");
    setShowSharingSettings(true);
  }

  async function saveSharingPreference(user: AppUser, statuses: MysteryStatus[]) {
    if (!statuses.length) return;
    setSavingPreferenceId(user.id);
    try {
      const { preference } = await apiFetch<{ preference: MysterySharingPreference }>(`/mysteries/sharing-preferences/${encodeURIComponent(user.id)}`, {
        method: "PUT",
        body: JSON.stringify({ statuses })
      });
      setSharingPreferences((current) => [
        ...current.filter((item) => item.recipient.id !== user.id),
        preference
      ]);
      setUserQuery("");
      setUserResults([]);
      setServerLoadAttempt((attempt) => attempt + 1);
      setNotice(`Automatic Myst sharing updated for ${user.username}`);
    } catch {
      setNotice(`Could not update automatic sharing for ${user.username}`);
    } finally {
      setSavingPreferenceId("");
    }
  }

  async function removeSharingPreference(preference: MysterySharingPreference) {
    setSavingPreferenceId(preference.recipient.id);
    try {
      await apiFetch(`/mysteries/sharing-preferences/${encodeURIComponent(preference.recipient.id)}`, { method: "DELETE" });
      setSharingPreferences((current) => current.filter((item) => item.recipient.id !== preference.recipient.id));
      setServerLoadAttempt((attempt) => attempt + 1);
      setNotice(`Stopped automatic Myst sharing with ${preference.recipient.username}`);
    } catch {
      setNotice(`Could not update automatic sharing for ${preference.recipient.username}`);
    } finally {
      setSavingPreferenceId("");
    }
  }

  function automaticallySharedWith(userId: string, status: MysteryStatus) {
    return sharingPreferences.some((preference) =>
      preference.recipient.id === userId && preference.statuses.includes(status)
    );
  }

  async function addSharedUser(user: AppUser) {
    if (!selected || selected.sharedWith.some((person) => person.id === user.id)) return;
    setSharingUserId(user.id);
    try {
      const { recipient, revision } = await apiFetch<{ recipient: AppUser; revision: number }>(`/mysteries/${encodeURIComponent(selected.id)}/shares`, {
        method: "POST",
        body: JSON.stringify({
          recipientId: user.id,
          mystery: shareableMystery(selected),
          revision: nextSnapshotRevision(selected.id)
        })
      });
      rememberSnapshotRevision(selected.id, revision);
      rememberShareMutation(selected.id);
      setCaches((current) => current.map((cache) =>
        cache.id === selected.id && !cache.sharedWith.some((person) => person.id === recipient.id)
          ? { ...cache, sharedWith: [...cache.sharedWith, recipient] }
          : cache
      ));
      setShowShare(false);
      setNotice(`Shared with ${recipient.username}`);
    } catch {
      setNotice(`Could not share with ${user.username}`);
    } finally {
      setSharingUserId("");
    }
  }

  async function removeSharedUser(user: AppUser) {
    if (!selected || selected.sharedBy) return;
    try {
      await apiFetch(`/mysteries/${encodeURIComponent(selected.id)}/shares/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      rememberShareMutation(selected.id);
      setCaches((current) => current.map((cache) =>
        cache.id === selected.id
          ? { ...cache, sharedWith: cache.sharedWith.filter((item) => item.id !== user.id) }
          : cache
      ));
      setNotice(`Stopped sharing with ${user.username}`);
    } catch {
      setNotice(`Could not update sharing for ${user.username}`);
    }
  }

  function attachImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    if (file.size > 1_500_000) {
      setNotice("Choose an image smaller than 1.5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateSelected({ image: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function exportGpx() {
    const solved = caches.flatMap((cache) => {
      const final = finalCoordinate(cache);
      return final ? [{ cache, final }] : [];
    });
    const points = solved
      .map(({ cache, final }) => `  <wpt lat="${final.latitude}" lon="${final.longitude}"><name>${escapeXml(cache.gcCode)}</name><desc>${escapeXml(cache.name)}</desc><type>Geocache|Unknown Cache</type></wpt>`)
      .join("\n");
    downloadFile("geostats-solved-mysteries.gpx", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">\n${points}\n</gpx>`, "application/gpx+xml");
    setNotice(`Exported ${solved.length} solved ${solved.length === 1 ? "cache" : "caches"}`);
  }

  async function copyAttemptsForAi() {
    if (!selected) return;
    const worked = selected.attempts.filter((attempt) => attempt.state === "correct");
    const failed = selected.attempts.filter((attempt) => attempt.state === "wrong");
    const unknown = selected.attempts.filter((attempt) => attempt.state === "unchecked");
    const lineForAttempt = (attempt: CoordinateAttempt) => {
      const revealed = revealedCoordinate(attempt);
      return `- ${attemptKindLabel(attempt)}: ${attemptInputLabel(attempt)}${attempt.note ? ` — ${attempt.note}` : ""}${revealed ? ` (revealed final coordinates: ${formatCoordinate(revealed.latitude, revealed.longitude)})` : ""}`;
    };
    const final = finalCoordinate(selected);
    const hasAttempts = selected.attempts.length > 0;
    const context = [
      `Cache: ${selected.gcCode} — ${selected.name}`,
      `Geocache link: https://coord.info/${selected.gcCode}`,
      locationLabel(selected) ? `Location: ${locationLabel(selected)}` : "",
      `Published coordinates: ${formatCoordinate(selected.publishedLatitude, selected.publishedLongitude)}`,
      final ? `Known final coordinates: ${formatCoordinate(final.latitude, final.longitude)}` : ""
    ].filter(Boolean).join("\n");
    const text = [
      hasAttempts
        ? "Help me continue solving this geocaching mystery without repeating previous attempts."
        : "Help me start solving this geocaching mystery. Analyze the available information and propose promising first attempts.",
      context,
      `DIDN'T WORK (${failed.length})\n${failed.length ? failed.map(lineForAttempt).join("\n") : "- None"}`,
      `WORKED (${worked.length})\n${worked.length ? worked.map(lineForAttempt).join("\n") : "- None"}`,
      selected.attempts.some((attempt) => attempt.state === "planned") ? `NOT TRIED YET\n${selected.attempts.filter((attempt) => attempt.state === "planned").map(lineForAttempt).join("\n")}` : "",
      unknown.length ? `RESULT UNKNOWN (${unknown.length})\n${unknown.map(lineForAttempt).join("\n")}` : "",
      selected.clues.length ? `CLUES\n${selected.clues.map((clue) => `- ${clue}`).join("\n")}` : "",
      selected.notes.trim() ? `NOTES\n${selected.notes.trim()}` : "",
      hasAttempts
        ? "Suggest useful next attempts and explain why they are different from everything already tried."
        : "Suggest useful first attempts and explain the reasoning behind each one."
    ].filter(Boolean).join("\n\n");

    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    setNotice(copied ? "AI solving summary copied" : "Could not copy the solving summary");
  }

  async function copyUserscript() {
    if (!userscript) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(userscript);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && scriptTextRef.current) {
      scriptTextRef.current.focus();
      scriptTextRef.current.select();
      copied = document.execCommand("copy");
    }
    setScriptCopied(copied);
    setNotice(copied ? "Userscript copied to clipboard" : "Select the script and press Ctrl+C");
  }

  const solvedCount = caches.filter((cache) => cache.status === "solved").length;
  const attemptCount = caches.reduce((sum, cache) => sum + cache.attempts.length, 0);

  return (
    <AppShell>
      <header className="page-header mystery-header">
        <div>
          <p className="eyebrow">Your private solving desk</p>
          <h1>Mysteries</h1>
          <p className="mystery-subtitle">Keep every clue, coordinate and eureka moment in one place.</p>
        </div>
        <div className="mystery-header-actions">
          <span className="offline-pill"><WifiOff size={14} /> Available offline</span>
          <button className="secondary-button" type="button" disabled={!syncableCaches.length} onClick={() => syncAttempts(syncableCaches)}><ExternalLink size={17} /> Sync solved{syncableCaches.length ? ` (${syncableCaches.length})` : ""}</button>
          <button className="secondary-button" type="button" onClick={() => setShowBrowserImport(true)}><Import size={17} /> Browser import</button>
          <button className="secondary-button" type="button" onClick={exportGpx}><Download size={17} /> Export GPX</button>
          <button className="secondary-button" type="button" onClick={openSharingSettings}><Settings2 size={17} /> Sharing settings</button>
          <button className="primary-button icon-button" type="button" onClick={() => setShowAdd(true)}><Plus size={18} /> Add mystery</button>
        </div>
      </header>

      <section className="mystery-overview" aria-label="Mystery overview">
        <div><span>In your workspace</span><strong>{caches.length}</strong><small>mystery caches</small></div>
        <div><span>Solved</span><strong>{solvedCount}</strong><small>{caches.length ? Math.round((solvedCount / caches.length) * 100) : 0}% complete</small></div>
        <div><span>Checker tries</span><strong>{attemptCount}</strong><small>keywords & coordinates</small></div>
      </section>

      <section className="mystery-workspace">
        <aside className="mystery-list-panel">
          <div className="mystery-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, name or location" aria-label="Search mysteries" />
          </div>
          <div className="mystery-filter-row">
            {(["all", "solving", "solved", "planned"] as const).map((value) => (
              <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)} type="button">{value}</button>
            ))}
          </div>
          <div className="mystery-cache-list">
              <div className="mystery-cache-group">
                <p>Mystery caches<span>{filteredCaches.length}</span></p>
                {filteredCaches.map((cache) => {
                  const final = finalCoordinate(cache);
                  const testedAnswers = cache.attempts.map(attemptInputLabel);
                  return (
                    <button className={`mystery-cache-card ${selected?.id === cache.id ? "active" : ""}`} type="button" key={cache.id} onClick={() => setSelectedId(cache.id)}>
                      <span className={`cache-status-dot ${cache.status}`}><CircleDot size={16} /></span>
                      <span className="mystery-card-copy"><small>{cache.gcCode}{locationLabel(cache) ? ` · ${locationLabel(cache)}` : ""}</small><strong>{cache.name}</strong><em title={testedAnswers.length ? `Tested: ${testedAnswers.join(" · ")}` : undefined}>{final ? formatCoordinate(final.latitude, final.longitude) : testedAnswers.length ? `Tried: ${testedAnswers.join(" · ")}` : "No checker tries yet"}</em></span>
                      <ChevronRight size={17} />
                    </button>
                  );
                })}
              </div>
            {!filteredCaches.length && <p className="mystery-empty">No mysteries match this view.</p>}
          </div>
        </aside>

        {selected ? (
          <article className="mystery-detail">
            <div className="mystery-detail-hero">
              <div>
                <div className="detail-kicker"><span className={`status-badge ${selected.status}`}>{selected.status}</span><a href={`https://coord.info/${selected.gcCode}`} target="_blank" rel="noreferrer">{selected.gcCode}</a>{locationLabel(selected) && <span>{locationLabel(selected)}</span>}</div>
                <h2>{selected.name}</h2>
                <p><MapPin size={15} /> Published at {formatCoordinate(selected.publishedLatitude, selected.publishedLongitude)}</p>
              </div>
              <div className="detail-actions">
                {!selected.sharedBy && <button className="secondary-button" type="button" onClick={openShare}><Share2 size={16} /> Share</button>}
                {!selected.sharedBy && <label className="secondary-button image-button"><ImagePlus size={16} /> Add image<input type="file" accept="image/*" onChange={attachImage} /></label>}
                {!selected.sharedBy && <button className="secondary-button danger-button" type="button" onClick={() => setCacheToDelete(selected)}><Trash2 size={16} /> Delete</button>}
              </div>
            </div>

            {selected.image && <div className="mystery-image"><img src={selected.image} alt={`Attached reference for ${selected.name}`} /><button type="button" onClick={() => updateSelected({ image: undefined })}><X size={15} /> Remove</button></div>}

            {selected.syncConflicts && <section className="mystery-sync-conflicts" aria-label="Offline edit conflicts">
              <div><AlertTriangle size={18} /><span><strong>Offline edits need review</strong><small>The server version is active. Restore your device edit or keep the server value.</small></span></div>
              {selected.syncConflicts.notes && <div className="mystery-sync-conflict-row"><span><strong>Notes from this device</strong><small>{selected.syncConflicts.notes.device || "Notes were cleared on this device."}</small></span><button className="secondary-button" type="button" onClick={() => resolveSyncConflict("notes", true)}>Use device</button><button className="text-button" type="button" onClick={() => resolveSyncConflict("notes", false)}>Keep server</button></div>}
              {selected.syncConflicts.image && <div className="mystery-sync-conflict-row"><span><strong>Image from this device</strong><small>{selected.syncConflicts.image.device ? "A different image was saved on this device." : "The image was removed on this device."}</small></span><button className="secondary-button" type="button" onClick={() => resolveSyncConflict("image", true)}>Use device</button><button className="text-button" type="button" onClick={() => resolveSyncConflict("image", false)}>Keep server</button></div>}
            </section>}

            <div className="clue-strip">
              <span><Sparkles size={15} /> Clues</span>
              {selected.clues.map((clue) => <button title="Remove clue" type="button" key={clue} onClick={() => updateSelected({ clues: selected.clues.filter((item) => item !== clue) })}>{clue}<X size={12} /></button>)}
              <button className="add-clue" type="button" onClick={addClue}><Plus size={13} /> Add clue</button>
            </div>

            <div className="mystery-detail-grid">
              <section className="mystery-section coordinate-section">
                <div className="section-heading checker-heading">
                  <div><p className="eyebrow">Checker lab</p><h3>Test history</h3></div>
                  <div className="checker-heading-actions">
                    {!selected.sharedBy && <button className="secondary-button" type="button" onClick={openBulkImport}><Import size={15} /> Bulk failed tries</button>}
                    <button className="secondary-button copy-ai-button" type="button" onClick={() => void copyAttemptsForAi()}><Copy size={15} /> Copy for AI</button>
                  </div>
                </div>
                <div className="attempt-overview">
                  <div className="attempt-overview-counts" aria-label="Checker result summary">
                    <span><strong>{selected.attempts.length}</strong><small>Recorded</small></span>
                    <span className="failed"><strong>{selected.attempts.filter((attempt) => attempt.state === "wrong").length}</strong><small>Didn't work</small></span>
                    <span className="worked"><strong>{selected.attempts.filter((attempt) => attempt.state === "correct").length}</strong><small>Worked</small></span>
                  </div>
                  <label className="attempt-search"><Search size={15} /><input value={attemptSearch} onChange={(event) => setAttemptSearch(event.target.value)} placeholder="Search whether an answer was already tried…" aria-label="Search tested answers" />{attemptSearch && <button type="button" onClick={() => setAttemptSearch("")} aria-label="Clear tested answer search"><X size={14} /></button>}</label>
                  {selected.attempts.length ? (
                    <div className="attempt-result-groups" aria-live="polite">
                      {normalizedAttemptSearch && !matchingAttempts.length ? <p className="attempt-search-result new"><Sparkles size={15} /><strong>Not found in your history.</strong> This answer has not been saved as tried.</p> : null}
                      {matchingFailedAttempts.length ? <section className="attempt-result-group failed"><div><X size={15} /><strong>Didn't work</strong><small>{matchingFailedAttempts.length}{normalizedAttemptSearch ? " matching" : ""}</small></div><div>{matchingFailedAttempts.map((attempt) => <span key={attempt.id}>{attemptKindLabel(attempt)}<strong>{attemptInputLabel(attempt)}</strong></span>)}</div></section> : null}
                      {matchingWorkedAttempts.length ? <section className="attempt-result-group worked"><div><Check size={15} /><strong>Worked</strong><small>{matchingWorkedAttempts.length}{normalizedAttemptSearch ? " matching" : ""}</small></div><div>{matchingWorkedAttempts.map((attempt) => <span key={attempt.id}>{attemptKindLabel(attempt)}<strong>{attemptInputLabel(attempt)}</strong></span>)}</div></section> : null}
                      {matchingUnknownAttempts.length ? <section className="attempt-result-group unknown"><div><CircleDot size={15} /><strong>Result unknown</strong><small>{matchingUnknownAttempts.length}{normalizedAttemptSearch ? " matching" : ""}</small></div><div>{matchingUnknownAttempts.map((attempt) => <span key={attempt.id}>{attemptKindLabel(attempt)}<strong>{attemptInputLabel(attempt)}</strong></span>)}</div></section> : null}
                      {matchingPlannedAttempts.length ? <section className="attempt-result-group planned"><div><Sparkles size={15} /><strong>Not tried</strong><small>{matchingPlannedAttempts.length}{normalizedAttemptSearch ? " matching" : ""}</small></div><div>{matchingPlannedAttempts.map((attempt) => <span key={attempt.id}>{attemptKindLabel(attempt)}<strong>{attemptInputLabel(attempt)}</strong></span>)}</div></section> : null}
                    </div>
                  ) : <p className="attempt-search-result"><MapPin size={15} />Nothing has been tested for {selected.gcCode} yet.</p>}
                </div>
                <form className="coordinate-form" onSubmit={addAttempt}>
                  <label className="attempt-type-field"><span>Try type</span><select value={attemptType} onChange={(event) => { setAttemptType(event.target.value as AttemptKind); setCoordinate(""); setCoordinateError(""); }}><option value="coordinate">Coordinate</option><option value="keyword">Keyword</option><option value="approach">Solving approach</option></select></label>
                  <label className="attempt-answer-field"><span>{attemptType === "keyword" ? "Keyword" : attemptType === "approach" ? "Approach" : "Coordinate tried"}</span><input value={coordinate} onChange={(event) => setCoordinate(event.target.value)} placeholder={attemptType === "keyword" ? "Enter checker keyword" : attemptType === "approach" ? "Example: Decode title as ROT13" : "59.40582, 18.36120"} /></label>
                  <label className="checker-result-field"><span>Status</span><select value={coordinateState} onChange={(event) => setCoordinateState(event.target.value as CheckState)}><option value="wrong">Didn't work</option><option value="correct">Worked</option><option value="planned">Not tried yet</option><option value="unchecked">Result unknown</option></select></label>
                  <label className="final-coordinate-field"><span>Final coordinates <small>{coordinateState === "correct" && attemptType === "keyword" ? "(required)" : "(if revealed)"}</small></span><input value={finalCoordinateText} onChange={(event) => setFinalCoordinateText(event.target.value)} placeholder="Coordinates returned by checker" /></label>
                  <button className="primary-button" type="submit"><Plus size={17} /> Save try</button>
                </form>
                {coordinateError && <p className="coordinate-error"><AlertTriangle size={15} /> {coordinateError}</p>}
                <div className="attempt-list">
                  {selected.attempts.map((attempt) => {
                    const final = solvedCoordinateForAttempt(attempt);
                    const submitted = inputCoordinate(attempt);
                    const distanceCoordinate = final ?? submitted;
                    const distance = distanceCoordinate ? distanceKm(selected.publishedLatitude, selected.publishedLongitude, distanceCoordinate.latitude, distanceCoordinate.longitude) : null;
                    return (
                      <div className="attempt-row" key={attempt.id}>
                        <span className={`attempt-state ${attempt.state}`}>{attempt.state === "correct" ? <Check size={16} /> : attempt.state === "wrong" ? <X size={16} /> : <CircleDot size={16} />}</span>
                        <span><strong>{attemptInputLabel(attempt)}</strong>{attempt.note && <em>{attempt.note}</em>}{revealedCoordinate(attempt) && <em>Final: {formatCoordinate(attempt.finalLatitude!, attempt.finalLongitude!)}</em>}<small>{attemptKindLabel(attempt)}{attempt.source ? ` · ${attempt.source}` : ""} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.createdAt))}</small></span>
                        {distance !== null && <span className={`distance-badge ${distance > MAX_REASONABLE_DISTANCE_KM ? "warning" : ""}`}>{distance > MAX_REASONABLE_DISTANCE_KM && <AlertTriangle size={13} />}{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} away</span>}
                        {selected.status === "solved" && final && finalCoordinate(selected)?.attempt.id === attempt.id ? (
                          attempt.geocachingSyncedAt ? (
                            <span className="coordinate-sync-status" title={`Synced ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.geocachingSyncedAt))}`}><Check size={13} /> Synced</span>
                          ) : (
                            <button className="coordinate-sync-button" type="button" onClick={() => syncAttempt(selected, attempt)}><ExternalLink size={13} /> Sync</button>
                          )
                        ) : <span className={`checker-label ${attempt.state}`}>{stateLabel(attempt.state)}</span>}
                        <button className="row-delete" aria-label="Delete checker try" type="button" onClick={() => deleteAttempt(attempt.id)}><Trash2 size={15} /></button>
                      </div>
                    );
                  })}
                  {!selected.attempts.length && <div className="attempt-empty"><MapPin size={24} /><strong>No checker tries yet</strong><small>Add a coordinate or keyword above. Save any final coordinates the checker reveals.</small></div>}
                </div>
              </section>

              <aside className="mystery-side-column">
                <section className="mystery-section notes-section">
                  <div className="section-heading"><div><p className="eyebrow">Working notes</p><h3>Solution & field notes</h3></div><small>{serverSyncReady ? "Account sync on" : "Saved offline"}</small></div>
                  <textarea value={selected.notes} onChange={(event) => updateSelected({ notes: event.target.value })} placeholder="Write down clues, calculations and things to bring…" />
                </section>
                <section className="mystery-section shared-section">
                  <div className="section-heading"><div><p className="eyebrow">Team</p><h3>Shared with</h3></div><Users size={18} /></div>
                  <div className="people-list">
                    {selected.sharedBy && <small>Shared by {selected.sharedBy.username}</small>}
                    {selected.sharedWith.map((person) => {
                      const automatic = !selected.sharedBy && automaticallySharedWith(person.id, selected.status);
                      return <button title={selected.sharedBy ? person.username : automatic ? "Managed by your Myst sharing settings" : `Remove ${person.username}`} type="button" disabled={Boolean(selected.sharedBy) || automatic} key={person.id} onClick={() => void removeSharedUser(person)}><span>{person.username.charAt(0).toUpperCase()}</span>{person.username}{automatic ? <small>Auto</small> : !selected.sharedBy && <X size={12} />}</button>;
                    })}
                    {!selected.sharedWith.length && <small>Only you can see this cache.</small>}
                  </div>
                  {!selected.sharedBy && <button className="text-button" type="button" onClick={openShare}><Plus size={15} /> Share with a Geostats user</button>}
                </section>
              </aside>
            </div>
          </article>
        ) : <div className="mystery-detail mystery-empty-detail"><Sparkles size={32} /><h2>Add your first mystery</h2><button className="primary-button" type="button" onClick={() => setShowAdd(true)}>Add mystery</button></div>}
      </section>

      {showAdd && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}>
          <form className="mystery-modal" onSubmit={addCache} onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">New workspace</p><h2>Add a mystery cache</h2></div><button className="row-delete" type="button" onClick={() => setShowAdd(false)}><X /></button></div>
            <div className="two-column"><label>GC code<input name="gcCode" required placeholder="GC12345" pattern="GC[A-Za-z0-9]+" /></label><label>Cache name<input name="name" required placeholder="The hidden message" /></label></div>
            <label>Published coordinates<input name="published" required placeholder="59.34312, 18.07341" /></label>
            <div className="two-column"><label>Country<input name="country" placeholder="Sweden" /></label><label>Region / state<input name="region" placeholder="Svealand" /></label></div>
            <div className="two-column"><label>County<input name="county" placeholder="Stockholm County" /></label><label>Area / district<input name="area" placeholder="Vaxholm Municipality" /></label></div>
            <label>Locality<input name="locality" placeholder="Vaxholm" /></label>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-button" type="submit">Add to workspace</button></div>
          </form>
        </div>
      )}

      {showBulkImport && selected && !selected.sharedBy && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setShowBulkImport(false)}>
          <form className="mystery-modal bulk-tries-modal" onSubmit={importBulkFailedTries} onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Test history</p><h2>Import failed tries</h2></div><button className="row-delete" type="button" aria-label="Close" onClick={() => setShowBulkImport(false)}><X /></button></div>
            <p className="bulk-tries-lead">Upload a CSV to extract only its coordinates, or paste entries manually. Every imported entry is marked <strong>Didn't work</strong>; this importer never creates a correct answer.</p>
            <label className="bulk-csv-picker"><span>CSV file</span><span className="secondary-button"><Import size={16} /> Choose CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void loadBulkFailedCsv(event)} /></span>{bulkCsvName && <small>{bulkCsvName}</small>}</label>
            {bulkCsvSummary && <p className="bulk-csv-summary"><Check size={15} /> {bulkCsvSummary}</p>}
            <label><span>Failed tries</span><textarea autoFocus rows={12} value={bulkTries} onChange={(event) => { setBulkTries(event.target.value); setBulkImportError(""); }} placeholder={"59.40582, 18.36120\nkeyword: BLUEBIRD\napproach: Decode the title as ROT13\nplain text becomes a keyword"} /></label>
            <small className="bulk-tries-help">Coordinates are recognized automatically. Use <strong>keyword:</strong> or <strong>approach:</strong> to choose a type explicitly. Blank lines and duplicates are ignored.</small>
            {bulkImportError && <p className="coordinate-error"><AlertTriangle size={15} /> {bulkImportError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowBulkImport(false)}>Cancel</button><button className="primary-button" type="submit"><Import size={16} /> Import as didn't work</button></div>
          </form>
        </div>
      )}

      {showShare && selected && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setShowShare(false)}>
          <div className="mystery-modal share-user-modal" role="dialog" aria-modal="true" aria-labelledby="share-user-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Geostats accounts</p><h2 id="share-user-title">Share this mystery</h2></div><button className="row-delete" type="button" aria-label="Close" onClick={() => setShowShare(false)}><X /></button></div>
            <p className="share-user-lead">Search by app username. Only people with a Geostats login can be added.</p>
            <label className="share-user-search"><span>Username</span><span><Search size={17} /><input autoFocus value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Type at least 2 characters" /></span></label>
            <div className="share-user-results" aria-live="polite">
              {userSearchState === "loading" && <small>Searching registered users…</small>}
              {userSearchState === "error" && <small className="share-user-error">Could not search users. Try again.</small>}
              {userSearchState === "idle" && userQuery.trim().length < 2 && <small>Enter at least 2 characters to search.</small>}
              {userSearchState === "idle" && userQuery.trim().length >= 2 && !userResults.length && <small>No registered users found.</small>}
              {userResults.map((user) => {
                const alreadyShared = selected.sharedWith.some((person) => person.id === user.id);
                const sharing = sharingUserId === user.id;
                return <button key={user.id} type="button" disabled={alreadyShared || Boolean(sharingUserId)} onClick={() => void addSharedUser(user)}><span>{user.username.charAt(0).toUpperCase()}</span><strong>{user.username}</strong><small>{alreadyShared ? "Already shared" : sharing ? "Sharing…" : "Add user"}</small></button>;
              })}
            </div>
            <div className="modal-actions"><button className="text-button" type="button" onClick={() => { setShowShare(false); openSharingSettings(); }}><Settings2 size={15} /> Share multiple Mysts</button><button className="secondary-button" type="button" onClick={() => setShowShare(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showSharingSettings && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setShowSharingSettings(false)}>
          <div className="mystery-modal share-user-modal sharing-settings-modal" role="dialog" aria-modal="true" aria-labelledby="sharing-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Automatic access</p><h2 id="sharing-settings-title">Myst sharing settings</h2></div><button className="row-delete" type="button" aria-label="Close" onClick={() => setShowSharingSettings(false)}><X /></button></div>
            <p className="share-user-lead">Choose who can automatically see your Myst workspaces and which stages you want to share. New Mysts and status changes follow these settings too.</p>
            <div className="sharing-preference-list">
              {sharingPreferences.map((preference) => (
                <div className="sharing-preference" key={preference.recipient.id}>
                  <div className="sharing-preference-person"><span>{preference.recipient.username.charAt(0).toUpperCase()}</span><strong>{preference.recipient.username}</strong><button className="text-button" type="button" disabled={savingPreferenceId === preference.recipient.id} onClick={() => void removeSharingPreference(preference)}>Stop sharing</button></div>
                  <div className="sharing-statuses" aria-label={`Myst statuses shared with ${preference.recipient.username}`}>
                    {(["solving", "solved", "planned"] as const).map((status) => {
                      const checked = preference.statuses.includes(status);
                      const nextStatuses = checked ? preference.statuses.filter((item) => item !== status) : [...preference.statuses, status];
                      return <label key={status}><input type="checkbox" checked={checked} disabled={Boolean(savingPreferenceId) || (checked && preference.statuses.length === 1)} onChange={() => void saveSharingPreference(preference.recipient, nextStatuses)} /><span>{status}</span></label>;
                    })}
                  </div>
                </div>
              ))}
              {!sharingPreferences.length && <small>No automatic sharing yet. Add a Geostats user below.</small>}
            </div>
            <label className="share-user-search"><span>Add a person</span><span><Search size={17} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search by username" /></span></label>
            <div className="share-user-results" aria-live="polite">
              {userSearchState === "loading" && <small>Searching registered users…</small>}
              {userSearchState === "error" && <small className="share-user-error">Could not search users. Try again.</small>}
              {userQuery.trim().length >= 2 && userSearchState === "idle" && !userResults.length && <small>No registered users found.</small>}
              {userResults.map((user) => {
                const preference = sharingPreferences.find((item) => item.recipient.id === user.id);
                return <button key={user.id} type="button" disabled={Boolean(preference) || Boolean(savingPreferenceId)} onClick={() => void saveSharingPreference(user, ["solving", "solved", "planned"])}><span>{user.username.charAt(0).toUpperCase()}</span><strong>{user.username}</strong><small>{preference ? "Already added" : savingPreferenceId === user.id ? "Adding…" : "Share all Mysts"}</small></button>;
              })}
            </div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowSharingSettings(false)}>Done</button></div>
          </div>
        </div>
      )}

      {cacheToDelete && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setCacheToDelete(null)}>
          <div className="mystery-modal delete-cache-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-cache-title" aria-describedby="delete-cache-description" onMouseDown={(event) => event.stopPropagation()}>
            <div className="delete-cache-warning"><AlertTriangle size={22} /></div>
            <div>
              <p className="eyebrow">Permanent removal</p>
              <h2 id="delete-cache-title">Delete {cacheToDelete.gcCode}?</h2>
            </div>
            <p id="delete-cache-description">This removes <strong>{cacheToDelete.name}</strong>, including its notes, clues, images and coordinate attempts. This cannot be undone.</p>
            <div className="modal-actions"><button className="secondary-button" type="button" disabled={deletingCache} onClick={() => setCacheToDelete(null)}>Cancel</button><button className="primary-button danger-button" type="button" disabled={deletingCache} onClick={() => void deleteCache()}><Trash2 size={16} /> {deletingCache ? "Deleting…" : "Delete cache"}</button></div>
          </div>
        </div>
      )}

      {showBrowserImport && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setShowBrowserImport(false)}>
          <div className="mystery-modal browser-import-modal" role="dialog" aria-modal="true" aria-labelledby="browser-import-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">One-click capture</p><h2 id="browser-import-title">Import from geocaching.com</h2></div><button className="row-delete" type="button" aria-label="Close" onClick={() => setShowBrowserImport(false)}><X /></button></div>
            <p className="browser-import-lead">The helper imports the cache name, published coordinates and every location level the page exposes—country, region/state, county/area and locality—and automatically saves corrected coordinates using your signed-in Geocaching session. Use the install button to add it or update your existing copy.</p>
            <ol className="browser-import-steps">
              <li><span>1</span><div><strong>Install Tampermonkey</strong><small>Available for Chrome, Edge, Firefox and Safari.</small></div></li>
              <li><span>2</span><div><strong>Install or update the helper</strong><small>Use the button below and confirm the installation in Tampermonkey.</small></div></li>
              <li><span>3</span><div><strong>Keep it enabled</strong><small>Tampermonkey will automatically use the newest installed version on cache pages.</small></div></li>
              <li><span>4</span><div><strong>Open a mystery cache</strong><small>Press the green button; Geostats opens with the cache selected.</small></div></li>
            </ol>
            <div className="userscript-copy-block">
              <div className="collector-command-title"><span>Geostats Mystery Importer.user.js</span><button className="secondary-button collector-command-action" type="button" disabled={!userscript} onClick={copyUserscript}>{scriptCopied ? <Check size={15} /> : <Copy size={15} />}{scriptCopied ? "Copied" : "Copy script"}</button></div>
              {userscriptError ? <p className="coordinate-error"><AlertTriangle size={15} /> {userscriptError}</p> : <textarea ref={scriptTextRef} readOnly spellCheck={false} value={userscript || "Generating script…"} aria-label="Tampermonkey userscript" />}
            </div>
            <div className="browser-import-privacy"><WifiOff size={17} /><span><strong>Local and token-free</strong><small>The cache data travels directly between your browser tabs. Your collector token is never exposed.</small></span></div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowBrowserImport(false)}>Close</button><button className="secondary-button icon-button" type="button" disabled={!userscript} onClick={copyUserscript}>{scriptCopied ? <Check size={17} /> : <Copy size={17} />} {scriptCopied ? "Copied" : "Copy script"}</button><a className="primary-button icon-button" href={`/mysteries/tampermonkey.user.js?v=${MYSTERY_USERSCRIPT_VERSION}`} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Install/update helper</a></div>
          </div>
        </div>
      )}

      <div className="mystery-toast" role="status" aria-live="polite">
        {notice && (
          <>
            <Check size={16} aria-hidden="true" />
            <span>{notice}</span>
          </>
        )}
      </div>
    </AppShell>
  );
}
