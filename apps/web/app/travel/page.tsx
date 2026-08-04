"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, CircleDot, MapPin, Navigation, Puzzle, Search } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { normalizeMysteryArea } from "../../lib/mystery-area";

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
  status: "solving" | "solved" | "planned";
  attempts: Array<{ state: "correct" | "wrong" | "unchecked"; latitude: number; longitude: number }>;
};

const STORAGE_KEY = "geostats-mysteries-v1";

function finalCoordinate(cache: TravelCache) {
  return cache.attempts.find((attempt) => attempt.state === "correct");
}

function locationLabel(cache: TravelCache) {
  return [cache.locality, cache.area, cache.county, cache.region, cache.country]
    .map(normalizeMysteryArea)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

export default function TravelPage() {
  const [caches, setCaches] = useState<TravelCache[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "unsolved">("all");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as TravelCache[];
      setCaches(Array.isArray(stored)
        ? stored.map((cache) => ({ ...cache, area: normalizeMysteryArea(cache.area) }))
        : []);
    } catch {
      setCaches([]);
    }
  }, []);

  const visibleCaches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return caches.filter((cache) => {
      const ready = Boolean(finalCoordinate(cache));
      const matchesFilter = filter === "all" || (filter === "ready" ? ready : !ready);
      const matchesQuery = !normalized || `${cache.gcCode} ${cache.name} ${locationLabel(cache)} ${cache.trip ?? ""}`.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [caches, filter, query]);

  const groups = useMemo(() => {
    return visibleCaches.reduce<Record<string, TravelCache[]>>((result, cache) => {
      const group = cache.trip?.trim() || cache.area.trim() || cache.county?.trim() || "Unassigned";
      (result[group] ??= []).push(cache);
      return result;
    }, {});
  }, [visibleCaches]);

  const readyCount = caches.filter((cache) => finalCoordinate(cache)).length;
  const routeCount = new Set(caches.map((cache) => cache.trip?.trim()).filter(Boolean)).size;

  return (
    <AppShell>
      <header className="page-header travel-page-header">
        <div>
          <p className="eyebrow">Routes and areas</p>
          <h1>Travel</h1>
          <p className="mystery-subtitle">Collect solved coordinates into trips before you head out.</p>
        </div>
        <Link className="primary-link" href="/mysteries"><Puzzle size={17} /> Open mysteries</Link>
      </header>

      <section className="travel-summary">
        <div><Navigation size={19} /><span><small>Trips</small><strong>{routeCount}</strong></span></div>
        <div><Check size={19} /><span><small>Ready to find</small><strong>{readyCount}</strong></span></div>
        <div><CircleDot size={19} /><span><small>Still solving</small><strong>{Math.max(0, caches.length - readyCount)}</strong></span></div>
      </section>

      <section className="panel travel-workspace">
        <div className="travel-toolbar">
          <div className="mystery-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trip, area or cache" aria-label="Search travel caches" /></div>
          <div className="mystery-filter-row travel-filters">
            {(["all", "ready", "unsolved"] as const).map((value) => <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => setFilter(value)}>{value}</button>)}
          </div>
        </div>

        <div className="travel-route-grid">
          {Object.entries(groups).map(([group, groupCaches]) => {
            const readyInGroup = groupCaches.filter((cache) => finalCoordinate(cache)).length;
            return (
              <article className="travel-route-card" key={group}>
                <header><span><Navigation size={17} /><strong>{group}</strong></span><small>{readyInGroup}/{groupCaches.length} ready</small></header>
                <div className="travel-cache-list">
                  {groupCaches.map((cache) => {
                    const coordinate = finalCoordinate(cache);
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
          {!Object.keys(groups).length && <div className="travel-empty"><Navigation size={30} /><h2>No caches for this view</h2><p>Add trips to caches in Mysteries or change the filter.</p></div>}
        </div>
      </section>
    </AppShell>
  );
}
