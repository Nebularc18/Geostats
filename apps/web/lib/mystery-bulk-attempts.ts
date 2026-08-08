import { parseCoordinate } from "@geostats/shared";
import { coordinateIdentityKey } from "./mystery-cache-merge.ts";

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
    ? `coordinate:${coordinateIdentityKey(attempt.latitude, attempt.longitude)}`
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

function csvDelimiter(text: string) {
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === "\t") return "\t";
    if (character === ";") return ";";
    if (character === "\n" || character === "\r") break;
  }
  return ",";
}

function csvRows(text: string) {
  const rows: string[][] = [];
  const delimiter = csvDelimiter(text);
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function decimalCoordinatePart(value: string) {
  const trimmed = value.trim();
  return /^[-+]?\d+,\d+$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
}

function decimalCoordinateText(value: string) {
  return value.replace(/([-+]?\d+),(\d+)/g, "$1.$2");
}

function headerName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

const LATITUDE_HEADERS = new Set(["lat", "latitude", "finallat", "finallatitude", "correctedlat", "correctedlatitude"]);
const LONGITUDE_HEADERS = new Set(["lon", "lng", "long", "longitude", "finallon", "finallongitude", "correctedlon", "correctedlongitude"]);
const COORDINATE_HEADERS = new Set(["coordinate", "coordinates", "coords", "finalcoordinate", "finalcoordinates", "correctedcoordinates"]);

export function parseFailedCoordinateCsv(text: string) {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return { attempts: [] as BulkFailedAttempt[], ignoredRows: 0 };

  const headers = rows[0].map(headerName);
  const latitudeIndex = headers.findIndex((header) => LATITUDE_HEADERS.has(header));
  const longitudeIndex = headers.findIndex((header) => LONGITUDE_HEADERS.has(header));
  const coordinateIndex = headers.findIndex((header) => COORDINATE_HEADERS.has(header));
  const hasHeaders = coordinateIndex >= 0 || (latitudeIndex >= 0 && longitudeIndex >= 0);
  const dataRows = hasHeaders ? rows.slice(1) : rows;
  const attempts: BulkFailedAttempt[] = [];
  const seen = new Set<string>();
  let ignoredRows = 0;

  for (const row of dataRows) {
    let parsed: ReturnType<typeof parseCoordinate> = null;
    if (coordinateIndex >= 0) {
      parsed = parseCoordinate(decimalCoordinateText(row[coordinateIndex] ?? ""));
    } else if (latitudeIndex >= 0 && longitudeIndex >= 0) {
      parsed = parseCoordinate(`${decimalCoordinatePart(row[latitudeIndex] ?? "")}, ${decimalCoordinatePart(row[longitudeIndex] ?? "")}`);
    } else {
      // Headerless CSVs commonly contain latitude and longitude as the first two columns.
      parsed = parseCoordinate(`${decimalCoordinatePart(row[0] ?? "")}, ${decimalCoordinatePart(row[1] ?? "")}`);
      if (!parsed) parsed = row.map((field) => parseCoordinate(decimalCoordinateText(field))).find(Boolean) ?? null;
    }
    if (!parsed) {
      ignoredRows += 1;
      continue;
    }
    const attempt: BulkFailedAttempt = { kind: "coordinate", latitude: parsed.latitude, longitude: parsed.longitude };
    const key = bulkAttemptKey(attempt);
    if (seen.has(key)) continue;
    seen.add(key);
    attempts.push(attempt);
  }

  return { attempts, ignoredRows };
}
