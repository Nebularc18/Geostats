"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { API_URL, apiFetch } from "../../lib/api";

type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent: number };

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: Date) {
  return `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getDate()).padStart(2, "0")}`;
}

function formatNumber(value: unknown, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "-";
}

function section(title: string, body: string) {
  return `
    <div style="margin:18px auto 8px; max-width:740px; background:#426052; color:#ffffff; border:1px solid #23362d; font-weight:bold; line-height:24px; font-size:13px; text-align:center;">${escapeHtml(title)}</div>
    ${body}`;
}

function statTable(rows: Array<[string, string]>) {
  return `
    <table border="0" cellpadding="6" cellspacing="1" style="width:740px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="width:42%; background:#eef4ef; color:#334238; font-weight:bold;">${escapeHtml(label)}</td>
          <td style="background:#ffffff; color:#111111;">${value}</td>
        </tr>`
        )
        .join("")}
    </table>`;
}

function bucketTable(title: string, buckets: CountBucket[] = [], maxRows = 12) {
  const rows = buckets.slice(0, maxRows);
  if (rows.length === 0) {
    return "";
  }

  return section(
    title,
    `<table border="0" cellpadding="5" cellspacing="1" style="width:740px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px;">
      ${rows
        .map(
          (row) => `
        <tr>
          <td style="background:#ffffff; color:#111111;">${escapeHtml(row.key)}</td>
          <td style="width:90px; background:#eef4ef; color:#111111; text-align:right; font-weight:bold;">${formatNumber(row.count)}</td>
        </tr>`
        )
        .join("")}
    </table>`
  );
}

function percentBucketTable(title: string, buckets: PercentBucket[] = [], maxRows = 12) {
  const rows = buckets.slice(0, maxRows);
  if (rows.length === 0) {
    return "";
  }

  return section(
    title,
    `<table border="0" cellpadding="5" cellspacing="1" style="width:740px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px;">
      ${rows
        .map(
          (row) => `
        <tr>
          <td style="background:#ffffff; color:#111111;">${escapeHtml(row.key)}</td>
          <td style="width:90px; background:#eef4ef; color:#111111; text-align:right; font-weight:bold;">${formatNumber(row.count)}</td>
          <td style="width:90px; background:#eef4ef; color:#111111; text-align:right;">${formatPercent(row.percent)}</td>
        </tr>`
        )
        .join("")}
    </table>`
  );
}

function monthTable(findsByMonth: CountBucket[] = []) {
  if (findsByMonth.length === 0) {
    return "";
  }

  const years = [...new Set(findsByMonth.map((bucket) => bucket.key.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const counts = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
  return section(
    "Finds by Month",
    `<table border="0" cellpadding="5" cellspacing="1" style="width:740px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px; text-align:center;">
      <tr>
        <td style="background:#eef4ef; color:#334238; font-weight:bold;">Year</td>
        ${monthLabels.map((month) => `<td style="background:#eef4ef; color:#334238; font-weight:bold;">${month}</td>`).join("")}
        <td style="background:#eef4ef; color:#334238; font-weight:bold;">Total</td>
      </tr>
      ${years
        .map((year) => {
          const months = monthLabels.map((_, index) => counts.get(`${year}-${String(index + 1).padStart(2, "0")}`) ?? 0);
          const total = months.reduce((sum, count) => sum + count, 0);
          return `
        <tr>
          <td style="background:#eef4ef; color:#111111; font-weight:bold;">${year}</td>
          ${months.map((count) => `<td style="background:#ffffff; color:#111111;">${count || ""}</td>`).join("")}
          <td style="background:#eef4ef; color:#111111; font-weight:bold;">${total}</td>
        </tr>`;
        })
        .join("")}
    </table>`
  );
}

function difficultyTerrainTable(data: Array<{ difficulty: number; terrain: number; count: number }> = []) {
  if (data.length === 0) {
    return "";
  }

  const counts = new Map(data.map((cell) => [`${cell.difficulty}/${cell.terrain}`, cell.count]));
  const values = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];
  return section(
    "Difficulty / Terrain",
    `<table border="0" cellpadding="4" cellspacing="1" style="width:540px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px; text-align:center;">
      <tr>
        <td style="background:#eef4ef; color:#334238; font-weight:bold;">D/T</td>
        ${values.map((terrain) => `<td style="background:#eef4ef; color:#334238; font-weight:bold;">${terrain}</td>`).join("")}
      </tr>
      ${values
        .map(
          (difficulty) => `
        <tr>
          <td style="background:#eef4ef; color:#334238; font-weight:bold;">${difficulty}</td>
          ${values
            .map((terrain) => {
              const count = counts.get(`${Number(difficulty)}/${Number(terrain)}`) ?? 0;
              return `<td style="background:${count ? "#dff0e4" : "#ffffff"}; color:#111111;">${count || ""}</td>`;
            })
            .join("")}
        </tr>`
        )
        .join("")}
    </table>`
  );
}

