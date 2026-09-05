type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent?: number };

export const PUBLIC_PROFILE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ratingValues = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];
const countryNameAliases: Record<string, string[]> = {
  "United States": ["United States of America"],
  Russia: ["Russian Federation"],
  "South Korea": ["Republic of Korea"],
  "North Korea": ["Democratic People's Republic of Korea"],
  "Czech Republic": ["Czechia"],
  Czechia: ["Czech Republic"],
  "United Kingdom": ["United Kingdom of Great Britain and Northern Ireland"],
  Vietnam: ["Viet Nam"],
  Iran: ["Iran (Islamic Republic of)"],
  Moldova: ["Republic of Moldova"],
  Tanzania: ["United Republic of Tanzania"],
  Syria: ["Syrian Arab Republic"],
  Bolivia: ["Bolivia (Plurinational State of)"],
  Venezuela: ["Venezuela (Bolivarian Republic of)"]
};
const continentViews: Record<string, { center: [number, number]; zoom: number; order: number }> = {
  Africa: { center: [19, 2], zoom: 2.25, order: 1 },
  Antarctica: { center: [0, -82], zoom: 1.45, order: 7 },
  Asia: { center: [89, 34], zoom: 1.9, order: 3 },
  Europe: { center: [16, 54], zoom: 2.75, order: 2 },
  "North America": { center: [-101, 46], zoom: 2.1, order: 4 },
  Oceania: { center: [139, -24], zoom: 2.4, order: 6 },
  "South America": { center: [-60, -18], zoom: 2.3, order: 5 }
};
const countryContinentGroups: Record<string, string[]> = {
  Africa: [
    "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cabo Verde", "Cameroon", "Central African Republic",
    "Chad", "Comoros", "Congo", "Democratic Republic of the Congo", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea",
    "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast", "Kenya", "Lesotho",
    "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique", "Namibia",
    "Niger", "Nigeria", "Rwanda", "Sao Tome and Principe", "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa",
    "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"
  ],
  Antarctica: ["Antarctica"],
  Asia: [
    "Afghanistan", "Armenia", "Azerbaijan", "Bahrain", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China", "Georgia",
    "Hong Kong", "India", "Indonesia", "Iran", "Iraq", "Israel", "Japan", "Jordan", "Kazakhstan", "Kuwait", "Kyrgyzstan",
    "Laos", "Lebanon", "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "North Korea", "Oman", "Pakistan",
    "Palestine", "Philippines", "Qatar", "Saudi Arabia", "Singapore", "South Korea", "Sri Lanka", "Syria", "Taiwan",
    "Tajikistan", "Thailand", "Timor-Leste", "Turkey", "Turkmenistan", "United Arab Emirates", "Uzbekistan", "Vietnam", "Yemen"
  ],
  Europe: [
    "Albania", "Andorra", "Austria", "Belarus", "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus",
    "Czech Republic", "Czechia", "Denmark", "Estonia", "Faroe Islands", "Finland", "France", "Germany", "Gibraltar", "Greece",
    "Guernsey", "Hungary", "Iceland", "Ireland", "Isle of Man", "Italy", "Jersey", "Kosovo", "Latvia", "Liechtenstein",
    "Lithuania", "Luxembourg", "Malta", "Moldova", "Monaco", "Montenegro", "Netherlands", "North Macedonia", "Norway",
    "Poland", "Portugal", "Romania", "Russia", "San Marino", "Serbia", "Slovakia", "Slovenia", "Spain", "Sweden",
    "Switzerland", "Ukraine", "United Kingdom", "Vatican City"
  ],
  "North America": [
    "Anguilla", "Antigua and Barbuda", "Aruba", "Bahamas", "Barbados", "Belize", "Bermuda", "British Virgin Islands",
    "Canada", "Cayman Islands", "Costa Rica", "Cuba", "Curacao", "Dominica", "Dominican Republic", "El Salvador", "Greenland",
    "Grenada", "Guadeloupe", "Guatemala", "Haiti", "Honduras", "Jamaica", "Martinique", "Mexico", "Montserrat", "Nicaragua",
    "Panama", "Puerto Rico", "Saint Kitts and Nevis", "Saint Lucia", "Saint Martin", "Saint Pierre and Miquelon",
    "Saint Vincent and the Grenadines", "Sint Maarten", "Trinidad and Tobago", "Turks and Caicos Islands", "United States",
    "United States of America", "US Virgin Islands"
  ],
  Oceania: [
    "Australia", "Cook Islands", "Fiji", "French Polynesia", "Guam", "Kiribati", "Marshall Islands", "Micronesia", "Nauru",
    "New Caledonia", "New Zealand", "Niue", "Norfolk Island", "Northern Mariana Islands", "Palau", "Papua New Guinea", "Samoa",
    "Solomon Islands", "Tonga", "Tuvalu", "Vanuatu"
  ],
  "South America": [
    "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Falkland Islands", "French Guiana", "Guyana", "Paraguay",
    "Peru", "Suriname", "Uruguay", "Venezuela"
  ]
};
const countryContinentLookup = new Map(
  Object.entries(countryContinentGroups).flatMap(([continent, countries]) =>
    countries.flatMap((country) => countryNamesForBoundary(country).map((name) => [name.toLowerCase(), continent] as const))
  )
);

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value = new Date()) {
  return `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getDate()).padStart(2, "0")}`;
}

function generatedDateForStats(stats: any) {
  const latestImport = stats?.latestImportAt ? new Date(stats.latestImportAt) : null;
  return latestImport && Number.isFinite(latestImport.getTime()) ? formatDate(latestImport) : formatDate();
}

function dateDots(value: string | null | undefined) {
  return value ? value.replace(/-/g, ".") : "";
}

