"use client";

import Link from "next/link";
import {
  MAX_TRAVEL_DIRECTIONS_STOPS, moveTravelStop, normalizeAccountTravelPlan, normalizeTravelPlan, travelPlanDirectionsUrl,
  travelPlanGpx, type AccountTravelPlan, type TravelPlace, type TravelPlan
} from "@geostats/shared";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, Database, ExternalLink, LoaderCircle, MapPin, Navigation, Pencil, Plus, Puzzle, Route, Search, Trash2, X } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { PlaceAutocomplete, type SelectedPlace } from "../../components/place-autocomplete";
import { API_URL, ApiError, apiFetch, getApiSessionEpoch, subscribeStatsSummaryCache } from "../../lib/api";
import { normalizeMysteryArea } from "../../lib/mystery-area";
import { createTravelSessionBoundary, hasLegacyTravelPlans, keepTravelSessionAfterNetworkFailure, readTravelStorage, type TravelSession } from "../../lib/travel-storage";
import {
  finalTravelCoordinate,
  newerTravelAssignment,
  normalizedTripName,
  reconcileStaleTravelAssignment,
  travelDirectionsUrl,
  travelGroups,
  type TravelAttempt
} from "../../lib/travel-planner";

type TravelCache = {
  id: string;
  gcCode: string;
  name: string;
  area: string;
  county?: string;
  country?: string;
  region?: string;
  locality?: string;
  trip?: string;
  tripUpdatedAt?: string;
  status: "solving" | "solved" | "planned" | "archived";
  attempts: TravelAttempt[];
  sharedBy?: { id: string; username: string };
  sharedWorkspaceId?: string;
  syncConflicts?: unknown;
  [key: string]: unknown;
};

type OwnedMysterySnapshot = {
  clientId: string;
  mystery: TravelCache;
  revision: number;
};

type TravelRecommendation = {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  county: string | null;
  found: boolean;
  distanceKm: number;
  fillsGaps?: string[];
  source: "imported" | "mystery";
};

type TravelSearchResult = {
  mode: "nearby" | "route";
  origin: TravelPlace;
  destination?: TravelPlace;
  route?: { distanceMeters: number; durationSeconds: number };
  recommendations: TravelRecommendation[];
  importedCacheCount: number;
  mysteryCacheCount: number;
  searchedCacheCount: number;
  poolTruncated: boolean;
  resultsTruncated?: boolean;
  resultLimit: number;
  radiusKm?: number;
};

type TravelPoolSummary = {
  total: number;
  found: number;
  unfound: number;
  poolTruncated: boolean;
  types: Array<{ name: string; count: number }>;
};

function validSavedPlans(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const plan = normalizeTravelPlan(item);
    return plan ? [plan] : [];
  });
}

function shortPlace(label: string) {
  return label.split(",").slice(0, 2).join(",");
}

function routeSummary(route?: AccountTravelPlan["route"]) {
  if (!route) return "";
  const distance = Math.round(route.distanceMeters / 1000);
  const hours = Math.floor(route.durationSeconds / 3600);
  const minutes = Math.round((route.durationSeconds % 3600) / 60);
  return `${distance} km · ${hours ? `${hours} hr ` : ""}${minutes} min`;
}

function locationLabel(cache: TravelCache) {
  return [cache.locality, cache.area, cache.county, cache.region, cache.country]
    .map(normalizeMysteryArea)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

function normalizedCaches(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TravelCache[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const cache = item as Partial<TravelCache>;
    if (typeof cache.id !== "string" || typeof cache.gcCode !== "string" || typeof cache.name !== "string") return [];
    return [{
      ...cache,
      area: normalizeMysteryArea(cache.area),
      county: normalizeMysteryArea(cache.county) || undefined,
      country: normalizeMysteryArea(cache.country) || undefined,
      region: normalizeMysteryArea(cache.region) || undefined,
      locality: normalizeMysteryArea(cache.locality) || undefined,
      trip: normalizedTripName(cache.trip) || undefined,
      attempts: Array.isArray(cache.attempts) ? cache.attempts : []
    } as TravelCache];
  });
}

function shareableCache(cache: TravelCache) {
  const {
    sharedBy: _sharedBy,
    sharedWorkspaceId: _sharedWorkspaceId,
    syncConflicts: _syncConflicts,
    ...mystery
  } = cache;
  return mystery;
}