function milestoneTable(milestones: Array<{ count: number; date: string; gcCode: string; name: string }> = []) {
  if (milestones.length === 0) {
    return "";
  }

  return section(
    "Milestones",
    `<table border="0" cellpadding="5" cellspacing="1" style="width:740px; max-width:100%; margin:0 auto 14px; background:#c8d6cc; font-size:12px;">
      ${milestones
        .slice(-12)
        .map(
          (row) => `
        <tr>
          <td style="width:70px; background:#eef4ef; color:#111111; text-align:right; font-weight:bold;">#${formatNumber(row.count)}</td>
          <td style="width:105px; background:#ffffff; color:#111111;">${escapeHtml(row.date)}</td>
          <td style="background:#ffffff; color:#111111;"><a href="https://coord.info/${escapeHtml(row.gcCode)}">${escapeHtml(row.gcCode)}</a> ${escapeHtml(row.name)}</td>
        </tr>`
        )
        .join("")}
    </table>`
  );
}

function buildProfileHtml(stats: any, profile: any, options: { includeFtf: boolean; includeHides: boolean; includeMilestones: boolean }) {
  const username = profile?.gcUsername || "Geocacher";
  const generated = formatDate(new Date());
  const totalFinds = stats?.totalFinds ?? 0;
  const countryCount = stats?.countries?.length ?? 0;
  const summary = stats?.summaryNumbers ?? {};
  const distance = stats?.distanceStats ?? null;
  const ftf = stats?.ftfStats ?? null;
  const hides = stats?.hideStats ?? null;

  const overviewRows: Array<[string, string]> = [
    ["Total finds", `<strong>${formatNumber(totalFinds)}</strong>`],
    ["Countries cached in", `<strong>${formatNumber(countryCount)}</strong>`],
    ["Caching days", `${formatNumber(summary.cachingDays)} of ${formatNumber(summary.totalDays)} days`],
    ["Finds per caching day", formatNumber(summary.findsPerCachingDay, 2)],
    ["Average finds per day", formatNumber(summary.findsPerDay, 2)],
    ["Best day", summary.bestDay ? `${formatNumber(summary.bestDay.count)} on ${escapeHtml(summary.bestDay.key)}` : "-"],
    ["Best month", summary.bestMonth ? `${formatNumber(summary.bestMonth.count)} in ${escapeHtml(summary.bestMonth.key)}` : "-"],
    ["Longest streak", `${formatNumber(stats?.streaks?.longest)} days`],
    ["Average distance from home", distance?.averageDistanceKm == null ? "-" : `${formatNumber(distance.averageDistanceKm, 0)} km`]
  ];

  const ftfBlock =
    options.includeFtf && ftf
      ? section(
          "FTF Statistics",
          statTable([
            ["FTF finds", `${formatNumber(ftf.total)} (${formatPercent(ftf.percentOfFinds)} of finds)`],
            ["Average FTF interval", ftf.averageIntervalDays == null ? "-" : `${formatNumber(ftf.averageIntervalDays, 1)} days`],
            ["First FTF", ftf.first ? `${escapeHtml(ftf.first.date)} - <a href="https://coord.info/${escapeHtml(ftf.first.gcCode)}">${escapeHtml(ftf.first.gcCode)}</a> ${escapeHtml(ftf.first.name)}` : "-"],
            ["Latest FTF", ftf.latest ? `${escapeHtml(ftf.latest.date)} - <a href="https://coord.info/${escapeHtml(ftf.latest.gcCode)}">${escapeHtml(ftf.latest.gcCode)}</a> ${escapeHtml(ftf.latest.name)}` : "-"],
            ["Archived FTFs", `${formatNumber(ftf.archivedCount)} (${formatPercent(ftf.archivedPercent)})`]
          ])
        )
      : "";

  const hidesBlock =
    options.includeHides && hides?.totalHides
      ? section(
          "Owned Caches",
          statTable([
            ["Owned caches", formatNumber(hides.totalHides)],
            ["Active / archived", `${formatNumber(hides.activeHides)} / ${formatNumber(hides.archivedHides)}`],
            ["Received logs", formatNumber(hides.totalReceivedLogs)],
            ["Unique finders", formatNumber(hides.totalUniqueFinders)],
            ["Favorite points received", formatNumber(hides.totalFavoritePoints)]
          ])
        )
      : "";

  const milestonesBlock = options.includeMilestones ? milestoneTable(stats?.milestones ?? []) : "";

  return `<div id="geostats-profile" align="center" style="background:#e4ece6; font-family:Verdana, Arial, sans-serif; font-size:12px; color:#111111; margin:1px; padding:12px; border:1px solid #8fa398; line-height:normal;">
  <div style="font-family:Tahoma, Arial, sans-serif; font-size:18px; font-weight:bold; color:#1f3329;">
    ${escapeHtml(username)} has ${formatNumber(totalFinds)} finds
  </div>
  <div style="margin:6px 0 18px; color:#42534a;"><i>Statistics generated by Geostats on ${generated}</i></div>
  ${section("Overview", statTable(overviewRows))}
  ${monthTable(stats?.findsByMonth ?? [])}
  ${bucketTable("Countries", stats?.countries ?? [], 16)}
  ${percentBucketTable("Cache Types", stats?.cacheTypes ?? [], 12)}
  ${bucketTable("Regions", stats?.regions ?? [], 16)}
  ${bucketTable("Counties / Municipalities", stats?.counties ?? [], 16)}
  ${difficultyTerrainTable(stats?.difficultyTerrain ?? [])}
  ${milestonesBlock}
  ${ftfBlock}
  ${hidesBlock}
  <div style="max-width:740px; margin:18px auto 0; padding-top:10px; border-top:1px solid #b9c9bf; color:#42534a; font-size:11px;">
    Generated with Geostats
  </div>
</div>`;
}

