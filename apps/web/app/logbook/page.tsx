"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Download, ExternalLink, Search, Trophy, X } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";

type LogbookFind = {
  id: string;
  foundAt: string;
  foundDate: string;
  foundMonthDay: string;
  foundYear: string;
  isFtf: boolean;
  logText: string | null;
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
  hiddenDate: string | null;
  hiddenYearMonth: string | null;
  ownerName: string | null;
};

type LogbookResponse = {
  finds: LogbookFind[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  facets: {
    cacheTypes: string[];
    countries: string[];
    years: string[];
  };
};

const RATINGS = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch] ?? ch));
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(fileName: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function LogbookContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [cacheType, setCacheType] = useState(() => searchParams.get("cacheType") ?? "");
  const [country, setCountry] = useState(() => searchParams.get("country") ?? "");
  const [region, setRegion] = useState(() => searchParams.get("region") ?? "");
  const [county, setCounty] = useState(() => searchParams.get("county") ?? "");
  const [year, setYear] = useState(() => searchParams.get("year") ?? "");
  const [difficulty, setDifficulty] = useState(() => searchParams.get("difficulty") ?? "");
  const [terrain, setTerrain] = useState(() => searchParams.get("terrain") ?? "");
  const [foundMonthDay, setFoundMonthDay] = useState(() => searchParams.get("foundMonthDay") ?? "");
  const [hiddenYearMonth, setHiddenYearMonth] = useState(() => searchParams.get("hiddenYearMonth") ?? "");
  const [owner, setOwner] = useState(() => searchParams.get("owner") ?? "");
  const [ftfOnly, setFtfOnly] = useState(() => searchParams.get("ftfOnly") === "true");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "foundAt_desc");
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<LogbookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const buildParams = useCallback(
    (nextOffset: number) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (cacheType) params.set("cacheType", cacheType);
      if (country) params.set("country", country);
      if (region) params.set("region", region);
      if (county) params.set("county", county);
      if (year) params.set("year", year);
      if (difficulty) params.set("difficulty", difficulty);
      if (terrain) params.set("terrain", terrain);
      if (foundMonthDay) params.set("foundMonthDay", foundMonthDay);
      if (hiddenYearMonth) params.set("hiddenYearMonth", hiddenYearMonth);
      if (owner) params.set("owner", owner);
      if (ftfOnly) params.set("ftfOnly", "true");
      if (sort && sort !== "foundAt_desc") params.set("sort", sort);
      if (nextOffset > 0) params.set("offset", String(nextOffset));
      params.set("limit", "50");
      return params;
    },
    [q, cacheType, country, region, county, year, difficulty, terrain, foundMonthDay, hiddenYearMonth, owner, ftfOnly, sort]
  );

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      const params = buildParams(offset);
      setLoading(true);
      setError(null);
      void apiFetch<LogbookResponse>(`/stats/finds?${params.toString()}`)
        .then((response) => {
          if (active) {
            setData(response);
          }
        })
        .catch((cause: Error) => {
          if (active) {
            setError(cause.message);
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [buildParams, offset]);

  function clearFilters() {
    setQ("");
    setCacheType("");
    setCountry("");
    setRegion("");
    setCounty("");
    setYear("");
    setDifficulty("");
    setTerrain("");
    setFoundMonthDay("");
    setHiddenYearMonth("");
    setOwner("");
    setFtfOnly(false);
    setSort("foundAt_desc");
    setOffset(0);
    router.replace("/logbook");
  }

  const activeBadges = [
    foundMonthDay ? { label: `Calendar day: ${foundMonthDay}`, clear: () => setFoundMonthDay("") } : null,
    hiddenYearMonth ? { label: `Jasmer month: ${hiddenYearMonth}`, clear: () => setHiddenYearMonth("") } : null,
    region ? { label: `Region: ${region}`, clear: () => setRegion("") } : null,
    county ? { label: `County: ${county}`, clear: () => setCounty("") } : null,
    owner ? { label: `Owner: ${owner}`, clear: () => setOwner("") } : null
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  function exportCsv() {
    if (!data?.finds.length) return;
    const header = ["GC Code", "Name", "Found Date", "Type", "Difficulty", "Terrain", "Size", "Country", "Region", "County", "Owner", "FTF", "Log Text"];
    const rows = data.finds.map((find) =>
      [
        find.gcCode,
        find.name,
        find.foundDate,
        find.cacheType ?? "",
        find.difficulty ?? "",
        find.terrain ?? "",
        find.size ?? "",
        find.country ?? "",
        find.region ?? "",
        find.county ?? "",
        find.ownerName ?? "",
        find.isFtf ? "Yes" : "No",
        find.logText ?? ""
      ]
        .map(escapeCsv)
        .join(",")
    );
    downloadBlob("geostats-logbook-current-page.csv", [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
  }

  function exportGpx() {
    if (!data?.finds.length) return;
    const waypoints = data.finds
      .map(
        (find) =>
          `  <wpt lat="${find.latitude}" lon="${find.longitude}"><name>${escapeXml(find.gcCode)}</name><desc>${escapeXml(find.name)}</desc></wpt>`
      )
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">\n${waypoints}\n</gpx>`;
    downloadBlob("geostats-logbook-current-page.gpx", xml, "application/gpx+xml");
  }

  function toggleExpand(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasAnyFilter = Boolean(
    q || cacheType || country || region || county || year || difficulty || terrain || foundMonthDay || hiddenYearMonth || owner || ftfOnly
  );

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Searchable find archive</p>
          <h1>Logbook</h1>
        </div>
        <div className="logbook-header-actions">
          <button className="secondary-button" type="button" disabled={!data?.finds.length} onClick={exportCsv}>
            <Download size={16} /> Export page as CSV
          </button>
          <button className="secondary-button" type="button" disabled={!data?.finds.length} onClick={exportGpx}>
            <Download size={16} /> Export page as GPX
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="map-filter-heading">
          <div>
            <h2>Search & filter finds</h2>
            <p className="muted">Search cache names, GC codes, owners, or anything you wrote in your find logs.</p>
          </div>
          {hasAnyFilter ? (
            <button className="secondary-button" type="button" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="map-filter-grid">
          <label className="map-filter-search">
            <span>Search logs, names, GC codes</span>
            <input
              type="search"
              placeholder="e.g. bridge, GC9..., FTF, buddy name"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            <span>Cache type</span>
            <select value={cacheType} onChange={(event) => { setCacheType(event.target.value); setOffset(0); }}>
              <option value="">All types</option>
              {(data?.facets.cacheTypes ?? []).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Country</span>
            <select value={country} onChange={(event) => { setCountry(event.target.value); setOffset(0); }}>
              <option value="">All countries</option>
              {(data?.facets.countries ?? []).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Year</span>
            <select value={year} onChange={(event) => { setYear(event.target.value); setOffset(0); }}>
              <option value="">All years</option>
              {(data?.facets.years ?? []).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Difficulty</span>
            <select value={difficulty} onChange={(event) => { setDifficulty(event.target.value); setOffset(0); }}>
              <option value="">Any D</option>
              {RATINGS.map((rating) => (
                <option key={rating} value={rating}>D {rating}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Terrain</span>
            <select value={terrain} onChange={(event) => { setTerrain(event.target.value); setOffset(0); }}>
              <option value="">Any T</option>
              {RATINGS.map((rating) => (
                <option key={rating} value={rating}>T {rating}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}>
              <option value="foundAt_desc">Newest finds first</option>
              <option value="foundAt_asc">Oldest finds first</option>
              <option value="dt_desc">Highest D+T first</option>
              <option value="logLength_desc">Longest log text first</option>
            </select>
          </label>
          <label className="logbook-checkbox-field">
            <input type="checkbox" checked={ftfOnly} onChange={(event) => { setFtfOnly(event.target.checked); setOffset(0); }} />
            <span>FTFs only</span>
          </label>
        </div>

        {activeBadges.length > 0 ? (
          <div className="logbook-drilldown-chips">
            {activeBadges.map((badge) => (
              <button key={badge.label} type="button" className="logbook-chip" onClick={() => { badge.clear(); setOffset(0); }}>
                <span>{badge.label}</span>
                <X size={13} />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>
            <BookOpen size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            {loading ? "Loading finds…" : `${(data?.total ?? 0).toLocaleString()} matching finds`}
          </h2>
          {data && data.total > 0 ? (
            <small className="muted">
              Showing {data.offset + 1}–{Math.min(data.offset + data.finds.length, data.total)} of {data.total.toLocaleString()}
            </small>
          ) : null}
        </div>

        {error ? <p className="notice error">{error}</p> : null}

        {!loading && data && data.finds.length === 0 ? (
          <div className="travel-empty">
            <Search size={28} />
            <h3>No finds match these filters</h3>
            <p className="muted">Try broadening your search or clearing filters.</p>
          </div>
        ) : null}

        <div className="logbook-list">
          {(data?.finds ?? []).map((find) => {
            const expanded = expandedIds.has(find.id);
            const hasLongLog = (find.logText?.length ?? 0) > 220;
            return (
              <article key={find.id} className="logbook-card">
                <div className="logbook-card-header">
                  <div>
                    <div className="logbook-card-title">
                      <Link href={`/cache/${encodeURIComponent(find.gcCode)}`}>
                        <strong>{find.gcCode}</strong>
                      </Link>
                      <h3>{find.name}</h3>
                      <a href={`https://coord.info/${find.gcCode}`} target="_blank" rel="noreferrer" aria-label={`Open ${find.gcCode} on Geocaching.com`}>
                        <ExternalLink size={13} />
                      </a>
                      {find.isFtf ? (
                        <span className="logbook-ftf-badge">
                          <Trophy size={12} /> FTF
                        </span>
                      ) : null}
                    </div>
                    <p className="muted logbook-card-meta">
                      {find.cacheType ?? "Unknown type"}
                      {find.difficulty != null && find.terrain != null ? ` · D${find.difficulty} / T${find.terrain}` : ""}
                      {find.size ? ` · ${find.size}` : ""}
                      {find.country ? ` · ${[find.county, find.region, find.country].filter(Boolean).join(", ")}` : ""}
                      {find.ownerName ? ` · by ${find.ownerName}` : ""}
                    </p>
                  </div>
                  <div className="logbook-card-dates">
                    <strong>{find.foundDate}</strong>
                    {find.hiddenDate ? <small className="muted">Hidden {find.hiddenDate}</small> : null}
                  </div>
                </div>
                {find.logText ? (
                  <div className="logbook-card-log">
                    <p>{expanded || !hasLongLog ? find.logText : `${find.logText.slice(0, 220)}…`}</p>
                    {hasLongLog ? (
                      <button type="button" className="text-button" onClick={() => toggleExpand(find.id)}>
                        {expanded ? "Show less" : "Read full log"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted logbook-no-text">No log text recorded in import.</p>
                )}
              </article>
            );
          })}
        </div>

        {data && (data.offset > 0 || data.hasMore) ? (
          <div className="logbook-pagination">
            <button className="secondary-button" type="button" disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - 50))}>
              Previous
            </button>
            <button className="secondary-button" type="button" disabled={!data.hasMore} onClick={() => setOffset((current) => current + 50)}>
              Next page
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <p className="muted">
          Tip: Click any filled cell in the <Link href="/stats">Stats</Link> D/T matrix, 366 calendar, or Jasmer grid to jump straight to those finds here.
        </p>
      </section>
    </AppShell>
  );
}

export default function LogbookPage() {
  return (
    <Suspense fallback={<AppShell><p className="muted">Loading logbook…</p></AppShell>}>
      <LogbookContent />
    </Suspense>
  );
}
