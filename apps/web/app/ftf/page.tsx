"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMap, CacheMapPoint } from "../../components/cache-map";
import { CountBarChart } from "../../components/charts";
import { DifficultyTerrainGrid } from "../../components/difficulty-terrain-grid";
import { StatCard } from "../../components/stat-card";
import { apiFetch } from "../../lib/api";

type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type DifficultyTerrainCell = { difficulty: number; terrain: number; count: number };
type FtfRow = {
  date: string;
  dateTime: string;
  intervalDays: number | null;
  distanceKm: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  size: string | null;
  difficulty: number | null;
  terrain: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  elevationMeters: number | null;
  archived: boolean;
};
type FtfFirstRow = {
  index: number;
  date: string;
  dateTime: string;
  label: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
};
type FtfWayTo81Entry = {
  index: number;
  date: string;
  dateTime: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number;
  terrain: number;
};
type FtfStats = {
  total: number;
  percentOfFinds: number;
  averageIntervalDays: number | null;
  averageDistanceKm: number | null;
  first: FtfRow | null;
  latest: FtfRow | null;
  slowest: FtfRow | null;
  nearest: FtfRow | null;
  furthest: FtfRow | null;
  mostNorthern: FtfRow | null;
  mostSouthern: FtfRow | null;
  mostEastern: FtfRow | null;
  mostWestern: FtfRow | null;
  highest: FtfRow | null;
  lowest: FtfRow | null;
  centroid: { latitude: number; longitude: number; distanceFromHomeKm: number | null } | null;
  archivedCount: number;
  archivedPercent: number;
  bestDay: CountBucket | null;
  bestMonth: CountBucket | null;
  consecutiveMonths: { count: number; start: string; end: string } | null;
  byYear: CountBucket[];
  byMonth: CountBucket[];
  byCalendarMonth: PercentBucket[];
  byWeekday: PercentBucket[];
  byType: PercentBucket[];
  bySize: PercentBucket[];
  byDifficulty: PercentBucket[];
  byTerrain: PercentBucket[];
  averageDifficulty: number;
  averageTerrain: number;
  byCountry: CountBucket[];
  byRegion: CountBucket[];
  byDifficultyTerrain: DifficultyTerrainCell[];
  foundDateMatrix: CountBucket[];
  firstByLocation: FtfFirstRow[];
  firstByType: FtfFirstRow[];
  wayTo81: FtfWayTo81Entry[];
  rows: FtfRow[];
};
type FindRow = {
  id: string;
  foundAt: string;
  isFtf: boolean;
  logText: string | null;
  cache: {
    gcCode: string;
    name: string;
    cacheType: string | null;
    country: string | null;
    region: string | null;
  };
};
type FtfFindsResponse = {
  finds: FindRow[];
  nextCursor: string | null;
};

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ratingValues = ["1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

function formatDate(value: string) {
  return value.slice(0, 10);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatDate(value);
  }
  const datePart = date.toISOString().slice(0, 10);
  const timePart = date.toISOString().slice(11, 16);
  return timePart === "00:00" ? datePart : `${datePart} ${timePart}`;
}

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  const label = monthLabels[Number(month) - 1] ?? month;
  return `${label} ${year}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function formatDistance(value: number | null) {
  return value == null ? "-" : `${value < 10 ? value.toFixed(2) : Math.round(value)} km`;
}

function formatCoordinate(row: FtfRow | null) {
  if (!row || row.latitude == null || row.longitude == null) {
    return "-";
  }
  return `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`;
}

function summaryRows(stats: FtfStats | null) {
  const rows: [string, string][] = [];
  if (!stats) {
    return rows;
  }

  if (stats.bestDay) {
    rows.push(["Most FTFs in a day", `${stats.bestDay.count} on ${stats.bestDay.key}`]);
  }
  if (stats.bestMonth) {
    rows.push(["Most FTFs in a calendar month", `${stats.bestMonth.count} in ${formatMonth(stats.bestMonth.key)}`]);
  }
  if (stats.consecutiveMonths) {
    rows.push([
      "Most consecutive months with an FTF",
      `${stats.consecutiveMonths.count}, from ${formatMonth(stats.consecutiveMonths.start)} to ${formatMonth(stats.consecutiveMonths.end)}`
    ]);
  }
  if (stats.slowest?.intervalDays != null) {
    rows.push(["Slowest FTF", `${stats.slowest.intervalDays} days, ${stats.slowest.name} ${stats.slowest.gcCode}`]);
  }
  if (stats.nearest?.distanceKm != null) {
    rows.push(["Nearest FTF", `${formatDistance(stats.nearest.distanceKm)}, ${stats.nearest.name} ${stats.nearest.gcCode}`]);
  }
  if (stats.furthest?.distanceKm != null) {
    rows.push(["Furthest FTF", `${formatDistance(stats.furthest.distanceKm)}, ${stats.furthest.name} ${stats.furthest.gcCode}`]);
  }
  if (stats.mostNorthern?.latitude != null && stats.mostNorthern.longitude != null) {
    rows.push(["Most northerly FTF", `${formatCoordinate(stats.mostNorthern)}, ${stats.mostNorthern.name} ${stats.mostNorthern.gcCode}`]);
  }
  if (stats.mostSouthern?.latitude != null && stats.mostSouthern.longitude != null) {
    rows.push(["Most southerly FTF", `${formatCoordinate(stats.mostSouthern)}, ${stats.mostSouthern.name} ${stats.mostSouthern.gcCode}`]);
  }
  if (stats.mostEastern?.latitude != null && stats.mostEastern.longitude != null) {
    rows.push(["Most easterly FTF", `${formatCoordinate(stats.mostEastern)}, ${stats.mostEastern.name} ${stats.mostEastern.gcCode}`]);
  }
  if (stats.mostWestern?.latitude != null && stats.mostWestern.longitude != null) {
    rows.push(["Most westerly FTF", `${formatCoordinate(stats.mostWestern)}, ${stats.mostWestern.name} ${stats.mostWestern.gcCode}`]);
  }
  if (stats.highest?.elevationMeters != null) {
    rows.push(["Highest elevated FTF", `${Math.round(stats.highest.elevationMeters)} m, ${stats.highest.name} ${stats.highest.gcCode}`]);
  }
  if (stats.lowest?.elevationMeters != null) {
    rows.push(["Lowest elevated FTF", `${Math.round(stats.lowest.elevationMeters)} m, ${stats.lowest.name} ${stats.lowest.gcCode}`]);
  }
  if (stats.centroid) {
    rows.push([
      "FTF centroid",
      `${stats.centroid.latitude.toFixed(5)}, ${stats.centroid.longitude.toFixed(5)}${
        stats.centroid.distanceFromHomeKm == null ? "" : ` (${formatDistance(stats.centroid.distanceFromHomeKm)} from home)`
      }`
    ]);
  }
  rows.push(["FTFs which are now archived", `${stats.archivedCount}, ${formatPercent(stats.archivedPercent)}`]);
  return rows;
}

function FtfSummaryPanel({ stats }: { stats: FtfStats | null }) {
  const rows = summaryRows(stats);
  return (
    <section className="panel">
      <h2>Some numbers</h2>
      <div className="ftf-summary-table">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <p className="muted">No FTF summary numbers yet.</p> : null}
    </section>
  );
}

function FtfMapPanel({ rows }: { rows: FtfRow[] }) {
  const points: CacheMapPoint[] = rows
    .filter((row) => row.latitude != null && row.longitude != null)
    .map((row) => ({
      id: `${row.gcCode}-${row.date}`,
      gcCode: row.gcCode,
      name: row.name,
      cacheType: row.cacheType,
      latitude: row.latitude!,
      longitude: row.longitude!,
      foundAt: row.dateTime
    }));

  return (
    <section className="panel">
      <h2>FTF map</h2>
      {points.length > 0 ? (
        <div className="ftf-map-frame">
          <CacheMap points={points} />
        </div>
      ) : (
        <p className="muted">No FTF coordinates available.</p>
      )}
    </section>
  );
}

function CalendarHeatmap({ data }: { data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  const filled = data.filter((bucket) => bucket.count > 0).length;

  return (
    <section className="panel">
      <h2>FTFs by found date</h2>
      <div className="calendar-grid ftf-calendar-grid">
        <span />
        {Array.from({ length: 31 }, (_, day) => (
          <span key={day + 1}>{day + 1}</span>
        ))}
        {monthLabels.map((month, monthIndex) => (
          <CalendarMonthRow counts={counts} key={month} max={max} month={month} monthIndex={monthIndex} />
        ))}
      </div>
      <div className="mini-table-footer">
        <span>Found dates</span>
        <strong>
          {filled}/366 ({((filled / 366) * 100).toFixed(1)}%)
        </strong>
      </div>
    </section>
  );
}

function CalendarMonthRow({
  counts,
  max,
  month,
  monthIndex
}: {
  counts: Map<string, number>;
  max: number;
  month: string;
  monthIndex: number;
}) {
  return (
    <>
      <strong>{month}</strong>
      {Array.from({ length: 31 }, (_, dayIndex) => {
        const day = dayIndex + 1;
        const key = `${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = counts.get(key) ?? 0;
        return (
          <span
            className={count > 0 ? "calendar-cell filled" : "calendar-cell"}
            key={key}
            style={{ "--intensity": count / max } as React.CSSProperties & Record<"--intensity", number>}
            title={`${key}: ${count}`}
          >
            {count || ""}
          </span>
        );
      })}
    </>
  );
}