export default function ProfileHtmlPage() {
  const [stats, setStats] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [includeFtf, setIncludeFtf] = useState(true);
  const [includeHides, setIncludeHides] = useState(true);
  const [includeMilestones, setIncludeMilestones] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  useEffect(() => {
    void apiFetch<{ stats: any }>("/stats/summary").then((data) => setStats(data.stats));
    void apiFetch<{ profile: any }>("/profile").then((data) => setProfile(data.profile));
  }, []);

  const html = useMemo(
    () => buildProfileHtml(stats, profile, { includeFtf, includeHides, includeMilestones }),
    [includeFtf, includeHides, includeMilestones, profile, stats]
  );
  const publicUsername = profile?.gcUsername ? encodeURIComponent(profile.gcUsername) : "";
  const dynamicHtmlUrl = publicUsername ? `${API_URL}/public/profile-stats/${publicUsername}` : "";
  const dynamicImageUrl = publicUsername ? `${API_URL}/public/profile-stats-image/${publicUsername}` : "";
  const embedHtml = dynamicHtmlUrl && dynamicImageUrl ? `<a href="${dynamicHtmlUrl}" target="_top"><img src="${dynamicImageUrl}" width="750"></a>` : "";

  async function copyHtml() {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function copyEmbedHtml() {
    await navigator.clipboard.writeText(embedHtml);
    setCopiedEmbed(true);
    window.setTimeout(() => setCopiedEmbed(false), 1800);
  }

  function downloadHtml() {
    const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>Geostats profile HTML</title></head><body>${html}</body></html>`], {
      type: "text/html;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "geostats-profile.html";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Geocaching profile export</p>
          <h1>Profile HTML</h1>
        </div>
        <div className="profile-html-actions">
          <button className="primary-button" type="button" onClick={copyHtml}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
            {copied ? "Copied" : "Copy HTML"}
          </button>
          <button className="ghost-button inline-action" type="button" onClick={downloadHtml}>
            <Download size={18} />
            Download
          </button>
        </div>
      </header>

      <section className="panel profile-html-options">
        <label>
          <input type="checkbox" checked={includeMilestones} onChange={(event) => setIncludeMilestones(event.target.checked)} />
          Milestones
        </label>
        <label>
          <input type="checkbox" checked={includeFtf} onChange={(event) => setIncludeFtf(event.target.checked)} />
          FTF summary
        </label>
        <label>
          <input type="checkbox" checked={includeHides} onChange={(event) => setIncludeHides(event.target.checked)} />
          Owned cache summary
        </label>
      </section>

      <section className="panel profile-html-embed-panel">
        <div className="panel-heading">
          <div>
            <h2>Dynamic profile snippet</h2>
            <small className="muted">This updates when Geostats recalculates your stats.</small>
          </div>
          <button className="primary-button" type="button" onClick={copyEmbedHtml} disabled={!embedHtml}>
            {copiedEmbed ? <Check size={18} /> : <Clipboard size={18} />}
            {copiedEmbed ? "Copied" : "Copy snippet"}
          </button>
        </div>
        <textarea readOnly rows={3} value={embedHtml || "Set your geocaching username in Profile first."} aria-label="Dynamic geocaching profile image snippet" />
        {dynamicHtmlUrl ? (
          <p className="muted">
            Public page: <a href={dynamicHtmlUrl} target="_blank" rel="noreferrer">{dynamicHtmlUrl}</a>
          </p>
        ) : null}
      </section>

      <section className="profile-html-layout">
        <div className="panel profile-html-code-panel">
          <div className="panel-heading">
            <h2>Copyable HTML</h2>
            <small className="muted">{html.length.toLocaleString()} characters</small>
          </div>
          <textarea readOnly value={html} aria-label="Generated geocaching profile HTML" />
        </div>
        <div className="panel profile-html-preview-panel">
          <div className="panel-heading">
            <h2>Preview</h2>
            <small className="muted">Inline styles only</small>
          </div>
          <iframe title="Generated geocaching profile preview" srcDoc={`<!doctype html><html><body style="margin:0">${html}</body></html>`} />
        </div>
      </section>
    </AppShell>
  );
}
