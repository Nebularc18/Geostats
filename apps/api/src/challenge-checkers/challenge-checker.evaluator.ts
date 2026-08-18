export type ChallengeRule =
  | { type: "TOTAL_FINDS"; minimum: number }
  | { type: "CACHE_TYPE"; cacheType: string; minimum: number }
  | { type: "LOCATION"; field: "country" | "region" | "county"; value: string; country?: string; region?: string; minimum: number }
  | { type: "CALENDAR_DAYS"; minimum: number }
  | { type: "DIFFICULTY_TERRAIN"; minimum: number };

export type CheckerFind = {
  foundAt: Date;
  foundDate: Date;
  cache: {
    gcCode: string;
    name: string;
    cacheType: string | null;
    difficulty: unknown;
    terrain: unknown;
    country: string | null;
    region: string | null;
    county: string | null;
    latitude?: unknown;
    longitude?: unknown;
  };
};

export type RuleResult = {
  rule: ChallengeRule;
  passed: boolean;
  current: number;
  required: number;
  label: string;
  detail: string;
  evidence: Array<{ date: string; gcCode: string; name: string }>;
  evidenceLimited: boolean;
};

const MAX_EVIDENCE_ROWS = 500;

function sameText(left: string | null, right: string) {
  return left?.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function loggedCalendarKey(find: CheckerFind) {
  return `${String(find.foundDate.getUTCMonth() + 1).padStart(2, "0")}-${String(find.foundDate.getUTCDate()).padStart(2, "0")}`;
}

function loggedEvidenceDate(find: CheckerFind) {
  return find.foundDate.toISOString().slice(0, 10);
}

function rating(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 && number * 2 === Math.round(number * 2)
    ? number.toFixed(1)
    : null;
}

export function evaluateChallenge(rules: ChallengeRule[], finds: CheckerFind[], options: { locationMatch?: (rule: Extract<ChallengeRule, { type: "LOCATION" }>, find: CheckerFind) => boolean } = {}) {
  const results: RuleResult[] = rules.map((rule) => {
    let current = 0;
    let label = "";
    let matchingFinds: CheckerFind[] = [];
    if (rule.type === "TOTAL_FINDS") {
      current = finds.length;
      matchingFinds = finds;
      label = "Total finds";
    } else if (rule.type === "CACHE_TYPE") {
      matchingFinds = finds.filter((find) => sameText(find.cache.cacheType, rule.cacheType));
      current = matchingFinds.length;
      label = `${rule.cacheType} finds`;
    } else if (rule.type === "LOCATION") {
      matchingFinds = finds.filter((find) => options.locationMatch
        ? options.locationMatch(rule, find)
        : sameText(find.cache[rule.field], rule.value) &&
          (!rule.country || sameText(find.cache.country, rule.country)) &&
          (!rule.region || sameText(find.cache.region, rule.region)));
      current = matchingFinds.length;
      label = `Finds in ${[rule.value, rule.field === "county" ? rule.region : null, rule.field !== "country" ? rule.country : null]
        .filter(Boolean)
        .join(", ")}`;
    } else if (rule.type === "CALENDAR_DAYS") {
      matchingFinds = [...new Map(finds.map((find) => [loggedCalendarKey(find), find])).values()];
      current = matchingFinds.length;
      label = "Calendar days with a find";
    } else {
      const representatives = new Map<string, CheckerFind>();
      for (const find of finds) {
        const difficulty = rating(find.cache.difficulty);
        const terrain = rating(find.cache.terrain);
        if (difficulty && terrain) representatives.set(`${difficulty}/${terrain}`, find);
      }
      matchingFinds = [...representatives.values()];
      current = matchingFinds.length;
      label = "Difficulty/terrain combinations";
    }

    const passed = current >= rule.minimum;
    return {
      rule,
      passed,
      current,
      required: rule.minimum,
      label,
      detail: passed
        ? `${current.toLocaleString()} achieved; ${rule.minimum.toLocaleString()} required.`
        : `${current.toLocaleString()} achieved; ${Math.max(rule.minimum - current, 0).toLocaleString()} more needed.`,
      evidence: matchingFinds.slice(0, MAX_EVIDENCE_ROWS).map((find) => ({
        date: loggedEvidenceDate(find),
        gcCode: find.cache.gcCode,
        name: find.cache.name
      })),
      evidenceLimited: matchingFinds.length > MAX_EVIDENCE_ROWS
    };
  });

  return { passed: results.every((result) => result.passed), rules: results };
}

export function proofText(username: string, name: string, result: ReturnType<typeof evaluateChallenge>) {
  const status = result.passed ? "qualifies" : "does not yet qualify";
  const lines = result.rules.map((item) => `- ${item.label}: ${item.current}/${item.required} ${item.passed ? "✓" : "✗"}`);
  return [`${username} ${status} for “${name}”.`, ...lines, "Checked with Geostats using the user's imported find data."].join("\n");
}