function formatNumber(value: unknown, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return number.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} %` : "-";
}

function sectionHead(title: string, width = 740) {
  return `<div style="width:${width}px; max-width:100%; background:#666699; font-weight:bold; line-height:20px; font-size:13px; color:white; border:1px solid #000000; text-align:center; margin:0 auto 6px;">
    ${escapeHtml(title)}
  </div>`;
}

function mixColor(start: string, end: string, amount: number) {
  const normalized = Math.max(0, Math.min(1, amount));
  const startRgb = start.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const endRgb = end.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const mixed = startRgb.map((channel, index) =>
    Math.round(channel + ((endRgb[index] ?? channel) - channel) * normalized)
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function scratchColor(count: number, max: number) {
  if (count <= 0 || max <= 0) {
    return "rgba(237, 244, 232, 0.1)";
  }

  const intensity = Math.log1p(count) / Math.log1p(max);
  return mixColor("#dce88d", "#1f6f3b", intensity);
}

function countryNamesForBoundary(countryName: string) {
  return [countryName, ...(countryNameAliases[countryName] ?? [])];
}

function topLocationList(buckets: CountBucket[], max: number, total: number, limit = 14) {
  const rows = buckets.slice(0, limit);
  if (!rows.length) {
    return `<div class="public-scratch-empty">No locations yet.</div>`;
  }
  return rows
    .map((bucket) => {
      const color = scratchColor(bucket.count, max);
      const percent = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
      return `<div class="public-scratch-tile" style="--scratch-color:${color};">
        <strong>${escapeHtml(bucket.key)}</strong>
        <span>${formatNumber(bucket.count)} finds - ${percent}%</span>
      </div>`;
    })
    .join("");
}

function continentForCountry(country: string) {
  return countryContinentLookup.get(country.toLowerCase()) ?? "Other";
}

function gsakMapColor(count: number) {
  if (count >= 1000) return "#b91c1c";
  if (count >= 500) return "#ea580c";
  if (count >= 250) return "#db2777";
  if (count >= 100) return "#7c3aed";
  if (count >= 75) return "#2563eb";
  if (count >= 50) return "#1693c7";
  if (count >= 25) return "#22b8a6";
  if (count >= 10) return "#41c86a";
  if (count >= 2) return "#a7e163";
  if (count >= 1) return "#fff1a8";
  return "#f7f1d0";
}

function staticMapLegend() {
  const steps = [
    ["#fff1a8", "1"],
    ["#a7e163", "2-9"],
    ["#41c86a", "10-24"],
    ["#22b8a6", "25-49"],
    ["#1693c7", "50-74"],
    ["#2563eb", "75-99"],
    ["#7c3aed", "100-249"],
    ["#db2777", "250-499"],
    ["#ea580c", "500-999"],
    ["#b91c1c", "1000+"]
  ];

  return steps
    .map(([color, label], index) => {
      const x = 18 + index * 72;
      return `<rect x="${x}" y="428" width="12" height="12" fill="${color}" stroke="#333" stroke-width="0.5"/><text x="${x + 16}" y="438" font-size="10" fill="#111">${label}</text>`;
    })
    .join("");
}

export function renderPublicScratchMapSvg(
  profile: { gcUsername: string },
  stats: any,
  worldMapTemplate: string
) {
  const countries = (stats?.countries ?? []) as CountBucket[];
  const countsByBoundaryName = new Map<string, number>();
  for (const country of countries) {
    for (const name of countryNamesForBoundary(country.key)) {
      countsByBoundaryName.set(name.toLowerCase(), country.count);
    }
  }

  const coloredTemplate = worldMapTemplate.replace(
    /(<path\b[^>]*\bfill=")[^"]*("[^>]*><title>)([^<:]+):\s*\d+(<\/title><\/path>)/g,
    (_match, pathStart: string, titleStart: string, boundaryName: string, pathEnd: string) => {
      const count = countsByBoundaryName.get(boundaryName.toLowerCase()) ?? 0;
      return `${pathStart}${gsakMapColor(count)}${titleStart}${escapeHtml(boundaryName)}: ${count}${pathEnd}`;
    }
  );
  const svgOpenTag = /<svg\b[^>]*>/i.exec(coloredTemplate);
  const svgCloseIndex = coloredTemplate.lastIndexOf("</svg>");
  if (!svgOpenTag || svgCloseIndex < svgOpenTag.index + svgOpenTag[0].length) {
    throw new Error("Invalid world map SVG template");
  }
  const mapContents = coloredTemplate.slice(svgOpenTag.index + svgOpenTag[0].length, svgCloseIndex);
  const username = profile.gcUsername;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="455" viewBox="0 0 750 455" role="img" aria-label="${escapeHtml(username)} scratch map">
  <rect width="750" height="455" fill="#dedeee"/>
  <text x="375" y="28" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="20" font-weight="bold" fill="#000">${escapeHtml(username)} Scratch Map</text>
  <text x="375" y="47" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11" font-style="italic" fill="#222">${formatNumber(stats?.totalFinds)} finds in ${formatNumber(countries.length)} countries</text>
  <svg x="15" y="55" width="720" height="360" viewBox="0 0 720 360">${mapContents}</svg>
  <g font-family="Verdana,Arial,sans-serif">${staticMapLegend()}</g>
</svg>`;
}

function mapLegend() {
  const steps = [
    ["#fff1a8", "1"],
    ["#a7e163", "2-9"],
    ["#41c86a", "10-24"],
    ["#22b8a6", "25-49"],
    ["#1693c7", "50-74"],
    ["#2563eb", "75-99"],
    ["#7c3aed", "100-249"],
    ["#db2777", "250-499"],
    ["#ea580c", "500-999"],
    ["#b91c1c", "1000+"]
  ];
  return `<div class="gsak-map-legend">
    ${steps.map(([color, label]) => `<span><i style="background:${color};"></i>${label}</span>`).join("")}
  </div>`;
}

function continentCountryTable(countries: CountBucket[]) {
  if (!countries.length) {
    return "";
  }
  const cells = countries
    .slice(0, 30)
    .map((country) => `<td>- ${escapeHtml(country.key)}: ${formatNumber(country.count)}</td>`);
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 3) {
    rows.push(`<tr>${cells.slice(index, index + 3).join("")}</tr>`);
  }
  return `<b>Top Countries</b><table class="gsak-map-country-table">${rows.join("")}</table>`;
}

