"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, Database, ExternalLink, LoaderCircle, MapPin, Navigation, Pencil, Plus, Puzzle, Route, Search, Trash2, X } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { PlaceAutocomplete, type SelectedPlace } from "../../components/place-autocomplete";
import { apiFetch } from "../../lib/api";
import { normalizeMysteryArea } from "../../lib/mystery-area";
import {
  finalTravelCoordinate,
  newerTravelAssignment,
  normalizedTripName,
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
  status: "solving" | "solved" | "planned";
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

type TravelPlace = {
  label: string;
  latitude: number;
  longitude: number;
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
  resultLimit: number;
};

type TravelPoolSummary = {
  total: number;
  found: number;
  unfound: number;
  poolTruncated: boolean;
  types: Array<{ name: string; count: number }>;
};

type SavedTravelPlan = {
  id: string;
  name: string;
  createdAt: string;
  mode: "nearby" | "route";
  origin: TravelPlace;
  destination?: TravelPlace;
  route?: { distanceMeters: number; durationSeconds: number };
  radiusKm: number;
  caches: TravelRecommendation[];
};

const STORAGE_KEY = "geostats-mysteries-v1";
const TRAVEL_PLAN_STORAGE_KEY = "geostats-travel-plans-v2";

function coordinateText(place: Pick<TravelPlace, "latitude" | "longitude">) {
  return `${place.latitude},${place.longitude}`;
}

function savedPlanDirectionsUrl(plan: SavedTravelPlan) {
  if (!plan.caches.length) return "";
  const params = new URLSearchParams({ api: "1", origin: coordinateText(plan.origin), travelmode: "driving" });
  if (plan.mode === "route" && plan.destination) {
    params.set("destination", coordinateText(plan.destination));
    params.set("waypoints", plan.caches.slice(0, 8).map(coordinateText).join("|"));
  } else {
    params.set("destination", coordinateText(plan.caches.at(-1)!));
    const waypoints = plan.caches.slice(0, -1).slice(0, 8);
    if (waypoints.length) params.set("waypoints", waypoints.map(coordinateText).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function validSavedPlans(value: unknown): SavedTravelPlan[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SavedTravelPlan => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const plan = item as Partial<SavedTravelPlan>;
    return typeof plan.id === "string" && typeof plan.name === "string"
      && (plan.mode === "nearby" || plan.mode === "route")
      && Boolean(plan.origin) && Array.isArray(plan.caches);
  });
}

function shortPlace(label: string) {
  return label.split(",").slice(0, 2).join(",");
}

function routeSummary(route?: SavedTravelPlan["route"]) {
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
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<TravelSearchResult | null>(null);
  const [selectedRecommendations, setSelectedRecommendations] = useState<Set<string>>(new Set());
  const [planName, setPlanName] = useState("");
  const [savedPlans, setSavedPlans] = useState<SavedTravelPlan[]>([]);
  const [plansReady, setPlansReady] = useState(false);
  const [poolSummary, setPoolSummary] = useState<TravelPoolSummary | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);

  latestCaches.current = caches;

  function persistCaches(ownedCaches: TravelCache[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ownedCaches, ...preservedSharedCaches.current]));
  }

  async function syncCache(cache: TravelCache) {
    const revision = (revisions.current.get(cache.id) ?? 0) + 1;
    revisions.current.set(cache.id, revision);
    try {
      const response = await apiFetch<{ revision: number; mystery: TravelCache }>(`/mysteries/${encodeURIComponent(cache.id)}`, {
        method: "PUT",
        body: JSON.stringify({ mystery: shareableCache(cache), revision })
      });
      revisions.current.set(cache.id, Math.max(revisions.current.get(cache.id) ?? 0, response.revision));
      if (normalizedTripName(response.mystery?.trip) !== normalizedTripName(cache.trip)) {
        setNotice(`${cache.gcCode} is saved on this device. Open Mysteries to reconcile its account copy.`);
      }
    } catch {
      setNotice("Trip changes are saved on this device. Account sync will retry when Mysteries opens.");
    }
  }

  useEffect(() => {
    let localCaches: TravelCache[] = [];
    try {
      const storedCaches = normalizedCaches(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
      preservedSharedCaches.current = storedCaches.filter((cache) => Boolean(cache.sharedBy));
      localCaches = storedCaches.filter((cache) => !cache.sharedBy);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    latestCaches.current = localCaches;
    setCaches(localCaches);
    setReady(true);

    let active = true;
    void apiFetch<{ mysteries: OwnedMysterySnapshot[]; deletedClientIds: string[] }>("/mysteries/owned")
      .then(({ mysteries, deletedClientIds }) => {
        if (!active) return;
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
  }, []);

  useEffect(() => {
    let active = true;
    void apiFetch<TravelPoolSummary>("/map/travel-pool")
      .then((summary) => {
        if (active) setPoolSummary(summary);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPoolLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      setSavedPlans(validSavedPlans(JSON.parse(localStorage.getItem(TRAVEL_PLAN_STORAGE_KEY) ?? "[]")));
    } catch {
      localStorage.removeItem(TRAVEL_PLAN_STORAGE_KEY);
    }
    setPlansReady(true);
  }, []);

  useEffect(() => {
    if (!plansReady) return;
    try {
      localStorage.setItem(TRAVEL_PLAN_STORAGE_KEY, JSON.stringify(savedPlans));
    } catch {
      setNotice("Browser storage is full. The last travel plan could not be saved.");
    }
  }, [plansReady, savedPlans]);

  useEffect(() => {
    if (!ready) return;
    try {
      persistCaches(caches);
    } catch {
      setNotice("Browser storage is full. The last trip change could not be saved.");
    }
  }, [caches, ready]);

  useEffect(() => {
    const receiveStorageUpdate = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
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
  }, []);

  function saveAssignments(nextCaches: TravelCache[], message: string) {
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
      const mysteryCaches = caches.flatMap((cache) => {
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
        body: JSON.stringify({
          mode: searchMode,
          origin: origin.trim(),
          destination: searchMode === "route" ? destination.trim() : undefined,
          radiusKm,
          includeFound,
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
      setSearchResult(result);
      setSelectedRecommendations(new Set(result.recommendations.filter((cache) => !cache.found).map((cache) => cache.id)));
      setPlanName(searchMode === "route"
        ? `${shortPlace(result.origin.label)} to ${shortPlace(result.destination?.label ?? destination)}`
        : shortPlace(result.origin.label));
    } catch (error) {
      setSearchResult(null);
      setSelectedRecommendations(new Set());
      setSearchError(error instanceof Error ? error.message : "The cache search failed. Try again.");
    } finally {
      setSearching(false);
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

  function saveRecommendedPlan() {
    const name = normalizedTripName(planName);
    const selected = searchResult?.recommendations.filter((cache) => selectedRecommendations.has(cache.id)) ?? [];
    if (!name) {
      setSearchError("Give this trip a name before saving it.");
      return;
    }
    if (!searchResult || !selected.length) {
      setSearchError("Choose at least one recommended cache.");
      return;
    }
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `trip-${Date.now()}`;
    setSavedPlans((current) => [{
      id,
      name,
      createdAt: new Date().toISOString(),
      mode: searchResult.mode,
      origin: searchResult.origin,
      destination: searchResult.destination,
      route: searchResult.route,
      radiusKm,
      caches: selected
    }, ...current]);
    setNotice(`${name} saved with ${selected.length} ${selected.length === 1 ? "cache" : "caches"}`);
    setSearchError("");
  }

  function deleteSavedPlan(plan: SavedTravelPlan) {
    if (!window.confirm(`Remove ${plan.name}?`)) return;
    setSavedPlans((current) => current.filter(({ id }) => id !== plan.id));
    setNotice(`${plan.name} removed`);
  }

  const visibleCaches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return caches.filter((cache) => {
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
  const assignedCaches = caches.filter((cache) => normalizedTripName(cache.trip));
  const unassignedCaches = visibleCaches.filter((cache) => !normalizedTripName(cache.trip));
  const readyCount = assignedCaches.filter((cache) => finalTravelCoordinate(cache)).length;
  const tripCount = travelGroups(caches).length;
  const savedCacheCount = savedPlans.reduce((total, plan) => total + plan.caches.length, 0);

  function openNewTrip() {
    setEditingTrip("");
    setTripName("");
    setSelectedCacheIds(new Set());
    setTripError("");
  }

  function openEditTrip(name: string, groupCaches: TravelCache[]) {
    setEditingTrip(name);
    setTripName(name);
    setSelectedCacheIds(new Set(groupCaches.map((cache) => cache.id)));
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
    const duplicate = travelGroups(caches).some(([existing]) =>
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
    const nextCaches = caches.map((cache) =>
      normalizedTripName(cache.trip).toLocaleLowerCase() === name.toLocaleLowerCase()
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
              <span><strong>{cache.name}</strong><small>{cache.gcCode} · {cache.source === "mystery" ? "Solved mystery" : cache.cacheType ?? "Unknown type"}{cache.source !== "mystery" ? ` · D ${cache.difficulty ?? "–"} / T ${cache.terrain ?? "–"}` : ""}{cache.found ? " · Found" : ""}</small></span>
              <em>{cache.distanceKm} km {searchMode === "route" ? "off route" : "away"}</em>
            </label>)}
          </div>}

          {searchResult.recommendations.length > 0 && <div className="travel-save-row"><label><span>Trip name</span><input value={planName} maxLength={80} onChange={(event) => setPlanName(event.target.value)} placeholder="Saturday cache run" /></label><p>{selectedRecommendations.size} selected</p><button className="primary-button" type="button" onClick={saveRecommendedPlan}><Plus size={16} /> Save plan</button></div>}
          <p className="travel-source-note">Searching {searchResult.importedCacheCount}{searchResult.poolTruncated ? "+" : ""} imported caches{searchResult.mysteryCacheCount ? ` and ${searchResult.mysteryCacheCount} solved mysteries` : ""}. Place search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>{searchResult.mode === "route" ? <> · Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a></> : null}.</p>
        </div>}
      </section>

      {plansReady && savedPlans.length > 0 && <section className="travel-saved-section">
        <div className="section-heading"><div><p className="eyebrow">Take them with you</p><h2>Saved travel plans</h2></div></div>
        <div className="travel-route-grid">
          {savedPlans.map((plan) => <article className="travel-route-card travel-saved-card" key={plan.id}>
            <header><span>{plan.mode === "route" ? <Route size={17} /> : <MapPin size={17} />}<strong>{plan.name}</strong><small>{plan.caches.length} stops</small></span><div className="travel-route-actions"><a href={savedPlanDirectionsUrl(plan)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Route</a><button className="danger" type="button" onClick={() => deleteSavedPlan(plan)} title={`Remove ${plan.name}`}><Trash2 size={14} /></button></div></header>
            <p className="travel-saved-meta">{shortPlace(plan.origin.label)}{plan.destination ? ` → ${shortPlace(plan.destination.label)}` : ` · ${plan.radiusKm} km radius`}{plan.route ? ` · ${routeSummary(plan.route)}` : ""}</p>
            <div className="travel-cache-list">{plan.caches.map((cache) => <a href={`https://www.geocaching.com/geocache/${encodeURIComponent(cache.gcCode)}`} target="_blank" rel="noreferrer" className="travel-cache-row" key={cache.id}><span className="travel-cache-pin"><MapPin size={14} /></span><span><small>{cache.gcCode} · {cache.cacheType ?? "Unknown type"}</small><strong>{cache.name}</strong></span><em>{cache.distanceKm} km {plan.mode === "route" ? "off route" : "away"}</em></a>)}</div>
          </article>)}
        </div>
      </section>}

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
              {caches.map((cache) => {
                const coordinate = finalTravelCoordinate(cache);
                const currentTrip = normalizedTripName(cache.trip);
                return <label key={cache.id}><input type="checkbox" checked={selectedCacheIds.has(cache.id)} onChange={() => toggleSelected(cache.id)} /><span className={`attempt-state ${coordinate ? "correct" : "unchecked"}`}>{coordinate ? <Check size={14} /> : <CircleDot size={14} />}</span><span><strong>{cache.gcCode} · {cache.name}</strong><small>{locationLabel(cache) || "No location"}{currentTrip && currentTrip !== editingTrip ? ` · Currently in ${currentTrip}` : ""}</small></span></label>;
              })}
            </fieldset>
            <p className="travel-picker-summary">{selectedCacheIds.size} {selectedCacheIds.size === 1 ? "cache" : "caches"} selected. Choosing a cache from another trip moves it here.</p>
            {tripError && <p className="coordinate-error">{tripError}</p>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditingTrip(null)}>Cancel</button><button className="primary-button" type="submit">{editingTrip ? "Save trip" : "Create trip"}</button></div>
          </form>
        </div>
      )}

      <div className="mystery-toast" role="status" aria-live="polite">{notice && <><Check size={15} /><span>{notice}</span></>}</div>
    </AppShell>
  );
}