export default function TravelPage() {
  const [session, setSession] = useState<TravelSession | null>(null);
  const [identityError, setIdentityError] = useState("");

  useEffect(() => {
    const boundary = createTravelSessionBoundary();
    let active = true;
    let sequence = 0;
    let epoch = getApiSessionEpoch();
    let identityRequest: AbortController | null = null;

    async function resolveIdentity(reset = false) {
      const requestSequence = ++sequence;
      identityRequest?.abort();
      const controller = new AbortController();
      identityRequest = controller;
      if (reset) {
        boundary.clear();
        setSession(null);
      }
      const requestEpoch = getApiSessionEpoch();
      try {
        const data = await apiFetch<{ user?: { id?: unknown } }>("/auth/me", { cache: "no-store", signal: controller.signal });
        if (!active || controller.signal.aborted || requestSequence !== sequence || requestEpoch !== getApiSessionEpoch()) return;
        if (typeof data.user?.id !== "string" || !data.user.id.trim()) throw new Error("Sign in to load your travel plans.");
        setSession(boundary.activate(API_URL, data.user.id));
        setIdentityError("");
      } catch (error) {
        if (!active || controller.signal.aborted || requestSequence !== sequence) return;
        if (keepTravelSessionAfterNetworkFailure(boundary.current(), error, requestEpoch, getApiSessionEpoch())) return;
        boundary.clear();
        setSession(null);
        setIdentityError("Sign in and reconnect to load your travel plans.");
      }
    }

    const revalidate = () => {
      if (document.visibilityState !== "hidden") void resolveIdentity();
    };
    const unsubscribe = subscribeStatsSummaryCache((event) => {
      if (event.sessionEpoch === epoch) return;
      epoch = event.sessionEpoch;
      void resolveIdentity(true);
    });
    void resolveIdentity();
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      active = false;
      sequence += 1;
      identityRequest?.abort();
      boundary.clear();
      unsubscribe();
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, []);

  if (!session) return <AppShell><section className="panel" aria-busy={!identityError}>{identityError || "Loading your account travel plans…"}</section></AppShell>;
  return <TravelWorkspace key={`${session.keys.namespace}:${session.generation}`} session={session} />;
}

function TravelWorkspace({ session }: { session: TravelSession }) {
  const revisions = useRef(new Map<string, number>());
  const latestCaches = useRef<TravelCache[]>([]);
  const preservedSharedCaches = useRef<TravelCache[]>([]);
  const [caches, setCaches] = useState<TravelCache[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "unsolved">("all");
  const [editingTrip, setEditingTrip] = useState<string | null>(null);
  const [tripName, setTripName] = useState("");
  const [selectedCacheIds, setSelectedCacheIds] = useState<Set<string>>(new Set());
  const [tripError, setTripError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchMode, setSearchMode] = useState<"nearby" | "route">("nearby");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState<SelectedPlace | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<SelectedPlace | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [includeFound, setIncludeFound] = useState(false);
  const [gapFilters, setGapFilters] = useState<Array<"missing_dt" | "missing_jasmer" | "missing_county">>(() => {
    if (typeof window === "undefined") return [];
    const param = new URLSearchParams(window.location.search).get("gapFilter");
    return param === "missing_dt" || param === "missing_jasmer" || param === "missing_county" ? [param] : [];
  });

  function toggleGapFilter(filter: "missing_dt" | "missing_jasmer" | "missing_county") {
    setGapFilters((current) =>
      current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter]
    );
  }
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<TravelSearchResult | null>(null);
  const [selectedRecommendations, setSelectedRecommendations] = useState<Set<string>>(new Set());
  const [planName, setPlanName] = useState("");
  const [savedPlans, setSavedPlans] = useState<AccountTravelPlan[]>([]);
  const [browserPlans, setBrowserPlans] = useState<ReturnType<typeof validSavedPlans>>([]);
  const [plansError, setPlansError] = useState("");
  const [planActionError, setPlanActionError] = useState("");
  const [plansReload, setPlansReload] = useState(0);
  const [plansBusy, setPlansBusy] = useState(false);
  const plansRequestSequence = useRef(0);
  const [showMigration, setShowMigration] = useState(false);
  const [plansReady, setPlansReady] = useState(false);
  const [legacyPlansPresent, setLegacyPlansPresent] = useState(false);
  const [poolSummary, setPoolSummary] = useState<TravelPoolSummary | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);

  latestCaches.current = caches;

  function persistCaches(ownedCaches: TravelCache[]) {
    if (!session.isCurrent()) return;
    localStorage.setItem(session.keys.caches, JSON.stringify([...ownedCaches, ...preservedSharedCaches.current]));
  }

  async function confirmSession() {
    if (!session.isCurrent()) return false;
    // Another tab can change the session cookie before this tab receives focus.
    const data = await apiFetch<{ user?: { id?: unknown } }>("/auth/me", { cache: "no-store", signal: session.signal, headers: { "X-Geostats-Account-Id": session.userId } });
    return session.isCurrent() && data.user?.id === session.userId;
  }

  async function syncCache(cache: TravelCache) {
    if (!session.isCurrent()) return;
    try {
      let pending = cache;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!await confirmSession()) return;
        const baseRevision = revisions.current.get(cache.id) ?? 0;
        const revision = baseRevision + 1;
        const response = await apiFetch<{ revision: number; mystery: TravelCache }>(`/mysteries/${encodeURIComponent(cache.id)}`, {
          method: "PUT",
          signal: session.signal,
          headers: { "X-Geostats-Account-Id": session.userId },
          body: JSON.stringify({ mystery: shareableCache(pending), revision, baseRevision })
        });
        if (!session.isCurrent()) return;
        revisions.current.set(cache.id, response.revision);
        const server = normalizedCaches([{ ...response.mystery, id: cache.id }])[0];
        if (!server) throw new Error("Account returned an invalid mystery snapshot");
        const assignmentMatches = normalizedTripName(server.trip) === normalizedTripName(pending.trip)
          && server.tripUpdatedAt === pending.tripUpdatedAt;
        if (assignmentMatches) return;

        const resolution = reconcileStaleTravelAssignment(server, pending);
        if (!resolution.retry) {
          setCaches((current) => {
            if (!session.isCurrent()) return current;
            const next = current.map((item) => item.id === cache.id && item.tripUpdatedAt === cache.tripUpdatedAt
              ? { ...item, trip: resolution.cache.trip, tripUpdatedAt: resolution.cache.tripUpdatedAt }
              : item);
            latestCaches.current = next;
            return next;
          });
          setNotice(`${cache.gcCode} changed on another device, so Travel kept the newer trip assignment.`);
          return;
        }
        pending = resolution.cache;
      }
      setNotice(`${cache.gcCode} is saved on this device. Account sync could not catch up yet.`);
    } catch {
      if (session.isCurrent()) setNotice("Trip changes are saved on this device. Account sync will retry when Mysteries opens.");
    }
  }

  useEffect(() => {
    let localCaches: TravelCache[] = [];
    try {
      const storedCaches = normalizedCaches(readTravelStorage(localStorage, session).caches);
      preservedSharedCaches.current = storedCaches.filter((cache) => Boolean(cache.sharedBy));
      localCaches = storedCaches.filter((cache) => !cache.sharedBy);
    } catch {
      // Storage may be disabled; do not fall back to another account's copy.
    }
    latestCaches.current = localCaches;
    setCaches(localCaches);
    setReady(true);

    let active = true;
    void apiFetch<{ mysteries: OwnedMysterySnapshot[]; deletedClientIds: string[] }>("/mysteries/owned", { signal: session.signal, headers: { "X-Geostats-Account-Id": session.userId } })
      .then(({ mysteries, deletedClientIds }) => {
        if (!active || !session.isCurrent()) return;
        const deleted = new Set(Array.isArray(deletedClientIds) ? deletedClientIds : []);
        const deviceCaches = latestCaches.current;
        const localById = new Map(deviceCaches.map((cache) => [cache.id, cache]));
        const serverCaches = mysteries.flatMap((snapshot) => {
          if (!snapshot?.mystery || deleted.has(snapshot.clientId)) return [];
          revisions.current.set(snapshot.clientId, snapshot.revision);
          return normalizedCaches([{ ...snapshot.mystery, id: snapshot.clientId }]);
        });
        const serverIds = new Set(serverCaches.map((cache) => cache.id));
        const reconciled = serverCaches.map((serverCache) => {
          const deviceCache = localById.get(serverCache.id);
          return deviceCache ? newerTravelAssignment(serverCache, deviceCache) : serverCache;
        });
        reconciled.push(...deviceCaches.filter((cache) => !serverIds.has(cache.id) && !deleted.has(cache.id)));
        latestCaches.current = reconciled;
        setCaches(reconciled);

        for (const cache of reconciled) {
          const server = serverCaches.find((item) => item.id === cache.id);
          const deviceTime = Date.parse(cache.tripUpdatedAt ?? "");
          const serverTime = Date.parse(server?.tripUpdatedAt ?? "");
          if (server && Number.isFinite(deviceTime) && (!Number.isFinite(serverTime) || deviceTime > serverTime)) {
            void syncCache(cache);
          }
        }
      })
      .catch(() => {
        // The planner stays usable from its browser copy while offline.
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    void apiFetch<TravelPoolSummary>("/map/travel-pool", { signal: session.signal, headers: { "X-Geostats-Account-Id": session.userId } })
      .then((summary) => {
        if (active && session.isCurrent()) setPoolSummary(summary);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active && session.isCurrent()) setPoolLoading(false);
      });
    return () => { active = false; };
  }, [session]);

  const planRequest = useCallback(<T,>(path = "", options: RequestInit = {}) => {
    return apiFetch<T>(`/travel-plans${path}`, {
      ...options,
      headers: { "X-Geostats-Account-Id": session.userId },
      signal: session.signal
    });
  }, [session]);

  useEffect(() => {
    try {
      setBrowserPlans(validSavedPlans(readTravelStorage(localStorage, session).plans));
      setLegacyPlansPresent(hasLegacyTravelPlans(localStorage, session));
    } catch {
      // Some browsers disable local storage.
    }
  }, [session]);

  useEffect(() => {
    if (plansBusy) return;
    let active = true;
    async function refreshPlans() {
      const sequence = ++plansRequestSequence.current;
      const isCurrent = () => active && session.isCurrent() && plansRequestSequence.current === sequence;
      try {
        const { plans } = await planRequest<{ plans: unknown[] }>();
        if (!isCurrent()) return;
        setSavedPlans(plans.flatMap((value) => {
          const plan = normalizeAccountTravelPlan(value);
          return plan ? [plan] : [];
        }));
        setPlansError("");
      } catch (cause) {
        if (isCurrent()) setPlansError(cause instanceof Error ? cause.message : "Could not load account trips.");
      } finally {
        if (isCurrent()) setPlansReady(true);
      }
    }
    const onFocus = () => { void refreshPlans(); };
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [session, plansBusy, plansReload, planRequest]);

  function updateBrowserPlans(update: (raw: unknown[]) => unknown[]) {
    const existing = readTravelStorage(localStorage, session).plans;
    const next = update(Array.isArray(existing) ? existing : []);
    localStorage.setItem(session.keys.plans, JSON.stringify(next));
    setBrowserPlans(validSavedPlans(next));
  }

  useEffect(() => {
    if (!ready) return;
    try {
      persistCaches(caches);
    } catch {
      setNotice("Browser storage is full. The last trip change could not be saved.");
    }
  }, [caches, ready, session]);

  useEffect(() => {
    const receiveStorageUpdate = (event: StorageEvent) => {
      if (!session.isCurrent() || event.key !== session.keys.caches || !event.newValue) return;
      try {
        const updatedCaches = normalizedCaches(JSON.parse(event.newValue));
        preservedSharedCaches.current = updatedCaches.filter((cache) => Boolean(cache.sharedBy));
        const ownedCaches = updatedCaches.filter((cache) => !cache.sharedBy);
        latestCaches.current = ownedCaches;
        setCaches(ownedCaches);
      } catch {
        // Ignore malformed updates from another tab.
      }
    };
    window.addEventListener("storage", receiveStorageUpdate);
    return () => window.removeEventListener("storage", receiveStorageUpdate);
  }, [session]);

  function saveAssignments(nextCaches: TravelCache[], message: string) {
    if (!session.isCurrent()) return;
    latestCaches.current = nextCaches;
    setCaches(nextCaches);
    try {
      persistCaches(nextCaches);
    } catch {
      setNotice("Browser storage is full. The trip change could not be saved.");
      return;
    }
    const previousById = new Map(caches.map((cache) => [cache.id, normalizedTripName(cache.trip)]));
    const changed = nextCaches.filter((cache) => previousById.get(cache.id) !== normalizedTripName(cache.trip));
    changed.forEach((cache) => void syncCache(cache));
    setNotice(message);
  }

  function changeSearchMode(mode: "nearby" | "route") {
    setSearchMode(mode);
    setRadiusKm(mode === "nearby" ? 10 : 2);
    setSearchResult(null);
    setSearchError("");
    setSelectedRecommendations(new Set());
  }

  async function findCaches(event: FormEvent) {
    event.preventDefault();
    if (!session.isCurrent()) return;
    setSearchError("");
    if (origin.trim().length < 2) {
      setSearchError(searchMode === "nearby" ? "Enter the place you are starting from." : "Enter a starting point.");
      return;
    }
    if (searchMode === "route" && destination.trim().length < 2) {
      setSearchError("Enter a destination.");
      return;
    }
    setSearching(true);
    try {
      if (!await confirmSession()) return;
      const mysteryCaches = caches.flatMap((cache) => {
        if (cache.status === "archived") return [];
        const coordinate = finalTravelCoordinate(cache);
        return coordinate ? [{
          id: cache.id,
          gcCode: cache.gcCode,
          name: cache.name,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          country: cache.country,
          region: cache.region,
          county: cache.county
        }] : [];
      });
      const result = await apiFetch<TravelSearchResult>("/map/travel-search", {
        method: "POST",
        signal: session.signal,
        headers: { "X-Geostats-Account-Id": session.userId },
        body: JSON.stringify({
          mode: searchMode,
          origin: origin.trim(),
          destination: searchMode === "route" ? destination.trim() : undefined,
          radiusKm,
          includeFound,
          gapFilters: gapFilters.length ? gapFilters : undefined,
          mysteryCaches,
          originPlace: selectedOrigin ? {
            label: selectedOrigin.label,
            latitude: selectedOrigin.latitude,
            longitude: selectedOrigin.longitude
          } : undefined,
          destinationPlace: searchMode === "route" && selectedDestination ? {
            label: selectedDestination.label,
            latitude: selectedDestination.latitude,
            longitude: selectedDestination.longitude
          } : undefined
        })
      });
      if (!session.isCurrent()) return;
      setSearchResult(result);
      setSelectedRecommendations(new Set(result.recommendations.filter((cache) => !cache.found).map((cache) => cache.id)));
      setPlanName(searchMode === "route"
        ? `${shortPlace(result.origin.label)} to ${shortPlace(result.destination?.label ?? destination)}`
        : shortPlace(result.origin.label));
    } catch (error) {
      if (!session.isCurrent()) return;
      setSearchResult(null);
      setSelectedRecommendations(new Set());
      setSearchError(error instanceof Error ? error.message : "The cache search failed. Try again.");
    } finally {
      if (session.isCurrent()) setSearching(false);
    }
  }

  function toggleRecommendation(cacheId: string) {
    setSelectedRecommendations((current) => {
      const next = new Set(current);
      if (next.has(cacheId)) next.delete(cacheId);
      else next.add(cacheId);
      return next;
    });
  }

  async function saveRecommendedPlan() {
    if (!session.isCurrent() || plansBusy) return;
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `trip-${Date.now()}`;
    const plan = normalizeTravelPlan(searchResult && {
      ...searchResult, id, name: normalizedTripName(planName), createdAt: new Date().toISOString(),
      radiusKm: searchResult.radiusKm ?? radiusKm,
      caches: searchResult.recommendations.filter((cache) => selectedRecommendations.has(cache.id))
    });
    if (!plan) {
      setSearchError("Enter a trip name and choose at least one recommended cache.");
      return;
    }
    plansRequestSequence.current += 1;
    setPlansReady(true);
    setPlansBusy(true);
    try {
      const result = await planRequest<{ plan: AccountTravelPlan }>(`/${plan.id}`, {
        method: "PUT", body: JSON.stringify({ plan, version: 0 })
      });
      if (!session.isCurrent()) return;
      setSavedPlans((current) => [result.plan, ...current.filter(({ id }) => id !== plan.id)]);
      setPlanName("");
      setSearchError("");
      setNotice(`${plan.name} saved to your account.`);
    } catch (cause) {
      if (!session.isCurrent()) return;
      if (cause instanceof ApiError && cause.status < 500) {
        setSearchError(cause.message);
        return;
      }
      try {
        updateBrowserPlans((current) => [plan, ...current]);
        setSearchError("");
        setNotice(`${plan.name} is saved in this browser. Move it to your account when the connection returns.`);
      } catch {
        setSearchError("Could not save this trip. Keep this page open and retry.");
      }
    } finally {
      if (session.isCurrent()) setPlansBusy(false);
    }
  }

  async function migrateBrowserPlans() {
    if (plansBusy || !session.isCurrent()) return;
    const batch = [...new Map(browserPlans.map((plan) => [plan.id, plan])).values()].slice(0, 100);
    plansRequestSequence.current += 1;
    setPlansReady(true);
    setPlansBusy(true);
    setPlanActionError("");
    try {
      const { plans } = await planRequest<{ plans: AccountTravelPlan[] }>("/migrate", {
        method: "POST", body: JSON.stringify({ plans: batch })
      });
      if (!session.isCurrent()) return;
      const migrated = new Map(plans.map((plan) => [plan.id, plan]));
      setSavedPlans((current) => [...plans, ...current.filter(({ id }) => !migrated.has(id))]);
      updateBrowserPlans((current) => current.filter((item) => {
        const browserPlan = normalizeTravelPlan(item);
        const accountPlan = browserPlan && normalizeTravelPlan(migrated.get(browserPlan.id));
        return !browserPlan || !accountPlan || JSON.stringify(browserPlan) !== JSON.stringify(accountPlan);
      }));
      setNotice(plans.length === batch.length
        ? `${plans.length} trips are now in your account.`
        : "Trips with a different account copy or a saved deletion are still in this browser.");
    } catch (cause) {
      if (session.isCurrent()) setPlanActionError(cause instanceof Error ? cause.message : "Could not move the browser trips.");
    } finally {
      if (session.isCurrent()) setPlansBusy(false);
    }
  }

  async function changeSavedPlan(plan: AccountTravelPlan, options: { caches?: AccountTravelPlan["caches"]; remove?: boolean }) {
    if (!session.isCurrent() || plansBusy) return;
    if (options.remove && !window.confirm(`Remove ${plan.name}?`)) return;
    plansRequestSequence.current += 1;
    setPlansReady(true);
    setPlansBusy(true);
    setPlanActionError("");
    try {
      if (options.remove) {
        await planRequest(`/${plan.id}`, { method: "DELETE", body: JSON.stringify({ version: plan.version }) });
        if (session.isCurrent()) setSavedPlans((current) => current.filter(({ id }) => id !== plan.id));
      } else {
        const result = await planRequest<{ plan: AccountTravelPlan }>(`/${plan.id}`, {
          method: "PUT", body: JSON.stringify({ plan: { ...plan, caches: options.caches }, version: plan.version })
        });
        if (session.isCurrent()) setSavedPlans((current) => current.map((item) => item.id === plan.id ? result.plan : item));
      }
    } catch (cause) {
      if (session.isCurrent()) setPlanActionError(cause instanceof Error ? cause.message : "Could not update this trip.");
    } finally {
      if (session.isCurrent()) setPlansBusy(false);
    }
  }

  function removeBrowserPlan(plan: TravelPlan) {
    if (!session.isCurrent() || !window.confirm(`Remove ${plan.name} from this browser?`)) return;
    try {
      updateBrowserPlans((current) => current.filter((item) => normalizeTravelPlan(item)?.id !== plan.id));
      setPlanActionError("");
    } catch {
      setPlanActionError("Could not remove this browser trip.");
    }
  }

  function downloadTravelPlan(plan: TravelPlan) {
    const url = URL.createObjectURL(new Blob([travelPlanGpx(plan)], { type: "application/gpx+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${plan.name.replace(/[^a-z0-9_-]/gi, "-") || "geostats-trip"}.gpx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  const visibleCaches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return caches.filter((cache) => {
      if (cache.status === "archived") return false;
      const isReady = Boolean(finalTravelCoordinate(cache));
      const matchesFilter = filter === "all" || (filter === "ready" ? isReady : !isReady);
      const matchesQuery = !normalized || [cache.gcCode, cache.name, locationLabel(cache), cache.trip]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [caches, filter, query]);

  const groups = useMemo(() => travelGroups(visibleCaches), [visibleCaches]);
  const activeCaches = useMemo(() => caches.filter((cache) => cache.status !== "archived"), [caches]);
  const assignedCaches = activeCaches.filter((cache) => normalizedTripName(cache.trip));
  const unassignedCaches = visibleCaches.filter((cache) => !normalizedTripName(cache.trip));
  const readyCount = activeCaches.filter((cache) => finalTravelCoordinate(cache)).length;
  const tripCount = travelGroups(activeCaches).length;
  const savedCacheCount = savedPlans.reduce((total, plan) => total + plan.caches.length, 0);
  const archivedInEditedTrip = useMemo(() => {
    if (editingTrip === null) return [];
    const normalizedName = normalizedTripName(editingTrip).toLocaleLowerCase();
    if (!normalizedName) return [];
    return caches.filter((cache) =>
      cache.status === "archived" &&
      normalizedTripName(cache.trip).toLocaleLowerCase() === normalizedName
    );
  }, [caches, editingTrip]);
  const selectedVisibleCount = useMemo(
    () => activeCaches.filter((cache) => selectedCacheIds.has(cache.id)).length,
    [activeCaches, selectedCacheIds]
  );

  function openNewTrip() {
    setEditingTrip("");
    setTripName("");
    setSelectedCacheIds(new Set());
    setTripError("");
  }

  function openEditTrip(name: string, groupCaches: TravelCache[]) {
    setEditingTrip(name);
    setTripName(name);
    // Archived caches are hidden from the trip picker, but they keep their
    // trip assignment. Pre-select every member of this trip (including
    // archived ones) so saving never silently unassigns a hidden cache, and
    // renaming a trip moves its archived members along with it.
    const normalizedName = name.toLocaleLowerCase();
    const fullMembership = caches.filter((cache) =>
      normalizedTripName(cache.trip).toLocaleLowerCase() === normalizedName
    );
    const visibleIds = new Set(groupCaches.map((cache) => cache.id));
    fullMembership.forEach((cache) => visibleIds.add(cache.id));
    setSelectedCacheIds(visibleIds);
    setTripError("");
  }

  function toggleSelected(cacheId: string) {
    setSelectedCacheIds((current) => {
      const next = new Set(current);
      if (next.has(cacheId)) next.delete(cacheId);
      else next.add(cacheId);
      return next;
    });
    setTripError("");
  }

  function saveTrip(event: FormEvent) {
    event.preventDefault();
    const name = normalizedTripName(tripName);
    if (!name) {
      setTripError("Enter a trip name.");
      return;
    }
    // Only visible trips reserve names. A trip holding nothing but archived
    // caches is hidden, so its name stays reusable; unarchiving such a cache
    // later simply merges it into the trip sharing its stored name.
    const duplicate = travelGroups(activeCaches).some(([existing]) =>
      existing.toLocaleLowerCase() === name.toLocaleLowerCase() &&
      existing.toLocaleLowerCase() !== editingTrip?.toLocaleLowerCase()
    );
    if (duplicate) {
      setTripError("A trip with that name already exists.");
      return;
    }
    if (!selectedCacheIds.size) {
      setTripError("Choose at least one cache for this trip.");
      return;
    }

    const changedAt = new Date().toISOString();
    const originalName = normalizedTripName(editingTrip);
    const nextCaches = caches.map((cache) => {
      const selected = selectedCacheIds.has(cache.id);
      const wasInEditedTrip = Boolean(originalName) && normalizedTripName(cache.trip).toLocaleLowerCase() === originalName.toLocaleLowerCase();
      if (!selected && !wasInEditedTrip) return cache;
      const trip = selected ? name : undefined;
      return normalizedTripName(cache.trip) === normalizedTripName(trip)
        ? cache
        : { ...cache, trip, tripUpdatedAt: changedAt };
    });
    saveAssignments(nextCaches, originalName ? `${name} updated` : `${name} created`);
    setEditingTrip(null);
  }

  function deleteTrip(name: string) {
    if (!window.confirm(`Remove ${name}? Its caches will return to Unassigned.`)) return;
    const changedAt = new Date().toISOString();
    // Archived caches are hidden here; deleting a (possibly reused) trip name
    // must never strip their stored membership.
    const nextCaches = caches.map((cache) =>
      cache.status === "archived"
        ? cache
        : normalizedTripName(cache.trip).toLocaleLowerCase() === name.toLocaleLowerCase()
          ? { ...cache, trip: undefined, tripUpdatedAt: changedAt }
          : cache
    );
    saveAssignments(nextCaches, `${name} removed`);
  }

  return (
    <AppShell>
      <header className="page-header travel-page-header">
        <div>
          <p className="eyebrow">Find caches for the journey</p>
          <h1>Travel</h1>
          <p className="mystery-subtitle">Search around where you are, or enter a start and finish to find caches along the drive.</p>
        </div>
        <div className="travel-header-actions">
          <Link className="secondary-button" href="/mysteries"><Puzzle size={17} /> Open mysteries</Link>
        </div>
      </header>

      {legacyPlansPresent && <section className="panel" role="status">
        Earlier travel plans are still stored in this browser. Their account ownership cannot be verified, so they are not loaded here. Keep this browser's data if you need those plans; new plans are saved separately for your signed-in account.
      </section>}

      <section className="travel-summary" aria-label="Travel overview">
        <div><Navigation size={19} /><span><small>Saved plans</small><strong>{savedPlans.length}</strong></span></div>
        <div><MapPin size={19} /><span><small>Planned caches</small><strong>{savedCacheCount}</strong></span></div>
        <div><Puzzle size={19} /><span><small>Mystery lists</small><strong>{tripCount}</strong></span></div>
        <div><Check size={19} /><span><small>Solved mysteries</small><strong>{readyCount}</strong></span></div>
      </section>

      <section className="panel travel-search-panel">
        <div className="travel-mode-tabs" aria-label="Travel search type">
          <button type="button" className={searchMode === "nearby" ? "active" : ""} onClick={() => changeSearchMode("nearby")}><MapPin size={17} /><span><strong>Near a place</strong><small>Find caches around you</small></span></button>
          <button type="button" className={searchMode === "route" ? "active" : ""} onClick={() => changeSearchMode("route")}><Route size={17} /><span><strong>Along a route</strong><small>Find caches on the way</small></span></button>
        </div>

        <div className="travel-pool-panel">
          <div className="travel-pool-copy">
            <span className="travel-pool-icon"><Database size={19} /></span>
            <div>
              <strong>Travel cache pool</strong>
              <p>Travel searches the cache lists in your account. Import and manage those files from Upload.</p>
            </div>
          </div>
          <Link className="secondary-button travel-pool-link" href="/upload?purpose=travel#travel-cache-import">Manage cache imports</Link>
          <div className="travel-pool-summary" aria-live="polite">
            <p>{poolLoading ? "Checking your cache pool…" : poolSummary ? <><strong>{poolSummary.unfound}{poolSummary.poolTruncated ? "+" : ""}</strong> unfound caches ready · <strong>{poolSummary.total}{poolSummary.poolTruncated ? "+" : ""}</strong> imported total</> : "Cache pool unavailable"}</p>
            {poolSummary && poolSummary.types.length > 0 && <div>{poolSummary.types.slice(0, 8).map((type) => <span key={type.name}>{type.name} <strong>{type.count}</strong></span>)}</div>}
          </div>
        </div>

        <form className="travel-search-form" onSubmit={findCaches}>
          <PlaceAutocomplete label={searchMode === "nearby" ? "Where are you?" : "Start"} kind="origin" value={origin} selected={selectedOrigin} onChange={setOrigin} onSelect={setSelectedOrigin} placeholder={searchMode === "nearby" ? "Town, address, or landmark" : "Starting town or address"} />
          {searchMode === "route" && <PlaceAutocomplete label="Finish" kind="destination" value={destination} selected={selectedDestination} onChange={setDestination} onSelect={setSelectedDestination} placeholder="Destination town or address" />}
          <label className="travel-distance-field"><span>{searchMode === "nearby" ? "Search radius" : "Detour from route"}</span><select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}>
            {(searchMode === "nearby" ? [2, 5, 10, 25, 50] : [0.5, 1, 2, 5, 10]).map((distance) => <option key={distance} value={distance}>{distance} km</option>)}
          </select></label>
          <button className="primary-button travel-search-button" type="submit" disabled={searching}>{searching ? <><LoaderCircle className="spin" size={17} /> Searching…</> : <><Search size={17} /> Find caches</>}</button>
          <label className="travel-found-toggle"><input type="checkbox" checked={includeFound} onChange={(event) => setIncludeFound(event.target.checked)} /><span>Include caches I have already found</span></label>
          <div className="travel-gap-filters" role="group" aria-label="Fill my stat gaps">
            <span className="muted">Fill my gaps:</span>
            {([
              { id: "missing_dt", label: "Missing D/T" },
              { id: "missing_jasmer", label: "Missing Jasmer" },
              { id: "missing_county", label: "New county" }
            ] as const).map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={gapFilters.includes(chip.id) ? "gap-chip active" : "gap-chip"}
                aria-pressed={gapFilters.includes(chip.id)}
                onClick={() => toggleGapFilter(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </form>

        {searchError && <p className="coordinate-error travel-search-error">{searchError}</p>}

        {searchResult && <div className="travel-results">
          <div className="travel-results-heading">
            <div><p className="eyebrow">Recommended stops</p><h2>{searchResult.recommendations.length ? `${searchResult.recommendations.length} caches found` : "No matching caches"}</h2><p>{shortPlace(searchResult.origin.label)}{searchResult.destination ? ` → ${shortPlace(searchResult.destination.label)}` : ` · within ${radiusKm} km`}{searchResult.route ? ` · ${routeSummary(searchResult.route)}` : ""}</p></div>
            {searchResult.recommendations.length > 0 && <div><button type="button" className="text-button" onClick={() => setSelectedRecommendations(new Set(searchResult.recommendations.map((cache) => cache.id)))}>Select all</button><button type="button" className="text-button" onClick={() => setSelectedRecommendations(new Set())}>Clear</button></div>}
          </div>

          {!searchResult.recommendations.length ? <div className="travel-no-results"><MapPin size={27} /><p>No unfound imported caches or solved mysteries match this area. Try a wider distance or import a Pocket Query for this route.</p></div> : <div className="travel-recommendation-list">
            {searchResult.recommendations.map((cache) => <label key={cache.id} className={selectedRecommendations.has(cache.id) ? "selected" : ""}>
              <input type="checkbox" checked={selectedRecommendations.has(cache.id)} onChange={() => toggleRecommendation(cache.id)} />
              <span className="travel-cache-pin"><MapPin size={15} /></span>
              <span>
                <strong>{cache.name}</strong>
                <small>{cache.gcCode} · {cache.source === "mystery" ? "Solved mystery" : cache.cacheType ?? "Unknown type"}{cache.source !== "mystery" ? ` · D ${cache.difficulty ?? "–"} / T ${cache.terrain ?? "–"}` : ""}{cache.found ? " · Found" : ""}</small>
                {cache.fillsGaps?.length ? (
                  <span className="travel-gap-badges">
                    {cache.fillsGaps.map((gap) => <em key={gap} className="travel-gap-badge">{gap}</em>)}
                  </span>
                ) : null}
              </span>
              <em>{cache.distanceKm} km {searchMode === "route" ? "off route" : "away"}</em>
            </label>)}
          </div>}

          {searchResult.recommendations.length > 0 && <div className="travel-save-row"><label><span>Trip name</span><input value={planName} maxLength={80} onChange={(event) => setPlanName(event.target.value)} placeholder="Saturday cache run" /></label><p>{selectedRecommendations.size} selected</p><button className="primary-button" type="button" disabled={plansBusy} onClick={() => void saveRecommendedPlan()}><Plus size={16} /> Save plan</button></div>}
          {searchResult.resultsTruncated ? <p className="muted">Showing the first {searchResult.resultLimit} matching caches.</p> : null}
          <p className="travel-source-note">Searched {searchResult.importedCacheCount}{searchResult.poolTruncated ? "+" : ""} imported caches{searchResult.mysteryCacheCount ? ` and ${searchResult.mysteryCacheCount} solved mysteries` : ""}. Place search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>{searchResult.mode === "route" ? <> · Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a></> : null}.</p>
        </div>}
      </section>

      <section className="travel-saved-section" aria-labelledby="saved-travel-plans">
        <div className="section-heading"><div><h2 id="saved-travel-plans">Saved travel plans</h2></div></div>
        {plansError ? <p role="alert" className="error">{plansError} <button type="button" onClick={() => setPlansReload((value) => value + 1)}>Reload plans</button></p> : null}
        {planActionError ? <p role="alert" className="error">{planActionError}</p> : null}
        {!plansReady ? <p role="status">Loading account trips…</p> : null}
        {plansReady && !plansError && !savedPlans.length ? <p className="muted">Save a route to open it on another device.</p> : null}
        {browserPlans.length ? <div className="panel">
          <p>{browserPlans.length} {browserPlans.length === 1 ? "trip is" : "trips are"} stored in this browser.</p>
          <button className="secondary-button" type="button" aria-expanded={showMigration} onClick={() => setShowMigration((value) => !value)}>
            {showMigration ? "Hide preview" : "Review browser trips"}
          </button>
          {showMigration ? <>
            <ul>{browserPlans.slice(0, 100).map((plan) => <li key={plan.id}>{plan.name} · {plan.caches.length} stops · {shortPlace(plan.origin.label)}</li>)}</ul>
            <button className="primary-button" type="button" disabled={plansBusy} onClick={() => void migrateBrowserPlans()}>
              Move {Math.min(browserPlans.length, 100)} to my account
            </button>
          </> : null}
        </div> : null}
        <div className="travel-route-grid">
          {[
            ...savedPlans.map((plan) => ({ plan, accountPlan: plan })),
            ...browserPlans.map((plan) => ({ plan, accountPlan: null }))
          ].map(({ plan, accountPlan }) => <article className="travel-route-card travel-saved-card" key={`${accountPlan ? "account" : "browser"}:${plan.id}`}>
            <header>
              <span>{plan.mode === "route" ? <Route size={17} /> : <MapPin size={17} />}<strong>{plan.name}</strong><small>{plan.caches.length} stops{accountPlan ? "" : " · This browser"}</small></span>
              <div className="travel-route-actions">
                <a href={travelPlanDirectionsUrl(plan)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Route</a>
                <button type="button" onClick={() => downloadTravelPlan(plan)}>GPX</button>
                <button className="danger" type="button" disabled={plansBusy} onClick={() => accountPlan ? void changeSavedPlan(accountPlan, { remove: true }) : removeBrowserPlan(plan)} aria-label={`Remove ${plan.name}`}><Trash2 size={14} /></button>
              </div>
            </header>
            <p className="travel-saved-meta">{shortPlace(plan.origin.label)}{plan.destination ? ` → ${shortPlace(plan.destination.label)}` : ` · ${plan.radiusKm} km radius`}{plan.route ? ` · ${routeSummary(plan.route)}` : ""}</p>
            {plan.caches.length > MAX_TRAVEL_DIRECTIONS_STOPS + (plan.mode === "nearby" ? 1 : 0)
              ? <p className="muted">Google Maps uses up to eight intermediate stops. The GPX includes every stop.</p> : null}
            <div className="travel-cache-list">
              {plan.caches.map((cache, index) => <div className="travel-cache-row" key={cache.id}>
                <span className="travel-cache-pin">{index + 1}</span>
                <span><small>{cache.gcCode} · {cache.cacheType ?? "Unknown type"}</small><strong><a href={`https://www.geocaching.com/geocache/${encodeURIComponent(cache.gcCode)}`} target="_blank" rel="noreferrer">{cache.name}</a></strong></span>
                {accountPlan ? <div className="travel-route-actions">
                  <button type="button" disabled={plansBusy || index === 0} aria-label={`Move ${cache.name} earlier`} onClick={() => void changeSavedPlan(accountPlan, { caches: moveTravelStop(plan.caches, index, -1) })}>↑</button>
                  <button type="button" disabled={plansBusy || index === plan.caches.length - 1} aria-label={`Move ${cache.name} later`} onClick={() => void changeSavedPlan(accountPlan, { caches: moveTravelStop(plan.caches, index, 1) })}>↓</button>
                </div> : null}
              </div>)}
            </div>
          </article>)}
        </div>
      </section>

      <section className="panel travel-workspace">
        <div className="section-heading travel-legacy-heading"><div><p className="eyebrow">Solved coordinates</p><h2>Mystery cache lists</h2><p>Keep organizing the mystery caches from your solving workspace.</p></div><button className="secondary-button" type="button" disabled={!caches.length} onClick={openNewTrip}><Plus size={17} /> New mystery list</button></div>
        <div className="travel-toolbar">
          <div className="mystery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trip, place, or cache" aria-label="Search travel caches" /></div>
          <div className="mystery-filter-row travel-filters">
            {(["all", "ready", "unsolved"] as const).map((value) => <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => setFilter(value)}>{value}</button>)}
          </div>
        </div>

        {!ready ? <div className="travel-empty"><Navigation size={30} /><p>Loading trips…</p></div> : (
          <div className="travel-route-grid">
            {groups.map(([group, groupCaches]) => {
              const readyInGroup = groupCaches.filter((cache) => finalTravelCoordinate(cache)).length;
              const directionsUrl = travelDirectionsUrl(groupCaches);
              return (
                <article className="travel-route-card" key={group}>
                  <header>
                    <span><Navigation size={17} /><strong>{group}</strong><small>{readyInGroup}/{groupCaches.length} ready</small></span>
                    <div className="travel-route-actions">
                      {directionsUrl && <a href={directionsUrl} target="_blank" rel="noreferrer" title="Open ready caches in Google Maps"><ExternalLink size={14} /> Route</a>}
                      <button type="button" onClick={() => openEditTrip(group, groupCaches)} title={`Edit ${group}`}><Pencil size={14} /></button>
                      <button className="danger" type="button" onClick={() => deleteTrip(group)} title={`Remove ${group}`}><Trash2 size={14} /></button>
                    </div>
                  </header>
                  <div className="travel-cache-list">
                    {groupCaches.map((cache) => {
                      const coordinate = finalTravelCoordinate(cache);
                      return (
                        <Link href={`/mysteries?cache=${encodeURIComponent(cache.id)}`} className="travel-cache-row" key={cache.id}>
                          <span className={`attempt-state ${coordinate ? "correct" : "unchecked"}`}>{coordinate ? <Check size={15} /> : <CircleDot size={15} />}</span>
                          <span><small>{cache.gcCode} · {locationLabel(cache) || "No location"}</small><strong>{cache.name}</strong></span>
                          <em>{coordinate ? <><MapPin size={12} /> {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}</> : "Needs solution"}</em>
                        </Link>
                      );
                    })}
                  </div>
                </article>
              );
            })}

            {unassignedCaches.length > 0 && (
              <article className="travel-route-card travel-unassigned-card">
                <header><span><MapPin size={17} /><strong>Unassigned</strong><small>{unassignedCaches.length} caches</small></span><button className="travel-add-link" type="button" onClick={openNewTrip}><Plus size={14} /> Make a trip</button></header>
                <div className="travel-cache-list">
                  {unassignedCaches.map((cache) => {
                    const coordinate = finalTravelCoordinate(cache);
                    return <Link href={`/mysteries?cache=${encodeURIComponent(cache.id)}`} className="travel-cache-row" key={cache.id}><span className={`attempt-state ${coordinate ? "correct" : "unchecked"}`}>{coordinate ? <Check size={15} /> : <CircleDot size={15} />}</span><span><small>{cache.gcCode} · {locationLabel(cache) || "No location"}</small><strong>{cache.name}</strong></span><em>{coordinate ? "Ready to assign" : "Needs solution"}</em></Link>;
                  })}
                </div>
              </article>
            )}

            {!caches.length && <div className="travel-empty"><Navigation size={30} /><h2>No mystery caches yet</h2><p>Add a mystery first, then come back to build a trip.</p><Link className="primary-link" href="/mysteries"><Puzzle size={16} /> Add mysteries</Link></div>}
            {Boolean(caches.length && !groups.length && !unassignedCaches.length) && <div className="travel-empty"><Search size={30} /><h2>No caches match this view</h2><p>Change the search or filter to see your trips.</p></div>}
          </div>
        )}
      </section>

      {editingTrip !== null && (
        <div className="mystery-modal-backdrop" role="presentation" onMouseDown={() => setEditingTrip(null)}>
          <form className="mystery-modal travel-trip-modal" role="dialog" aria-modal="true" aria-labelledby="travel-trip-title" onSubmit={saveTrip} onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Trip planner</p><h2 id="travel-trip-title">{editingTrip ? "Edit trip" : "New trip"}</h2></div><button className="row-delete" type="button" aria-label="Close" onClick={() => setEditingTrip(null)}><X /></button></div>
            <label htmlFor="travel-trip-name"><span>Trip name</span><input id="travel-trip-name" autoFocus value={tripName} maxLength={80} onChange={(event) => { setTripName(event.target.value); setTripError(""); }} placeholder="Stockholm weekend" /></label>
            <fieldset className="travel-cache-picker">
              <legend>Choose caches</legend>
              {activeCaches.map((cache) => {
                const coordinate = finalTravelCoordinate(cache);
                const currentTrip = normalizedTripName(cache.trip);
                return <label key={cache.id}><input type="checkbox" checked={selectedCacheIds.has(cache.id)} onChange={() => toggleSelected(cache.id)} /><span className={`attempt-state ${coordinate ? "correct" : "unchecked"}`}>{coordinate ? <Check size={14} /> : <CircleDot size={14} />}</span><span><strong>{cache.gcCode} · {cache.name}</strong><small>{locationLabel(cache) || "No location"}{currentTrip && currentTrip !== editingTrip ? ` · Currently in ${currentTrip}` : ""}</small></span></label>;
              })}
            </fieldset>
            <p className="travel-picker-summary">{selectedVisibleCount} {selectedVisibleCount === 1 ? "cache" : "caches"} selected. Choosing a cache from another trip moves it here.</p>
            {archivedInEditedTrip.length > 0 && <p className="travel-picker-summary">Plus {archivedInEditedTrip.length} archived {archivedInEditedTrip.length === 1 ? "cache" : "caches"} will stay in this trip.</p>}
            {tripError && <p className="coordinate-error">{tripError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditingTrip(null)}>Cancel</button><button className="primary-button" type="submit">{editingTrip ? "Save trip" : "Create trip"}</button></div>
          </form>
        </div>
      )}

      <div className="mystery-toast" role="status" aria-live="polite">{notice && <><Check size={15} /><span>{notice}</span></>}</div>
    </AppShell>
  );
}