function gsakMapsTab(username: string, stats: any) {
  const countries = (stats?.countries ?? []) as CountBucket[];
  const countriesByContinent = new Map<string, CountBucket[]>();
  for (const country of countries) {
    const continent = continentForCountry(country.key);
    if (continent === "Other") {
      continue;
    }
    countriesByContinent.set(continent, [...(countriesByContinent.get(continent) ?? []), country]);
  }
  const continentPanels = [...countriesByContinent.entries()]
    .sort(([left], [right]) => (continentViews[left]?.order ?? 99) - (continentViews[right]?.order ?? 99))
    .map(([continent, continentCountries]) => {
      const totalFinds = continentCountries.reduce((sum, country) => sum + country.count, 0);
      const max = Math.max(0, ...continentCountries.map((country) => country.count));
      return `<div class="gsak-map-panel">
        ${sectionHead(`${continent} - ${formatNumber(totalFinds)} finds in ${formatNumber(continentCountries.length)} countries`)}
        ${topLocationList(continentCountries, max, totalFinds)}
      </div>`;
    });

  return `<div class="gsak-maps">
    <div class="gsak-map-panel">
      ${sectionHead(`World - ${formatNumber(stats?.totalFinds)} finds in ${formatNumber(countries.length)} countries`)}
      <img class="gsak-static-map" src="/public/profile-scratch-map-image/${escapeHtml(encodeURIComponent(username))}" alt="${escapeHtml(username)} scratch map">
      ${mapLegend()}
      ${continentCountryTable(countries)}
    </div>
    ${continentPanels.join("")}
  </div>`;
}

function twoCol(left: string, right: string) {
  return `<table border="0" style="font-size:12px; margin:0 auto;"><tr>
    <td valign="top" align="center" style="width:371px;">${left}</td>
    <td valign="top" align="center" style="width:371px;">${right}</td>
  </tr></table>`;
}

function metricTable(rows: Array<[string, string]>, width = 371) {
  return `<table border="0" summary="" width="${width}" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
    ${rows
      .map(
        ([label, value], index) => `<tr>
      <td style="background:${index === 0 ? "#AAAAAF" : "#CCCCD4"}; color:black; ${index === 0 ? "font-weight:bold;" : ""}">${escapeHtml(label)}</td>
      <td style="background:#BABADD; color:black; text-align:right; font-weight:bold;">${value}</td>
    </tr>`
      )
      .join("")}
  </table>`;
}

function percentRows(title: string, buckets: PercentBucket[] = [], limit = 12) {
  const rows = buckets.slice(0, limit);
  if (!rows.length) {
    return "";
  }
  const max = Math.max(1, ...rows.map((row) => row.count));
  return `${sectionHead(title, 370)}
    <table border="0" summary="" width="371" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      <tr>
        <td style="background:#C8C8DD;">&nbsp;</td>
        <td style="background:#C8C8DD;"><b> Number </b></td>
        <td style="background:#C8C8DD;"><b> Percent </b></td>
        <td style="background:#C8C8DD;">&nbsp;</td>
      </tr>
      ${rows
        .map((row, index) => {
          const width = Math.max(1, Math.round((row.count / max) * 120));
          return `<tr>
            <td style="background:${index === 0 ? "#AAAAAF" : "#CCCCD4"}; ${index === 0 ? "font-weight:bold;" : ""}">${escapeHtml(row.key)}</td>
            <td style="background:#BABADD; text-align:right; ${index === 0 ? "font-weight:bold;" : ""}">${formatNumber(row.count)}</td>
            <td style="background:#BABADD; text-align:right; ${index === 0 ? "font-weight:bold;" : ""}">${formatPercent(row.percent)}</td>
            <td style="background:#BABADD; width:120px;"><span title="${formatNumber(row.count)}" style="display:block; width:${width}px; height:15px; background:${index === 0 ? "#d23737" : "#4988bd"};"></span></td>
          </tr>`;
        })
        .join("")}
    </table><br><br>`;
}

function bucketRows(title: string, buckets: CountBucket[] = [], limit = 12) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const percentBuckets = buckets.map((bucket) => ({
    ...bucket,
    percent: total > 0 ? (bucket.count / total) * 100 : 0
  }));
  return percentRows(title, percentBuckets, limit);
}

function overviewTable(stats: any) {
  const summary = stats?.summaryNumbers ?? {};
  return `${sectionHead("Statistics Summary")}
    <table width="740" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      ${[
        ["Total finds", `<b>${formatNumber(stats?.totalFinds)}</b>`],
        ["Caching days", `${formatNumber(summary.cachingDays)} of ${formatNumber(summary.totalDays)} total days`],
        ["Average finds per caching day", formatNumber(summary.findsPerCachingDay, 2)],
        ["Overall finds per day", formatNumber(summary.findsPerDay, 2)],
        ["Average finds per week", formatNumber(summary.findsPerWeek, 2)],
        ["Average finds per month", formatNumber(summary.findsPerMonth, 2)],
        ["Most finds in a day", summary.bestDay ? `${formatNumber(summary.bestDay.count)} on ${escapeHtml(summary.bestDay.key)}` : "-"],
        ["Most finds in a calendar month", summary.bestMonth ? `${formatNumber(summary.bestMonth.count)} in ${escapeHtml(summary.bestMonth.key)}` : "-"],
        ["Longest streak", `${formatNumber(stats?.streaks?.longest)} days`],
        ["Countries cached in", formatNumber(stats?.countries?.length)]
      ]
        .map(
          ([label, value], index) => `<tr>
          <td style="background:${index % 2 === 0 ? "#CCCCD4" : "#C8C8DD"}; width:42%;"><b>${escapeHtml(label)}</b></td>
          <td style="background:#BABADD;">${value}</td>
        </tr>`
        )
        .join("")}
    </table><br><br>`;
}

