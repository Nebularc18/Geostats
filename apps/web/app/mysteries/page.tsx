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
  Share2,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
  X
} from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { normalizeMysteryArea } from "../../lib/mystery-area";
import { MYSTERY_USERSCRIPT_VERSION } from "../../lib/mystery-userscript";

type CheckState = "correct" | "wrong" | "unchecked";
type MysteryStatus = "solving" | "solved" | "planned";

type CoordinateAttempt = {
  id: string;
  latitude: number;
  longitude: number;
  state: CheckState;
  createdAt: string;
  geocachingSyncedAt?: string;
};

type AppUser = {
  id: string;
  username: string;
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
  publishedLatitude: number;
  publishedLongitude: number;
  notes: string;
  clues: string[];
  sharedWith: AppUser[];
  attempts: CoordinateAttempt[];
  image?: string;
  sharedBy?: AppUser;
  sharedWorkspaceId?: string;
};

type SharedMysteryGrant = {
  workspaceId: string;
  mystery: MysteryCache;
  owner: AppUser;
  sharedWith: AppUser[];
};

type OwnedMysteryShares = {
  clientId: string;
  revision: number;
  sharedWith: AppUser[];
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
const DELETION_STORAGE_KEY = "geostats-mystery-deletions-v1";
const DELETION_CHANNEL = "geostats-mystery-deletions";
const MAX_REASONABLE_DISTANCE_KM = 3.2;

const starterCaches: MysteryCache[] = [
  {
    id: "mystery-archipelago",
    gcCode: "GC9X7K2",
    name: "The Lighthouse Cipher",
    area: "Vaxholm",
    country: "Sweden",
    status: "solved",
    publishedLatitude: 59.40235,
    publishedLongitude: 18.35371,
    notes: "The first letters in each paragraph form the key. Bring a UV light for the final container.",
    clues: ["Vigenère", "Lighthouse years", "UV light"],
    sharedWith: [],
    attempts: [
      { id: "a1", latitude: 59.40582, longitude: 18.3612, state: "wrong", createdAt: "2026-07-18T19:42:00.000Z" },
      { id: "a2", latitude: 59.40817, longitude: 18.36743, state: "correct", createdAt: "2026-07-19T08:16:00.000Z" }
    ]
  },
  {
    id: "mystery-library",
    gcCode: "GCAB4M8",
    name: "Between the Lines",
    area: "Stockholm",
    country: "Sweden",
    status: "solving",
    publishedLatitude: 59.34312,
    publishedLongitude: 18.07341,
    notes: "Likely a book cipher. Page numbers are hidden in the gallery captions.",
    clues: ["Book cipher", "Gallery captions"],
    sharedWith: [],
    attempts: [
      { id: "a3", latitude: 59.33914, longitude: 18.08125, state: "unchecked", createdAt: "2026-07-21T20:04:00.000Z" }
    ]
  },
  {
    id: "mystery-stones",
    gcCode: "GC8P2QF",
    name: "Runes in the Forest",
    area: "Uppsala",
    country: "Sweden",
    status: "planned",
    publishedLatitude: 59.85863,
    publishedLongitude: 17.63893,
    notes: "Photograph the rune stones in order before starting the solve.",
    clues: ["Younger Futhark"],
    sharedWith: [],
    attempts: []
  }
];

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

function formatCoordinate(latitude: number, longitude: number) {
  const part = (value: number, positive: string, negative: string, degrees: number) => {
    const absolute = Math.abs(value);
    const wholeDegrees = Math.floor(absolute);
    const minutes = (absolute - wholeDegrees) * 60;
    return `${value >= 0 ? positive : negative} ${String(wholeDegrees).padStart(degrees, "0")}° ${minutes.toFixed(3)}'`;
  };
  return `${part(latitude, "N", "S", 2)}  ${part(longitude, "E", "W", 3)}`;
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
  if (state === "wrong") return "Not correct";
  return "Not checked";
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

function verifiedStoredShares(caches: MysteryCache[]) {
  return caches.map((cache) => ({
    ...cache,
    area: normalizeMysteryArea(cache.area),
    county: normalizeMysteryArea(cache.county),
    country: normalizeMysteryArea(cache.country),
    region: normalizeMysteryArea(cache.region),
    locality: normalizeMysteryArea(cache.locality),
    locationHierarchy: Array.isArray(cache.locationHierarchy)
      ? cache.locationHierarchy.map(normalizeMysteryArea).filter(Boolean)
      : [],
    sharedWith: Array.isArray(cache.sharedWith) ? cache.sharedWith.filter(isAppUser) : []
  }));
}

function shareableMystery(cache: MysteryCache) {
  const { sharedBy: _sharedBy, sharedWorkspaceId: _sharedWorkspaceId, ...mystery } = cache;
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
    notes: "Imported from geocaching.com with the Geostats Tampermonkey helper.",
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
      if (
        attempt.id !== attemptId ||
        attempt.state !== "correct" ||
        Math.abs(attempt.latitude - latitude) >= 0.000001 ||
        Math.abs(attempt.longitude - longitude) >= 0.000001 ||
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
  const snapshotRevisions = useRef(new Map<string, number>());
  const shareMutationRevisions = useRef(new Map<string, number>());
  const deletedCacheIds = useRef(new Set<string>());
  const deletionChannel = useRef<BroadcastChannel | null>(null);
  const [caches, setCaches] = useState<MysteryCache[]>([]);
  const [persistedForSync, setPersistedForSync] = useState<MysteryCache[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MysteryStatus>("all");
  const [coordinate, setCoordinate] = useState("");
  const [coordinateState, setCoordinateState] = useState<CheckState>("unchecked");
  const [coordinateError, setCoordinateError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBrowserImport, setShowBrowserImport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [cacheToDelete, setCacheToDelete] = useState<MysteryCache | null>(null);
  const [deletingCache, setDeletingCache] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<AppUser[]>([]);
  const [userSearchState, setUserSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [sharingUserId, setSharingUserId] = useState("");
  const [userscript, setUserscript] = useState("");
  const [userscriptError, setUserscriptError] = useState("");
  const [scriptCopied, setScriptCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const scriptTextRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const storedDeletionIds = JSON.parse(localStorage.getItem(DELETION_STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(storedDeletionIds)) {
        deletedCacheIds.current = new Set(storedDeletionIds.filter((cacheId): cacheId is string => typeof cacheId === "string" && cacheId.length > 0));
      }
    } catch {
      localStorage.removeItem(DELETION_STORAGE_KEY);
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    let initial = starterCaches;
    if (saved) {
      try {
        initial = verifiedStoredShares(JSON.parse(saved) as MysteryCache[]);
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
    if (!ready || !persistedForSync) return;
    const sharedCaches = persistedForSync.filter((cache) =>
      !cache.sharedBy &&
      cache.sharedWith.length > 0 &&
      snapshotRevisions.current.has(cache.id)
    );
    if (!sharedCaches.length) return;

    const timeout = window.setTimeout(() => {
      void Promise.all(sharedCaches.map((cache) =>
        apiFetch<{ revision: number }>(`/mysteries/${encodeURIComponent(cache.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            mystery: shareableMystery(cache),
            revision: nextSnapshotRevision(cache.id)
          })
        }).then(({ revision }) => rememberSnapshotRevision(cache.id, revision))
      )).catch(() => {
        setNotice("Saved locally, but shared copies could not be updated.");
      });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [persistedForSync, ready]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
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
    const reconciliationRevisions = new Map(shareMutationRevisions.current);
    void apiFetch<{ mysteries: OwnedMysteryShares[]; deletedClientIds: string[] }>("/mysteries/owned-shares")
      .then(({ mysteries, deletedClientIds }) => {
        if (!active) return;
        const serverDeletedIds = Array.isArray(deletedClientIds)
          ? deletedClientIds.filter((cacheId): cacheId is string => typeof cacheId === "string" && cacheId.length > 0)
          : [];
        serverDeletedIds.forEach(rememberDeletedCache);
        const sharesByClientId = new Map(mysteries.map(({ clientId, revision, sharedWith }) => {
          rememberSnapshotRevision(clientId, revision);
          return [
          clientId,
          Array.isArray(sharedWith) ? sharedWith.filter(isAppUser) : []
          ] as const;
        }));
        setPersistedForSync((current) => current ? [...current] : current);
        setCaches((current) => current.filter((cache) => !deletedCacheIds.current.has(cache.id)).map((cache) => {
          const sharedWith = sharesByClientId.get(cache.id);
          const unchangedSinceRequest =
            (shareMutationRevisions.current.get(cache.id) ?? 0) === (reconciliationRevisions.get(cache.id) ?? 0);
          return !cache.sharedBy && sharedWith && unchangedSinceRequest ? { ...cache, sharedWith } : cache;
        }));
      })
      .catch(() => {
        // Keep the locally cached owner grant list while offline.
      });
    return () => {
      active = false;
    };
  }, [ready]);

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
    if (!showShare || normalizedQuery.length < 2) {
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
  }, [showShare, userQuery]);

  const selected = caches.find((cache) => cache.id === selectedId) ?? caches[0];
  const syncableCaches = useMemo(() => caches.flatMap((cache) => {
    if (cache.status !== "solved") return [];
    const attempt = cache.attempts.find((item) => item.state === "correct");
    return attempt && !attempt.geocachingSyncedAt ? [{ cache, attempt }] : [];
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

  function rememberDeletedCache(cacheId: string) {
    rememberDeletedCaches([cacheId]);
  }

  function rememberDeletedCaches(cacheIds: string[]) {
    cacheIds.forEach((cacheId) => deletedCacheIds.current.add(cacheId));
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
    const parsed = parseCoordinate(coordinate);
    if (!parsed) {
      setCoordinateError("Use decimal coordinates or N 59° 20.123' E 018° 04.321'.");
      return;
    }
    const duplicate = selected.attempts.some(
      (attempt) => Math.abs(attempt.latitude - parsed.latitude) < 0.000001 && Math.abs(attempt.longitude - parsed.longitude) < 0.000001
    );
    if (duplicate) {
      setCoordinateError("You have already tried these coordinates.");
      return;
    }
    const nextAttempt: CoordinateAttempt = {
      id: newId("attempt"),
      ...parsed,
      state: coordinateState,
      createdAt: new Date().toISOString()
    };
    updateSelected({
      attempts: [nextAttempt, ...selected.attempts],
      status: coordinateState === "correct" ? "solved" : selected.status
    });
    setCoordinate("");
    setCoordinateError("");
    setNotice("Coordinate saved offline");
  }

  function deleteAttempt(attemptId: string) {
    if (!selected) return;
    const remainingAttempts = selected.attempts.filter((attempt) => attempt.id !== attemptId);
    updateSelected({
      attempts: remainingAttempts,
      status: selected.status === "solved" && !remainingAttempts.some((attempt) => attempt.state === "correct") ? "solving" : selected.status
    });
  }

  function syncAttempts(items: Array<{ cache: MysteryCache; attempt: CoordinateAttempt }>) {
    const eligible = items.filter(({ cache, attempt }) =>
      cache.status === "solved" &&
      attempt.state === "correct" &&
      !attempt.geocachingSyncedAt &&
      cache.attempts.find((item) => item.state === "correct")?.id === attempt.id
    );
    if (!eligible.length) {
      setNotice("Only solved, unsynced caches can be synced");
      return;
    }

    const issuedAt = Date.now();
    const payloads: GeocachingSyncPayload[] = eligible.map(({ cache, attempt }) => ({
      cacheId: cache.id,
      attemptId: attempt.id,
      gcCode: cache.gcCode,
      latitude: attempt.latitude,
      longitude: attempt.longitude,
      coordinateText: formatCoordinate(attempt.latitude, attempt.longitude),
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
    syncAttempts([{ cache, attempt }]);
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

  function openShare() {
    if (!selected || selected.sharedBy) return;
    setUserQuery("");
    setUserResults([]);
    setUserSearchState("idle");
    setShowShare(true);
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
      const final = cache.attempts.find((attempt) => attempt.state === "correct");
      return final ? [{ cache, final }] : [];
    });
    const points = solved
      .map(({ cache, final }) => `  <wpt lat="${final.latitude}" lon="${final.longitude}"><name>${escapeXml(cache.gcCode)}</name><desc>${escapeXml(cache.name)}</desc><type>Geocache|Unknown Cache</type></wpt>`)
      .join("\n");
    downloadFile("geostats-solved-mysteries.gpx", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">\n${points}\n</gpx>`, "application/gpx+xml");
    setNotice(`Exported ${solved.length} solved ${solved.length === 1 ? "cache" : "caches"}`);
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
          <button className="primary-button icon-button" type="button" onClick={() => setShowAdd(true)}><Plus size={18} /> Add mystery</button>
        </div>
      </header>

      <section className="mystery-overview" aria-label="Mystery overview">
        <div><span>In your workspace</span><strong>{caches.length}</strong><small>mystery caches</small></div>
        <div><span>Solved</span><strong>{solvedCount}</strong><small>{caches.length ? Math.round((solvedCount / caches.length) * 100) : 0}% complete</small></div>
        <div><span>Coordinates tried</span><strong>{attemptCount}</strong><small>duplicates blocked</small></div>
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
                  const final = cache.attempts.find((attempt) => attempt.state === "correct");
                  return (
                    <button className={`mystery-cache-card ${selected?.id === cache.id ? "active" : ""}`} type="button" key={cache.id} onClick={() => setSelectedId(cache.id)}>
                      <span className={`cache-status-dot ${cache.status}`}><CircleDot size={16} /></span>
                      <span className="mystery-card-copy"><small>{cache.gcCode}{locationLabel(cache) ? ` · ${locationLabel(cache)}` : ""}</small><strong>{cache.name}</strong><em>{final ? formatCoordinate(final.latitude, final.longitude) : `${cache.attempts.length} coordinate ${cache.attempts.length === 1 ? "try" : "tries"}`}</em></span>
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

            <div className="clue-strip">
              <span><Sparkles size={15} /> Clues</span>
              {selected.clues.map((clue) => <button title="Remove clue" type="button" key={clue} onClick={() => updateSelected({ clues: selected.clues.filter((item) => item !== clue) })}>{clue}<X size={12} /></button>)}
              <button className="add-clue" type="button" onClick={addClue}><Plus size={13} /> Add clue</button>
            </div>

            <div className="mystery-detail-grid">
              <section className="mystery-section coordinate-section">
                <div className="section-heading"><div><p className="eyebrow">Coordinate lab</p><h3>Tested coordinates</h3></div><small>{selected.attempts.length} saved</small></div>
                <form className="coordinate-form" onSubmit={addAttempt}>
                  <label><span>New coordinate</span><input value={coordinate} onChange={(event) => setCoordinate(event.target.value)} placeholder="59.40582, 18.36120" /></label>
                  <label><span>Checker result</span><select value={coordinateState} onChange={(event) => setCoordinateState(event.target.value as CheckState)}><option value="unchecked">Not checked</option><option value="wrong">Not correct</option><option value="correct">Correct</option></select></label>
                  <button className="primary-button" type="submit"><Plus size={17} /> Save try</button>
                </form>
                {coordinateError && <p className="coordinate-error"><AlertTriangle size={15} /> {coordinateError}</p>}
                <div className="attempt-list">
                  {selected.attempts.map((attempt) => {
                    const distance = distanceKm(selected.publishedLatitude, selected.publishedLongitude, attempt.latitude, attempt.longitude);
                    return (
                      <div className="attempt-row" key={attempt.id}>
                        <span className={`attempt-state ${attempt.state}`}>{attempt.state === "correct" ? <Check size={16} /> : attempt.state === "wrong" ? <X size={16} /> : <CircleDot size={16} />}</span>
                        <span><strong>{formatCoordinate(attempt.latitude, attempt.longitude)}</strong><small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.createdAt))}</small></span>
                        <span className={`distance-badge ${distance > MAX_REASONABLE_DISTANCE_KM ? "warning" : ""}`}>{distance > MAX_REASONABLE_DISTANCE_KM && <AlertTriangle size={13} />}{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} away</span>
                        {selected.status === "solved" && attempt.state === "correct" && selected.attempts.find((item) => item.state === "correct")?.id === attempt.id ? (
                          attempt.geocachingSyncedAt ? (
                            <span className="coordinate-sync-status" title={`Synced ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.geocachingSyncedAt))}`}><Check size={13} /> Synced</span>
                          ) : (
                            <button className="coordinate-sync-button" type="button" onClick={() => syncAttempt(selected, attempt)}><ExternalLink size={13} /> Sync</button>
                          )
                        ) : <span className={`checker-label ${attempt.state}`}>{stateLabel(attempt.state)}</span>}
                        <button className="row-delete" aria-label="Delete coordinate" type="button" onClick={() => deleteAttempt(attempt.id)}><Trash2 size={15} /></button>
                      </div>
                    );
                  })}
                  {!selected.attempts.length && <div className="attempt-empty"><MapPin size={24} /><strong>No coordinate tries yet</strong><small>Add one above; distance is checked automatically.</small></div>}
                </div>
              </section>

              <aside className="mystery-side-column">
                <section className="mystery-section notes-section">
                  <div className="section-heading"><div><p className="eyebrow">Working notes</p><h3>Solution & field notes</h3></div><small>Saved locally</small></div>
                  <textarea value={selected.notes} onChange={(event) => updateSelected({ notes: event.target.value })} placeholder="Write down clues, calculations and things to bring…" />
                </section>
                <section className="mystery-section shared-section">
                  <div className="section-heading"><div><p className="eyebrow">Team</p><h3>Shared with</h3></div><Users size={18} /></div>
                  <div className="people-list">
                    {selected.sharedBy && <small>Shared by {selected.sharedBy.username}</small>}
                    {selected.sharedWith.map((person) => <button title={selected.sharedBy ? person.username : `Remove ${person.username}`} type="button" disabled={Boolean(selected.sharedBy)} key={person.id} onClick={() => void removeSharedUser(person)}><span>{person.username.charAt(0).toUpperCase()}</span>{person.username}{!selected.sharedBy && <X size={12} />}</button>)}
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
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowShare(false)}>Cancel</button></div>
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

      {notice && <div className="mystery-toast"><Check size={16} /> {notice}</div>}
    </AppShell>
  );
}
