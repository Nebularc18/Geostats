import { parseCoordinate } from "@geostats/shared";

export type BulkFailedAttempt =
  | { kind: "coordinate"; latitude: number; longitude: number }
  | { kind: "keyword" | "approach"; answer: string };

export type BulkAttemptLike = {
  kind?: "coordinate" | "keyword" | "approach";
  latitude?: number;
  longitude?: number;
  answer?: string;
};

export function bulkAttemptKey(attempt: BulkAttemptLike) {
  const kind = attempt.kind === "keyword" || attempt.kind === "approach" ? attempt.kind : "coordinate";
  return kind === "coordinate"
    ? `coordinate:${Number(attempt.latitude).toFixed(6)}:${Number(attempt.longitude).toFixed(6)}`
    : `${kind}:${attempt.answer?.trim().toLocaleLowerCase() ?? ""}`;
}

export function parseBulkFailedAttempts(text: string) {
  const attempts: BulkFailedAttempt[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim().replace(/^[-*•]\s+/, "");
    if (!line) return;

    const prefix = line.match(/^(keyword|kw|approach|idea|coordinate|coord)\s*(?::|\t)\s*(.+)$/i);
    const prefixKind = prefix?.[1]?.toLocaleLowerCase();
    const value = (prefix?.[2] ?? line).trim();
    const requestedKind = prefixKind === "keyword" || prefixKind === "kw"
      ? "keyword"
      : prefixKind === "approach" || prefixKind === "idea"
        ? "approach"
        : prefixKind === "coordinate" || prefixKind === "coord"
          ? "coordinate"
          : null;

    const parsed = requestedKind === "keyword" || requestedKind === "approach" ? null : parseCoordinate(value);
    if (requestedKind === "coordinate" && !parsed) {
      errors.push(`Line ${index + 1}: invalid coordinate`);
      return;
    }

    const attempt: BulkFailedAttempt = parsed
      ? { kind: "coordinate", latitude: parsed.latitude, longitude: parsed.longitude }
      : { kind: requestedKind === "approach" ? "approach" : "keyword", answer: value };
    const key = bulkAttemptKey(attempt);
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(attempt);
  });

  return { attempts, errors };
}