function cumulativeChart(stats: any) {
  const cumulative = (stats?.cumulativeFindsByMonth ?? []) as CountBucket[];
  if (!cumulative.length) {
    return "";
  }
  const max = Math.max(1, ...cumulative.map((bucket) => bucket.count));
  const points = cumulative
    .map((bucket, index) => {
      const x = 40 + (index / Math.max(1, cumulative.length - 1)) * 660;
      const y = 220 - (bucket.count / max) * 180;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const yearTotals = new Map<string, number>();
  for (const bucket of stats?.findsByYear ?? []) {
    yearTotals.set(bucket.key, bucket.count);
  }
  const bars = [...yearTotals.entries()]
    .slice(-10)
    .map(([year, count], index, entries) => {
      const barWidth = Math.max(20, 620 / Math.max(1, entries.length));
      const height = (count / Math.max(1, ...entries.map(([, value]) => value))) * 120;
      const x = 62 + index * barWidth;
      return `<rect x="${x}" y="${220 - height}" width="${Math.max(10, barWidth - 8)}" height="${height}" fill="#ff5555" opacity="0.55"/><text x="${x + barWidth / 2}" y="238" text-anchor="middle" font-size="10" fill="#111">${escapeHtml(year)}</text>`;
    })
    .join("");
  return `${sectionHead("Cumulative Finds by Month")}
    <div style="width:740px; max-width:100%; margin:0 auto 18px; background:#ffffff; border:1px solid #888; text-align:center;">
      <svg width="720" height="250" viewBox="0 0 720 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cumulative finds by month">
        <rect width="720" height="250" fill="#fff"/>
        <line x1="40" y1="220" x2="705" y2="220" stroke="#222"/>
        <line x1="40" y1="30" x2="40" y2="220" stroke="#222"/>
        ${bars}
        <polyline points="${points}" fill="none" stroke="#0000ff" stroke-width="3"/>
        <text x="55" y="52" font-size="12" fill="#0000ff">Cumulative Total</text>
        <text x="55" y="68" font-size="12" fill="#ff0000">Annual Totals</text>
      </svg>
    </div><br>`;
}

function monthTable(stats: any) {
  const findsByMonth = (stats?.findsByMonth ?? []) as CountBucket[];
  if (!findsByMonth.length) {
    return "";
  }
  const years = [...new Set(findsByMonth.map((bucket) => bucket.key.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const counts = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
  const daysByMonth = new Map<string, number>();
  for (const day of stats?.findsByDay ?? []) {
    const key = String(day.key).slice(0, 7);
    daysByMonth.set(key, (daysByMonth.get(key) ?? 0) + 1);
  }
  const max = Math.max(1, ...findsByMonth.map((bucket) => bucket.count));
  return `${sectionHead("Finds by Month")}
    ${years
      .map((year) => {
        const months = monthLabels.map((_, index) => {
          const key = `${year}-${String(index + 1).padStart(2, "0")}`;
          return { key, finds: counts.get(key) ?? 0, days: daysByMonth.get(key) ?? 0 };
        });
        const total = months.reduce((sum, month) => sum + month.finds, 0);
        const days = months.reduce((sum, month) => sum + month.days, 0);
        return `<div id="${year}" style="display:block;">
          <table border="0" style="font-size:12px; border-collapse:separate; border-spacing:1px; margin:0 auto 12px;">
            <tr><td style="background:#C8C8DD;" align="center" colspan="14"><b>${year}</b></td></tr>
            <tr align="center" valign="bottom" style="font-family:Arial Narrow, Arial, sans-serif; font-size:10px; color:black; text-align:center;">
              <td style="height:92px">&nbsp;</td>
              ${months
                .map((month) => {
                  if (!month.finds) {
                    return `<td style="width:25px; vertical-align:bottom;"></td>`;
                  }
                  const height = Math.max(4, Math.round((month.finds / max) * 80));
                  const color = month.finds > max * 0.66 ? "#d23737" : month.finds > max * 0.33 ? "#c8bd00" : "#3b9b3b";
                  return `<td style="width:25px; vertical-align:bottom;">${month.finds}<br><span title="${month.finds}" style="display:inline-block; width:25px; height:${height}px; background:${color};"></span></td>`;
                })
                .join("")}
              <td rowspan="4" valign="bottom">${metricTable(
                [
                  ["Total finds", formatNumber(total)],
                  ["Days caching", formatNumber(days)],
                  ["Average finds per caching day", days ? formatNumber(total / days, 1) : "0.0"],
                  ["Average finds per month", formatNumber(total / Math.max(1, months.filter((month) => month.finds).length), 1)]
                ],
                240
              )}</td>
            </tr>
            <tr style="background:#CCCCCF; font-size:10px; text-align:center;">
              <td style="text-align:left; height:14px;">Month:</td>${monthLabels.map((month) => `<td>${month}</td>`).join("")}
            </tr>
            <tr style="background:#CCCCCF; font-size:10px; text-align:center;">
              <td style="text-align:left; height:14px;">Days caching:</td>${months.map((month) => `<td>${month.days || "&nbsp;"}</td>`).join("")}
            </tr>
          </table><br>
        </div>`;
      })
      .join("")}<br>`;
}

function milestoneTable(milestones: Array<{ count: number; date: string; intervalDays?: number | null; gcCode: string; name: string }> = []) {
  const rows = milestones.slice(-12);
  if (!rows.length) {
    return "";
  }
  return `${sectionHead("Milestones")}
    <table width="740" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      <tr>
        <td style="background:#C8C8DD;"><b>Milestone</b></td>
        <td style="background:#C8C8DD;"><b>Date</b></td>
        <td style="background:#C8C8DD;"><b>Interval</b></td>
        <td style="background:#C8C8DD;"><b>Code</b></td>
        <td style="background:#C8C8DD;"><b>Cache Name</b></td>
      </tr>
      ${rows
        .map(
          (row) => `<tr>
        <td style="background:#CCCCD4;"><b>${formatNumber(row.count)}</b></td>
        <td style="background:#BABADD;">${escapeHtml(dateDots(row.date))}</td>
        <td style="background:#BABADD;">${row.intervalDays == null ? "" : `${formatNumber(row.intervalDays)} days`}</td>
        <td style="background:#BABADD;"><a href="https://coord.info/${escapeHtml(row.gcCode)}">${escapeHtml(row.gcCode)}</a></td>
        <td style="background:#CCCCD4;">${escapeHtml(row.name)}</td>
      </tr>`
        )
        .join("")}
    </table><br><br>`;
}

function dtColor(count: number, max: number) {
  if (!count) {
    return "#BABADD";
  }
  const ratio = count / Math.max(1, max);
  if (ratio > 0.8) return "#B00000";
  if (ratio > 0.5) return "#C89200";
  if (ratio > 0.25) return "#A4C800";
  return "#14C800";
}

function dtTable(cells: Array<{ difficulty: number; terrain: number; count: number }> = []) {
  if (!cells.length) {
    return "";
  }
  const counts = new Map(cells.map((cell) => [`${cell.difficulty}/${cell.terrain}`, cell.count]));
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  const foundCombos = cells.filter((cell) => cell.count > 0).length;
  const highRated = cells
    .filter((cell) => cell.difficulty >= 3 || cell.terrain >= 3)
    .reduce((sum, cell) => sum + cell.count, 0);
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const cell of cells) {
    rowTotals.set(String(cell.difficulty), (rowTotals.get(String(cell.difficulty)) ?? 0) + cell.count);
    colTotals.set(String(cell.terrain), (colTotals.get(String(cell.terrain)) ?? 0) + cell.count);
  }
  return `${sectionHead("Difficulty / Terrain Chart")}
    <table width="740" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      <tr><td style="background:#C8C8DD;"></td><td style="background:#C8C8DD;" colspan="10" align="center"><b>Terrain</b></td></tr>
      <tr><td style="background:#C8C8DD;" rowspan="10" width="91" valign="middle" align="center"><b>Difficulty</b></td>
        <td style="background:#CCCCD4;"></td>${ratingValues.map((value) => `<td style="background:#CCCCD4;" width="59" align="center"><b>${value}</b></td>`).join("")}<td width="59"></td>
      </tr>
      ${ratingValues
        .map((difficulty) => `<tr><td style="background:#CCCCD4;"><b> ${difficulty}</b></td>
          ${ratingValues
            .map((terrain) => {
              const count = counts.get(`${Number(difficulty)}/${Number(terrain)}`) ?? 0;
              return `<td style="background:${dtColor(count, max)}; color:${count ? "#FFFFFF" : "#111111"};" width="59" align="center">${count ? (count === max ? `<b>${count}</b>` : count) : " "}</td>`;
            })
            .join("")}
          <td style="background:#C8C8DD;" width="59" align="center"><i>${rowTotals.get(String(Number(difficulty))) ?? ""}</i></td>
        </tr>`)
        .join("")}
      <tr><td></td><td></td>${ratingValues.map((terrain) => `<td style="background:#C8C8DD;" width="59" align="center"><i>${colTotals.get(String(Number(terrain))) ?? ""}</i></td>`).join("")}</tr>
    </table>
    <br><i><b>${foundCombos}</b> Diff/Terr combinations found, out of <b>81</b><br><b>${formatNumber(highRated)}</b> (${formatPercent(total ? (highRated / total) * 100 : 0)}) finds were rated with Diff or Terr of 3 or greater</i>
    <br><br>`;
}

function ftfTable(username: string, ftf: any) {
  if (!ftf) {
    return "";
  }
  const title = `${username} has ${formatNumber(ftf.total)} FTFs (${formatPercent(ftf.percentOfFinds)}) - Average Distance ${ftf.averageDistanceKm == null ? "-" : `${formatNumber(ftf.averageDistanceKm, 1)} km`}, Average Interval ${ftf.averageIntervalDays == null ? "-" : `${formatNumber(ftf.averageIntervalDays, 0)} days`}`;
  const rows = [ftf.first, ftf.latest, ftf.slowest, ftf.nearest, ftf.furthest].filter(Boolean);
  return `${sectionHead(title)}
    <table width="740" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      <tr>
        <td style="background:#C8C8DD;"><b>Label</b></td>
        <td style="background:#C8C8DD;"><b>Date</b></td>
        <td style="background:#C8C8DD;"><b>Interval</b></td>
        <td style="background:#C8C8DD;"><b>Code</b></td>
        <td style="background:#C8C8DD;"><b>Cache Name</b></td>
      </tr>
      ${rows
        .map((row: any, index: number) => `<tr>
          <td style="background:#CCCCD4;"><b>${["First", "Latest", "Slowest", "Nearest", "Furthest"][index] ?? "FTF"}</b></td>
          <td style="background:#BABADD;">${escapeHtml(dateDots(row.date))}</td>
          <td style="background:#BABADD;">${row.intervalDays == null ? "" : `${formatNumber(row.intervalDays)} days`}</td>
          <td style="background:#BABADD;"><a href="https://coord.info/${escapeHtml(row.gcCode)}">${escapeHtml(row.gcCode)}</a></td>
          <td style="background:#CCCCD4;">${escapeHtml(row.name)}</td>
        </tr>`)
        .join("")}
    </table><br><br>`;
}

function ownedCachesTable(username: string, hides: any) {
  if (!hides?.totalHides) {
    return "";
  }
  const finderCountryRows = (hides.finderCountryBuckets ?? []) as PercentBucket[];
  const finderCountries = finderCountryRows.some((row) => row.key !== "Unknown" && row.count > 0)
    ? percentRows("Finders by Country", finderCountryRows, 12)
    : "";
  return `${sectionHead("Owned Caches Statistics")}
    <table width="740" style="text-align:left; font-size:12px; border-collapse:separate; border-spacing:1px;">
      ${[
        ["Owned", `${formatNumber(hides.totalHides)}, ${formatNumber(hides.archivedHides)} archived`],
        ["Total finds of my caches", formatNumber(hides.totalReceivedLogs)],
        ["Total unique finders of my caches", formatNumber(hides.totalUniqueFinders)],
        ["Total favorite points received", formatNumber(hides.totalFavoritePoints)],
        ["Average logs per hide", formatNumber(hides.averageLogsPerHide, 1)]
      ]
        .map(
          ([label, value]) => `<tr>
          <td style="background:#CCCCD4;"><b>${escapeHtml(label)}</b></td>
          <td style="background:#BABADD;">${escapeHtml(value)}</td>
        </tr>`
        )
        .join("")}
    </table><br><br>
    ${finderCountries}
    ${bucketRows(`Finders of My Caches (${escapeHtml(username)})`, hides.finderBuckets ?? [], 12)}`;
}

export function renderPublicProfileHtml(profile: { gcUsername: string }, stats: any) {
  const username = profile.gcUsername;
  const mapsTab = gsakMapsTab(username, stats);
  const statsTab = `
    ${overviewTable(stats)}
    ${cumulativeChart(stats)}
    ${monthTable(stats)}
    ${milestoneTable(stats?.milestones ?? [])}
    ${twoCol(percentRows("Finds by Type", stats?.cacheTypes ?? [], 12), percentRows("Finds by Container", stats?.sizes ?? [], 12))}
    ${twoCol(percentRows("Finds by Difficulty Rating", stats?.findsByDifficulty ?? [], 12), percentRows("Finds by Terrain Rating", stats?.findsByTerrain ?? [], 12))}
    ${ftfTable(username, stats?.ftfStats)}
    ${ownedCachesTable(username, stats?.hideStats)}
    ${dtTable(stats?.difficultyTerrain ?? [])}
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${PUBLIC_PROFILE_CONTENT_SECURITY_POLICY}">
  <title>${escapeHtml(username)} Geostats Profile Stats</title>
  <style type="text/css">
    table { border-collapse: separate; border-spacing: 1px; }
    .gsak-maps {
      width: 740px;
      max-width: calc(100vw - 24px);
      margin: 0 auto;
      color: #000000;
    }
    .gsak-map-panel {
      margin: 0 auto 24px;
      text-align: left;
    }
    .gsak-static-map {
      display: block;
      width: 750px;
      max-width: 100%;
      margin: 0 auto;
      border: 1px solid #000000;
    }
    .public-scratch-empty {
      margin: 8px auto 20px;
      color: #555555;
    }
    .public-scratch-tile {
      display: flex;
      justify-content: space-between;
      width: 620px;
      max-width: calc(100% - 16px);
      box-sizing: border-box;
      margin: 2px auto;
      padding: 5px 8px;
      background: var(--scratch-color);
      border: 1px solid #777777;
    }
    .gsak-map-legend {
      width: 620px;
      max-width: 100%;
      margin: 5px auto 8px;
      font-size: 11px;
      line-height: 18px;
      text-align: left;
    }
    .gsak-map-legend span {
      display: inline-block;
      margin-right: 10px;
      white-space: nowrap;
    }
    .gsak-map-legend i {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 3px;
      border: 1px solid #000000;
      vertical-align: -1px;
    }
    .gsak-map-country-table {
      width: 620px;
      max-width: 100%;
      margin: 6px auto 0;
      font-size: 12px;
      text-align: left;
    }
    .gsak-map-country-table td {
      width: 33%;
      white-space: nowrap;
    }
    summary {
      cursor: pointer;
      font-size: 120%;
      font-weight: bold;
      margin: 8px;
    }
  </style>
</head>
<body style="margin:0; background:#ffffff;">
  <div id="gsakstats" align="center" style="background:#dedeee; font-family:Verdana, Arial, sans-serif; font-size:12px; color:black; overflow-x:hidden; margin:1px; border:outset; line-height:normal; padding:12px 0;">
    <a name="top"></a>
    <div style="font-family:Tahoma, Arial, sans-serif; font-size:16px; font-weight:bold;">
      ${escapeHtml(username)} has ${formatNumber(stats?.totalFinds)} Finds
    </div>
    <br>
    <i>Statistics generated on ${generatedDateForStats(stats)}</i>
    <div align="center"><br><br>
      <details open><summary>Project-GC Maps</summary><div><br>${mapsTab}</div></details>
      <details><summary>Stats</summary><div><br>${statsTab}</div></details>
    </div>
    <br><br>
    <span style="font-size:11px;">Stats generated dynamically by Geostats in a GSAK-style layout</span>
  </div>
</body>
</html>`;
}

type SvgLine = { kind: "title" | "header" | "row" | "small" | "bar"; left: string; right?: string; count?: number; max?: number };

function svgText(value: unknown) {
  return escapeHtml(value).replace(/\r?\n/g, " ");
}

function pushHeader(lines: SvgLine[], text: string) {
  lines.push({ kind: "header", left: text });
}

function pushRows(lines: SvgLine[], rows: Array<[string, string]>, limit = rows.length) {
  for (const [left, right] of rows.slice(0, limit)) {
    lines.push({ kind: "row", left, right });
  }
}

function pushBucketBars(lines: SvgLine[], title: string, buckets: CountBucket[] = [], limit = 8) {
  const rows = buckets.slice(0, limit);
  if (!rows.length) {
    return;
  }
  pushHeader(lines, title);
  const max = Math.max(1, ...rows.map((row) => row.count));
  for (const row of rows) {
    lines.push({ kind: "bar", left: row.key, right: formatNumber(row.count), count: row.count, max });
  }
}

type ProfileExtremeKind =
  | "northernmost"
  | "easternmost"
  | "southernmost"
  | "westernmost"
  | "highestElevation"
  | "lowestElevation"
  | "oldest";

type ProfileExtreme = {
  gcCode: string;
  name: string;
  country?: string | null;
  region?: string | null;
  hiddenDate?: string | null;
  elevationMeters?: number | null;
  found?: boolean;
};

const profileExtremeCards: Array<{
  kind: ProfileExtremeKind;
  label: string;
  ribbon: string;
  tone: "aqua" | "green" | "blue" | "paper";
}> = [
  {
    kind: "northernmost",
    label: "Northernmost",
    ribbon: "NORTH",
    tone: "aqua"
  },
  { kind: "easternmost", label: "Easternmost", ribbon: "EAST", tone: "aqua" },
  {
    kind: "southernmost",
    label: "Southernmost",
    ribbon: "SOUTH",
    tone: "aqua"
  },
  { kind: "westernmost", label: "Westernmost", ribbon: "WEST", tone: "aqua" },
  {
    kind: "highestElevation",
    label: "Highest altitude",
    ribbon: "HIGHEST",
    tone: "green"
  },
  {
    kind: "lowestElevation",
    label: "Lowest altitude",
    ribbon: "LOWEST",
    tone: "blue"
  },
  { kind: "oldest", label: "Oldest cache", ribbon: "OLDEST", tone: "paper" }
];

function truncateSvgText(value: unknown, length: number) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}…` : text;
}

function profileExtremeDetail(extreme: ProfileExtreme, kind: ProfileExtremeKind) {
  if (kind === "oldest" && extreme.hiddenDate) {
    return `Hidden ${extreme.hiddenDate}`;
  }
  if (extreme.elevationMeters != null && Number.isFinite(Number(extreme.elevationMeters))) {
    return `${Math.round(Number(extreme.elevationMeters))} m`;
  }
  return extreme.country ?? extreme.region ?? extreme.gcCode;
}

function profileExtremeMark(kind: ProfileExtremeKind, centerX: number, centerY: number) {
  if (kind === "northernmost" || kind === "easternmost" || kind === "southernmost" || kind === "westernmost") {
    const letter = {
      northernmost: "N",
      easternmost: "E",
      southernmost: "S",
      westernmost: "W"
    }[kind];
    return `<text x="${centerX}" y="${centerY + 7}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="21" font-weight="700" fill="#053e32">${letter}</text>`;
  }
  if (kind === "highestElevation") {
    return `<g transform="translate(${centerX - 22} ${centerY - 22})" fill="none" stroke="#053e32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 34 17 13l7 11 4-7 11 17"/><path d="M28 12V5m-4 4 4-4 4 4"/></g>`;
  }
  if (kind === "lowestElevation") {
    return `<g transform="translate(${centerX - 22} ${centerY - 22})" fill="none" stroke="#053e32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11c4-3 7-3 11 0s7 3 11 0 7-3 12 0"/><path d="M8 17h28M22 18v19m-7-7 7 7 7-7"/></g>`;
  }
  return `<g transform="translate(${centerX - 22} ${centerY - 22})" fill="none" stroke="#053e32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6h18M13 38h18M15 7c0 9 7 9 7 15s-7 6-7 15M29 7c0 9-7 9-7 15s7 6 7 15"/><path d="M18 13h8M18 32l4-5 4 5"/></g>`;
}

function profileExtremeBadge(
  card: (typeof profileExtremeCards)[number],
  extreme: ProfileExtreme | null,
  centerX: number,
  centerY: number
) {
  const innerGradient = {
    aqua: "extremeInnerAqua",
    green: "extremeInnerGreen",
    blue: "extremeInnerBlue",
    paper: "extremeInnerPaper"
  }[card.tone];
  const ribbonTop = centerY + 28;
  const ribbonBottom = centerY + 45;
  const foundSeal = extreme?.found
    ? `<g aria-label="Found"><circle cx="${centerX + 29}" cy="${centerY + 30}" r="10" fill="#5fbf85" stroke="#111a14" stroke-width="2"/><path d="m${centerX + 24} ${centerY + 30} 3 3 7-7" fill="none" stroke="#07110b" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></g>`
    : "";
  return `<g>
    <circle cx="${centerX}" cy="${centerY}" r="38" fill="url(#extremeRim)" stroke="#f1bd3d" stroke-width="2"/>
    <circle cx="${centerX}" cy="${centerY}" r="33" fill="none" stroke="#ffe494" stroke-opacity="0.32" stroke-width="3"/>
    <circle cx="${centerX}" cy="${centerY}" r="28" fill="none" stroke="#021611" stroke-opacity="0.28" stroke-width="5"/>
    <circle cx="${centerX}" cy="${centerY}" r="23" fill="url(#${innerGradient})" stroke="#053e32" stroke-opacity="0.25"/>
    <circle cx="${centerX + 4}" cy="${centerY + 5}" r="15" fill="none" stroke="#053e32" stroke-opacity="0.08"/>
    <circle cx="${centerX + 4}" cy="${centerY + 5}" r="10" fill="none" stroke="#053e32" stroke-opacity="0.08"/>
    ${profileExtremeMark(card.kind, centerX, centerY)}
    <polygon points="${centerX - 35},${ribbonTop} ${centerX + 35},${ribbonTop} ${centerX + 41},${(ribbonTop + ribbonBottom) / 2} ${centerX + 35},${ribbonBottom} ${centerX - 35},${ribbonBottom} ${centerX - 41},${(ribbonTop + ribbonBottom) / 2}" fill="url(#extremeRibbon)"/>
    <text x="${centerX}" y="${ribbonTop + 12}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="8" font-weight="700" letter-spacing="0.6" fill="#07110b">${card.ribbon}</text>
    ${foundSeal}
  </g>`;
}

export function renderPublicExtremesSvg(
  profile: { gcUsername: string },
  extremes: Partial<Record<ProfileExtremeKind, ProfileExtreme | null>> | null | undefined
) {
  const width = 750;
  const height = 416;
  const directionCards = profileExtremeCards.slice(0, 4);
  const otherCards = profileExtremeCards.slice(4);

  const renderRow = (cards: typeof profileExtremeCards, rowTop: number, columns: number, maxNameLength: number) => {
    const cellWidth = width / columns;
    return cards
      .map((card, index) => {
        const extreme = extremes?.[card.kind] ?? null;
        const centerX = cellWidth * index + cellWidth / 2;
        const centerY = rowTop + 48;
        const name = extreme ? truncateSvgText(extreme.name, maxNameLength) : "No known cache";
        const detail = extreme ? profileExtremeDetail(extreme, card.kind) : "";
        const divider =
          index > 0
            ? `<line x1="${cellWidth * index}" y1="${rowTop + 12}" x2="${cellWidth * index}" y2="${rowTop + 156}" stroke="#edf4e8" stroke-opacity="0.07"/>`
            : "";
        return `${divider}${profileExtremeBadge(card, extreme, centerX, centerY)}
          <text x="${centerX}" y="${rowTop + 121}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="0.5" fill="#9faf9f">${card.label.toUpperCase()}</text>
          <text x="${centerX}" y="${rowTop + 140}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="11" font-weight="700" fill="#6bd197">${svgText(name)}</text>
          <text x="${centerX}" y="${rowTop + 158}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="10" fill="#9faf9f">${svgText(detail)}</text>`;
      })
      .join("");
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgText(profile.gcUsername)} extreme caches">
  <title>${svgText(profile.gcUsername)} Extreme Caches</title>
  <defs>
    <linearGradient id="extremeRim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b8064"/><stop offset="1" stop-color="#032e27"/></linearGradient>
    <linearGradient id="extremeInnerAqua" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dff7f1"/><stop offset="1" stop-color="#79cfc9"/></linearGradient>
    <linearGradient id="extremeInnerGreen" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e4f3dd"/><stop offset="1" stop-color="#79c58d"/></linearGradient>
    <linearGradient id="extremeInnerBlue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dbeaf7"/><stop offset="1" stop-color="#7fa8e8"/></linearGradient>
    <linearGradient id="extremeInnerPaper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7efd6"/><stop offset="1" stop-color="#d7b775"/></linearGradient>
    <linearGradient id="extremeRibbon" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff2b7"/><stop offset="1" stop-color="#dfcc71"/></linearGradient>
    <radialGradient id="extremeGlowA" cx="0" cy="0" r="1"><stop stop-color="#28dabf" stop-opacity="0.12"/><stop offset="1" stop-color="#28dabf" stop-opacity="0"/></radialGradient>
    <radialGradient id="extremeGlowB" cx="0" cy="0" r="1"><stop stop-color="#f1a01d" stop-opacity="0.1"/><stop offset="1" stop-color="#f1a01d" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#111a14"/>
  <ellipse cx="64" cy="50" rx="240" ry="170" fill="url(#extremeGlowA)"/>
  <ellipse cx="720" cy="380" rx="220" ry="150" fill="url(#extremeGlowB)"/>
  <rect x="0.5" y="0.5" width="749" height="415" fill="none" stroke="#2d3a31"/>
  <rect x="1" y="1" width="748" height="50" fill="#075f45" fill-opacity="0.28"/>
  <line x1="1" y1="51" x2="749" y2="51" stroke="#2d3a31"/>
  <text x="18" y="31" font-family="Verdana, Arial, sans-serif" font-size="14" font-weight="700" fill="#edf4e8">Extreme caches</text>
  <rect x="659" y="15" width="73" height="23" rx="11.5" fill="none" stroke="#5fbf85" stroke-opacity="0.42"/>
  <text x="695.5" y="30" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="9" font-weight="700" letter-spacing="0.5" fill="#9edbb5">WORLDWIDE</text>
  ${renderRow(directionCards, 52, 4, 25)}
  <line x1="12" y1="222" x2="738" y2="222" stroke="#edf4e8" stroke-opacity="0.07"/>
  ${renderRow(otherCards, 222, 3, 34)}
  <line x1="1" y1="392" x2="749" y2="392" stroke="#2d3a31"/>
  <text x="375" y="407" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="8" letter-spacing="0.8" fill="#789184">GENERATED WITH GEOSTATS</text>
</svg>`;
}

export function renderPublicProfileSvg(profile: { gcUsername: string }, stats: any) {
  const summary = stats?.summaryNumbers ?? {};
  const lines: SvgLine[] = [
    { kind: "title", left: `${profile.gcUsername} has ${formatNumber(stats?.totalFinds)} Finds` },
    { kind: "small", left: `Statistics generated on ${generatedDateForStats(stats)}` }
  ];
  pushHeader(lines, "Statistics Summary");
  pushRows(lines, [
    ["Total finds", formatNumber(stats?.totalFinds)],
    ["Caching days", `${formatNumber(summary.cachingDays)} of ${formatNumber(summary.totalDays)} days`],
    ["Finds per caching day", formatNumber(summary.findsPerCachingDay, 2)],
    ["Best day", summary.bestDay ? `${formatNumber(summary.bestDay.count)} on ${summary.bestDay.key}` : "-"],
    ["Best month", summary.bestMonth ? `${formatNumber(summary.bestMonth.count)} in ${summary.bestMonth.key}` : "-"],
    ["Longest streak", `${formatNumber(stats?.streaks?.longest)} days`]
  ]);
  pushBucketBars(lines, "Finds by Type", stats?.cacheTypes ?? [], 8);
  pushBucketBars(lines, "Countries", stats?.countries ?? [], 8);
  pushBucketBars(lines, "Regions", stats?.regions ?? [], 8);
  if (stats?.ftfStats) {
    pushHeader(lines, "FTF Statistics");
    pushRows(lines, [
      ["FTF finds", `${formatNumber(stats.ftfStats.total)} (${formatPercent(stats.ftfStats.percentOfFinds)})`],
      ["First FTF", stats.ftfStats.first ? `${dateDots(stats.ftfStats.first.date)} ${stats.ftfStats.first.gcCode}` : "-"],
      ["Latest FTF", stats.ftfStats.latest ? `${dateDots(stats.ftfStats.latest.date)} ${stats.ftfStats.latest.gcCode}` : "-"]
    ]);
  }
  if (stats?.hideStats?.totalHides > 0) {
    pushHeader(lines, "Owned Caches Statistics");
    pushRows(lines, [
      ["Owned caches", formatNumber(stats.hideStats.totalHides)],
      ["Received logs", formatNumber(stats.hideStats.totalReceivedLogs)],
      ["Favorite points received", formatNumber(stats.hideStats.totalFavoritePoints)]
    ]);
  }
  lines.push({ kind: "small", left: "Generated dynamically with Geostats" });

  const width = 750;
  const rowHeight = 24;
  const height = 34 + lines.length * rowHeight + 18;
  let y = 28;
  const body = lines
    .map((line) => {
      if (line.kind === "title") {
        const output = `<text x="375" y="${y}" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="18" font-weight="700" fill="#111">${svgText(line.left)}</text>`;
        y += rowHeight;
        return output;
      }
      if (line.kind === "small") {
        const output = `<text x="375" y="${y}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="11" font-style="italic" fill="#333">${svgText(line.left)}</text>`;
        y += rowHeight;
        return output;
      }
      if (line.kind === "header") {
        const output = `<rect x="5" y="${y - 15}" width="740" height="20" fill="#666699" stroke="#000"/><text x="375" y="${y}" text-anchor="middle" font-family="Verdana, Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">${svgText(line.left)}</text>`;
        y += rowHeight;
        return output;
      }
      if (line.kind === "bar") {
        const barWidth = Math.max(1, Math.round(((line.count ?? 0) / Math.max(1, line.max ?? 1)) * 180));
        const output = `<rect x="5" y="${y - 16}" width="740" height="22" fill="#fff" stroke="#c8c8dd"/><rect x="5" y="${y - 16}" width="260" height="22" fill="#CCCCD4" stroke="#c8c8dd"/><rect x="560" y="${y - 13}" width="${barWidth}" height="15" fill="${barWidth > 120 ? "#d23737" : "#4988bd"}"/><text x="15" y="${y}" font-family="Verdana, Arial, sans-serif" font-size="12" font-weight="700" fill="#111">${svgText(line.left).slice(0, 38)}</text><text x="545" y="${y}" text-anchor="end" font-family="Verdana, Arial, sans-serif" font-size="12" fill="#111">${svgText(line.right ?? "")}</text>`;
        y += rowHeight;
        return output;
      }
      const output = `<rect x="5" y="${y - 16}" width="740" height="22" fill="#BABADD" stroke="#c8c8dd"/><rect x="5" y="${y - 16}" width="260" height="22" fill="#CCCCD4" stroke="#c8c8dd"/><text x="15" y="${y}" font-family="Verdana, Arial, sans-serif" font-size="12" font-weight="700" fill="#111">${svgText(line.left).slice(0, 38)}</text><text x="735" y="${y}" text-anchor="end" font-family="Verdana, Arial, sans-serif" font-size="12" fill="#111">${svgText(line.right ?? "").slice(0, 58)}</text>`;
      y += rowHeight;
      return output;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="750" height="${height}" fill="#dedeee"/>
  <rect x="1" y="1" width="748" height="${height - 2}" fill="none" stroke="#777"/>
  ${body}
</svg>`;
}