function FirstRowsTable({ rows, title }: { rows: FtfFirstRow[]; title: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="ftf-first-table">
        <span>#</span>
        <span>Date</span>
        <span>Location</span>
        <span>GC Code</span>
        <span>Type</span>
        <span>Cache name</span>
        {rows.map((row) => (
          <div className="ftf-first-row" key={`${row.label}-${row.gcCode}`}>
            <span>{row.index}</span>
            <span>{formatDateTime(row.dateTime)}</span>
            <strong>{row.label}</strong>
            <a href={`https://coord.info/${row.gcCode}`} rel="noreferrer" target="_blank">
              {row.gcCode}
            </a>
            <span>{row.cacheType ?? "Unknown"}</span>
            <span>{row.name}</span>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <p className="muted">No FTF rows yet.</p> : null}
    </section>
  );
}

function PercentTable({
  title,
  data,
  footer
}: {
  title: string;
  data: PercentBucket[];
  footer?: string;
}) {
  const max = Math.max(1, ...data.map((row) => row.count));
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <div className="ftf-percent-grid">
        <span>Name</span>
        <span>Amount</span>
        <span>Percent</span>
        <span />
        {data.map((row) => (
          <PercentRow key={row.key} max={max} row={row} />
        ))}
      </div>
      {footer ? <p className="ftf-table-note">{footer}</p> : null}
    </section>
  );
}

function PercentRow({ row, max }: { row: PercentBucket; max: number }) {
  return (
    <>
      <span>{row.key}</span>
      <strong>{row.count}</strong>
      <span>{formatPercent(row.percent)}</span>
      <span className="bar-track">{row.count > 0 ? <span style={{ width: `${(row.count / max) * 100}%` }} /> : null}</span>
    </>
  );
}

function ratingData(data: PercentBucket[]) {
  const byKey = new Map(data.map((row) => [row.key, row]));
  return ratingValues.map((key) => byKey.get(key) ?? { key, count: 0, percent: 0 });
}

function mergeFindRows(current: FindRow[], incoming: FindRow[]) {
  const byId = new Map(current.map((find) => [find.id, find]));
  for (const find of incoming) {
    byId.set(find.id, find);
  }
  return Array.from(byId.values());
}

function WayTo81Table({ entries }: { entries: FtfWayTo81Entry[] }) {
  return (
    <section className="panel">
      <h2>Way to 81 (FTF)</h2>
      <div className="way-table">
        <span>#</span>
        <span>Date</span>
        <span>Interval</span>
        <span>GC Code</span>
        <span>Cache name</span>
        <span>Type</span>
        <span>D/T</span>
        {entries.map((entry) => (
          <div className="ftf-way-row" key={`${entry.index}-${entry.gcCode}`}>
            <span>{entry.index}</span>
            <span>{formatDateTime(entry.dateTime)}</span>
            <span>{entry.intervalDays == null ? "-" : `${entry.intervalDays} days`}</span>
            <a href={`https://coord.info/${entry.gcCode}`} rel="noreferrer" target="_blank">
              {entry.gcCode}
            </a>
            <span>{entry.name}</span>
            <span>{entry.cacheType ?? "Unknown"}</span>
            <span>
              {entry.difficulty}/{entry.terrain}
            </span>
          </div>
        ))}
      </div>
      <p className="ftf-table-note">{entries.length} Diff/Terr combinations FTFed, out of 81.</p>
    </section>
  );
}

function FtfList({ rows }: { rows: FtfRow[] }) {
  return (
    <section className="panel">
      <h2>FTF list</h2>
      <div className="ftf-stats-table">
        <span>Date</span>
        <span>Interval</span>
        <span>GC Code</span>
        <span>Cache</span>
        <span>Type</span>
        {rows.map((row) => (
          <div className="ftf-stats-row" key={`${row.gcCode}-${row.dateTime}`}>
            <span>{formatDateTime(row.dateTime)}</span>
            <span>{row.intervalDays == null ? "-" : `${row.intervalDays} days`}</span>
            <a href={`https://coord.info/${row.gcCode}`} rel="noreferrer" target="_blank">
              {row.gcCode}
            </a>
            <strong>{row.name}</strong>
            <span>{row.cacheType ?? "Unknown"}</span>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <p className="muted">No FTF finds marked yet.</p> : null}
    </section>
  );
}

function FindPicker({
  finds,
  hasMoreFinds,
  onToggle
}: {
  finds: FindRow[];
  hasMoreFinds: boolean;
  onToggle: (find: FindRow, isFtf: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const hasQuery = query.trim().length > 0;
  const visibleFinds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return finds;
    }
    return finds.filter((find) => {
      return (
        find.cache.gcCode.toLowerCase().includes(normalized) ||
        find.cache.name.toLowerCase().includes(normalized) ||
        find.logText?.toLowerCase().includes(normalized)
      );
    });
  }, [finds, query]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Mark FTF finds</h2>
        <label className="ftf-search">
          <span className="sr-only">Search finds</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, cache, or log" />
        </label>
      </div>
      <div className="ftf-find-list">
        {visibleFinds.map((find) => (
          <label className={find.isFtf ? "ftf-find-row active" : "ftf-find-row"} key={find.id}>
            <input checked={find.isFtf} type="checkbox" onChange={(event) => onToggle(find, event.target.checked)} />
            <span>
              <strong>
                {find.cache.gcCode} - {find.cache.name}
              </strong>
              <small>
                {formatDateTime(find.foundAt)} - {find.cache.cacheType ?? "Unknown"}
                {find.cache.region ? ` - ${find.cache.region}` : ""}
              </small>
            </span>
          </label>
        ))}
      </div>
      {visibleFinds.length === 0 ? (
        <p className="muted">{hasQuery && hasMoreFinds ? "No matching loaded finds. Load more to search all finds." : "No matching finds."}</p>
      ) : null}
    </section>
  );
}

export default function FtfPage() {
  const [finds, setFinds] = useState<FindRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<FtfStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const findsLengthRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadFtfData({
    cursor,
    append = false,
    minimumFinds = 0
  }: { cursor?: string; append?: boolean; minimumFinds?: number } = {}) {
    const sequence = append ? loadSequenceRef.current : ++loadSequenceRef.current;
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const [findData, statData] = await Promise.all([
      apiFetch<FtfFindsResponse>(`/stats/ftf/finds?${params.toString()}`),
      append ? Promise.resolve(null) : apiFetch<{ stats: { ftfStats?: FtfStats } }>("/stats/summary")
    ]);
    if (!append && sequence !== loadSequenceRef.current) {
      return;
    }
    let loadedFinds = findData.finds;
    let loadedNextCursor = findData.nextCursor;
    while (!append && loadedFinds.length < minimumFinds && loadedNextCursor) {
      const nextParams = new URLSearchParams({ limit: "100", cursor: loadedNextCursor });
      const nextPage = await apiFetch<FtfFindsResponse>(`/stats/ftf/finds?${nextParams.toString()}`);
      if (!append && sequence !== loadSequenceRef.current) {
        return;
      }
      loadedFinds = mergeFindRows(loadedFinds, nextPage.finds);
      loadedNextCursor = nextPage.nextCursor;
    }
    setFinds((current) => (append ? mergeFindRows(current, loadedFinds) : loadedFinds));
    setNextCursor(loadedNextCursor);
    if (statData) {
      setStats(statData.stats.ftfStats ?? null);
    }
  }

  function scheduleFtfReload() {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
    reloadTimerRef.current = setTimeout(() => {
      if (loadingMoreRef.current) {
        scheduleFtfReload();
        return;
      }
      void loadFtfData({ minimumFinds: findsLengthRef.current }).catch(() => setError("Could not load FTF data."));
    }, 250);
  }

  useEffect(() => {
    findsLengthRef.current = finds.length;
  }, [finds.length]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    void loadFtfData().catch(() => setError("Could not load FTF data."));
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
    };
  }, []);

  async function loadMoreFinds() {
    if (!nextCursor || loadingMore) {
      return;
    }
    setError(null);
    setLoadingMore(true);
    try {
      await loadFtfData({ cursor: nextCursor, append: true });
    } catch {
      setError("Could not load more finds.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFtf(find: FindRow, isFtf: boolean) {
    setError(null);
    setFinds((current) => current.map((row) => (row.id === find.id ? { ...row, isFtf } : row)));
    try {
      await apiFetch(`/stats/ftf/finds/${find.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFtf })
      });
      scheduleFtfReload();
    } catch {
      setFinds((current) => current.map((row) => (row.id === find.id ? { ...row, isFtf: find.isFtf } : row)));
      setError("Could not update that FTF mark.");
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">First to find</p>
        <h1>FTF</h1>
      </header>
      <section className="stat-grid">
        <StatCard label="FTF finds" value={stats?.total ?? 0} detail={stats ? `${formatPercent(stats.percentOfFinds)} of finds` : ""} />
        <StatCard label="Average distance" value={formatDistance(stats?.averageDistanceKm ?? null)} />
        <StatCard label="Average interval" value={stats?.averageIntervalDays == null ? "-" : `${stats.averageIntervalDays.toFixed(1)} days`} />
        <StatCard label="Years" value={stats?.byYear.length ?? 0} />
      </section>
      {error ? <p className="error">{error}</p> : null}
      <FtfSummaryPanel stats={stats} />
      <FtfMapPanel rows={stats?.rows ?? []} />
      <section className="two-column">
        <div className="panel">
          <h2>FTF by year</h2>
          <CountBarChart data={stats?.byYear ?? []} />
        </div>
        <div className="panel">
          <h2>FTF by month</h2>
          <CountBarChart data={stats?.byMonth ?? []} />
        </div>
      </section>
      <CalendarHeatmap data={stats?.foundDateMatrix ?? []} />
      <section className="two-column">
        <FirstRowsTable rows={stats?.firstByLocation ?? []} title="First FTF by location" />
        <FirstRowsTable rows={stats?.firstByType ?? []} title="First FTF by type" />
      </section>
      <section className="panel">
        <h2>FTF breakdowns</h2>
        <div className="stats-breakdown-grid">
          <PercentTable title="FTFs by type" data={stats?.byType ?? []} />
          <PercentTable title="FTFs by size" data={stats?.bySize ?? []} />
          <PercentTable
            title="FTFs by difficulty"
            data={ratingData(stats?.byDifficulty ?? [])}
            footer={`Average difficulty: ${(stats?.averageDifficulty ?? 0).toFixed(2)}`}
          />
          <PercentTable
            title="FTFs by terrain"
            data={ratingData(stats?.byTerrain ?? [])}
            footer={`Average terrain: ${(stats?.averageTerrain ?? 0).toFixed(2)}`}
          />
        </div>
      </section>
      <section className="panel">
        <h2>FTF D/T chart</h2>
        <DifficultyTerrainGrid data={stats?.byDifficultyTerrain ?? []} />
      </section>
      <WayTo81Table entries={stats?.wayTo81 ?? []} />
      <section className="panel">
        <h2>FTF date breakdowns</h2>
        <div className="stats-breakdown-grid">
          <PercentTable title="FTFs by calendar month" data={stats?.byCalendarMonth ?? []} />
          <PercentTable title="FTFs by weekday" data={stats?.byWeekday ?? []} />
        </div>
      </section>
      <FtfList rows={stats?.rows ?? []} />
      <FindPicker finds={finds} hasMoreFinds={nextCursor !== null} onToggle={toggleFtf} />
      {nextCursor ? (
        <button className="ghost-button" type="button" onClick={loadMoreFinds} disabled={loadingMore}>
          {loadingMore ? "Loading..." : "Load more finds"}
        </button>
      ) : null}
    </AppShell>
  );
}
