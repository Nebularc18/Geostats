"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppShell } from "../../components/app-shell";
import { CountBarChart, CumulativeFindsChart } from "../../components/charts";
import { DifficultyTerrainGrid } from "../../components/difficulty-terrain-grid";
import { StatCard } from "../../components/stat-card";
import { apiFetch } from "../../lib/api";

type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type HideStats = {
  totalHides: number;
  activeHides: number;
  archivedHides: number;
  totalReceivedLogs: number;
  totalUniqueFinders: number;
  totalFavoritePoints: number;
  averageLogsPerHide: number;
  receivedLogsByYear: CountBucket[];
  receivedLogsByMonth: CountBucket[];
  cumulativeReceivedLogsByMonth: CountBucket[];
  receivedLogsByCalendarMonth: PercentBucket[];
  receivedLogsByWeekday: PercentBucket[];
  receivedLogsByType: PercentBucket[];
  receivedFoundDateMatrix: CountBucket[];
  placedHiddenDateMatrix: CountBucket[];
  hidesByYear: CountBucket[];
  hidesByMonth: CountBucket[];
  hidesByType: PercentBucket[];
  hidesBySize: PercentBucket[];
  hidesByDifficulty: PercentBucket[];
  hidesByTerrain: PercentBucket[];
  hidesByCountry: CountBucket[];
  hidesByRegion: CountBucket[];
  hidesByDifficultyTerrain: Array<{ difficulty: number; terrain: number; count: number }>;
  finderCountryBuckets: PercentBucket[];
  finderBuckets: PercentBucket[];
  recentReceivedLogs: Array<{
    date: string;
    finder: string;
    type: string;
    text: string | null;
    gcCode: string;
    cacheName: string;
  }>;
  hideSummaryRows: Array<{ label: string; value: string }>;
  logsReceived: Array<{
    hidden: string | null;
    lastFound: string | null;
    finds: number;
    daysPerFind: number | null;
    favoritePoints: number;
    gcCode: string;
    name: string;
    cacheType: string | null;
  }>;
  topLoggedHides: Array<{
    gcCode: string;
    name: string;
    count: number;
    cacheType: string | null;
    placedAt: string | null;
  }>;
};

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ratingValues = ["1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

function percentFor(data: PercentBucket[], key: string) {
  return data.find((row) => row.key === key) ?? { key, count: 0, percent: 0 };
}

function PercentTable({ title, data, rows }: { title: string; data: PercentBucket[]; rows?: string[] }) {
  const visibleRows = rows ? rows.map((key) => percentFor(data, key)) : data;
  const max = Math.max(1, ...visibleRows.map((row) => row.count));
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <div className="hide-percent-grid">
        <div className="hide-percent-row hide-percent-head">
          <span>Name</span>
          <span>Amount</span>
          <span>Percent</span>
          <span />
        </div>
        {visibleRows.map((row) => (
          <div className="hide-percent-row" key={row.key}>
            <span>{row.key}</span>
            <strong>{row.count}</strong>
            <span>{row.percent.toFixed(row.percent % 1 === 0 ? 0 : 2)}%</span>
            <span className="bar-track">
              {row.count > 0 ? <span style={{ width: `${(row.count / max) * 100}%` }} /> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CountPercentTable({ title, data, total }: { title: string; data: CountBucket[]; total: number }) {
  return (
    <PercentTable
      title={title}
      data={data.map((row) => ({ ...row, percent: total > 0 ? (row.count / total) * 100 : 0 }))}
    />
  );
}

function OwnedStatsTable({ rows }: { rows: HideStats["hideSummaryRows"] }) {
  return (
    <section className="panel hide-report-section">
      <h2>Owned cache statistics</h2>
      <div className="hide-summary-table">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function LogsReceivedTable({ rows, ownerName }: { rows: HideStats["logsReceived"]; ownerName: string }) {
  const totalLogs = rows.reduce((sum, row) => sum + row.finds, 0);
  return (
    <section className="panel hide-report-section">
      <h2>Logs received</h2>
      <div className="hide-log-table">
        <span>Hidden</span>
        <span>Last log</span>
        <span>Logs</span>
        <span>Days/log</span>
        <span>FP</span>
        <span>GC Code</span>
        <span>Cache name</span>
        {rows.map((row) => (
          <Fragment key={row.gcCode}>
            <span>{row.hidden ?? "-"}</span>
            <span>{row.lastFound ?? "-"}</span>
            <strong>{row.finds}</strong>
            <span>{row.daysPerFind == null ? "-" : row.daysPerFind.toFixed(1)}</span>
            <span>{row.favoritePoints}</span>
            <a href={`https://coord.info/${row.gcCode}`} rel="noreferrer" target="_blank">
              {row.gcCode}
            </a>
            <span>{row.name}</span>
          </Fragment>
        ))}
      </div>
      <p className="hide-table-note">
        {totalLogs} logs on {rows.length} geocaches owned by {ownerName}.
      </p>
    </section>
  );
}

function RecentReceivedLogs({ rows }: { rows: HideStats["recentReceivedLogs"] }) {
  return (
    <section className="panel hide-report-section">
      <h2>Recent imported logs</h2>
      <div className="hide-recent-log-table">
        <span>Date</span>
        <span>Type</span>
        <span>Logger</span>
        <span>Cache</span>
        {rows.map((row, index) => (
          <Fragment key={`${row.gcCode}-${row.date}-${row.finder}-${row.type}-${index}`}>
            <span>{row.date}</span>
            <strong>{row.type}</strong>
            <span>{row.finder}</span>
            <a href={`https://coord.info/${row.gcCode}`} rel="noreferrer" target="_blank" title={row.cacheName}>
              {row.gcCode}
            </a>
          </Fragment>
        ))}
      </div>
      {rows.length === 0 ? <p className="muted">No imported owner logs yet.</p> : null}
      {rows.length === 100 ? <p className="hide-table-note">Showing the 100 most recent imported logs.</p> : null}
    </section>
  );
}

function CalendarHeatmap({ title, data }: { title: string; data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  const filled = data.filter((bucket) => bucket.count > 0).length;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <section className="panel hide-report-section">
      <h2>{title}</h2>
      <div className="calendar-grid hide-calendar-grid">
        <span />
        {Array.from({ length: 31 }, (_, day) => (
          <span key={day + 1}>{day + 1}</span>
        ))}
        {monthNames.map((month, monthIndex) => (
          <Fragment key={month}>
            <strong>{month}</strong>
            {Array.from({ length: 31 }, (_, dayIndex) => {
              const day = dayIndex + 1;
              const key = `${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const count = counts.get(key) ?? 0;
              return (
                <span
                  className={count > 0 ? "calendar-cell filled" : "calendar-cell"}
                  key={key}
                  style={{ "--intensity": count / max } as CSSProperties & Record<"--intensity", number>}
                  title={`${key}: ${count}`}
                >
                  {count || ""}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="mini-table-footer">
        <span>Filled dates</span>
        <strong>
          {filled}/366 ({((filled / 366) * 100).toFixed(1)}%)
        </strong>
      </div>
    </section>
  );
}

function MonthPerYearTable({ data }: { data: CountBucket[] }) {
  const years = useMemo(() => [...new Set(data.map((bucket) => bucket.key.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [data]);
  const [selectedYear, setSelectedYear] = useState("all");
  const visibleYears = selectedYear === "all" ? years : years.filter((year) => year === selectedYear);
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));

  return (
    <section className="panel hide-report-section">
      <h2>Logs on my hides by month per year</h2>
      <div className="tab-list">
        {years.map((year) => (
          <button className={selectedYear === year ? "active" : ""} key={year} type="button" onClick={() => setSelectedYear(year)}>
            {year}
          </button>
        ))}
        <button className={selectedYear === "all" ? "active" : ""} type="button" onClick={() => setSelectedYear("all")}>
          All
        </button>
      </div>
      <div className="hide-month-table">
        {visibleYears.map((year) => (
          <Fragment key={year}>
            <h3>{year}</h3>
            <div className="month-grid">
              <div className="month-grid-label">Month</div>
              {monthLabels.map((month) => (
                <div key={month}>{month}</div>
              ))}
              <div className="month-grid-label">Finds</div>
              {monthLabels.map((_, index) => {
                const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                return <strong key={key}>{counts.get(key) || ""}</strong>;
              })}
            </div>
          </Fragment>
        ))}
        {years.length === 0 ? <p className="muted">No received logs yet.</p> : null}
      </div>
    </section>
  );
}

export default function HidesPage() {
  const [hideStats, setHideStats] = useState<HideStats | null>(null);
  const [ownerName, setOwnerName] = useState("you");
  const hasFinderCountries = hideStats?.finderCountryBuckets?.some((row) => row.key !== "Unknown" && row.count > 0) ?? false;

  useEffect(() => {
    void apiFetch<{ stats: { hideStats?: HideStats } }>("/stats/summary")
      .then((data) => setHideStats(data.stats.hideStats ?? null))
      .catch(() => setHideStats(null));
    void apiFetch<{ user?: { username?: string } }>("/auth/me")
      .then((data) => setOwnerName(data.user?.username ?? "you"))
      .catch(() => setOwnerName("you"));
  }, []);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Owner statistics</p>
        <h1>Hides</h1>
      </header>
      <section className="stat-grid">
        <StatCard label="Owned" value={hideStats?.totalHides ?? 0} />
        <StatCard label="Active" value={hideStats?.activeHides ?? 0} />
        <StatCard label="Received logs" value={hideStats?.totalReceivedLogs ?? 0} />
        <StatCard label="Finders" value={hideStats?.totalUniqueFinders ?? 0} />
      </section>

      <section className="two-column">
        <div className="panel">
          <h2>Cumulative logs on my caches</h2>
          <CumulativeFindsChart data={hideStats?.cumulativeReceivedLogsByMonth ?? []} />
        </div>
        <div className="panel">
          <h2>Caching karma</h2>
          <CountBarChart data={hideStats?.receivedLogsByYear ?? []} />
        </div>
      </section>

      <MonthPerYearTable data={hideStats?.receivedLogsByMonth ?? []} />
      <OwnedStatsTable rows={hideStats?.hideSummaryRows ?? []} />
      <LogsReceivedTable rows={hideStats?.logsReceived ?? []} ownerName={ownerName} />
      <RecentReceivedLogs rows={hideStats?.recentReceivedLogs ?? []} />

      <section className="panel hide-report-section">
        <h2>Finder and favorite breakdowns</h2>
        <div className="stats-breakdown-grid">
          {hasFinderCountries ? <PercentTable title="Finders by country" data={hideStats?.finderCountryBuckets ?? []} /> : null}
          <CountPercentTable title="Placed by country" data={hideStats?.hidesByCountry ?? []} total={hideStats?.totalHides ?? 0} />
          <PercentTable title="Top finders of my caches" data={hideStats?.finderBuckets ?? []} />
          <PercentTable title="Received log types" data={hideStats?.receivedLogsByType ?? []} />
          <PercentTable title="Placed by type" data={hideStats?.hidesByType ?? []} />
          <PercentTable title="Placed by size" data={hideStats?.hidesBySize ?? []} />
        </div>
      </section>

      <section className="panel hide-report-section">
        <h2>Placed ratings</h2>
        <div className="stats-breakdown-grid">
          <PercentTable title="Placed by difficulty rating" data={hideStats?.hidesByDifficulty ?? []} rows={ratingValues} />
          <PercentTable title="Placed by terrain rating" data={hideStats?.hidesByTerrain ?? []} rows={ratingValues} />
        </div>
      </section>

      <section className="panel hide-report-section">
        <h2>Placed D/T chart</h2>
        <DifficultyTerrainGrid data={hideStats?.hidesByDifficultyTerrain ?? []} />
      </section>

      <CalendarHeatmap title="Placed by hidden date" data={hideStats?.placedHiddenDateMatrix ?? []} />
      <CalendarHeatmap title="Received by log date" data={hideStats?.receivedFoundDateMatrix ?? []} />

      <section className="panel hide-report-section">
        <h2>Received logs</h2>
        <div className="stats-breakdown-grid">
          <PercentTable title="Logs by calendar month" data={hideStats?.receivedLogsByCalendarMonth ?? []} />
          <PercentTable title="Logs by weekday" data={hideStats?.receivedLogsByWeekday ?? []} />
        </div>
      </section>
    </AppShell>
  );
}
