"use client";

export const defaultTimeZone = "Europe/Stockholm";
export const defaultFtfTerms = ["FTF", "first to find"];

const fallbackTimeZones = [
  "UTC",
  defaultTimeZone,
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Copenhagen",
  "Europe/Oslo",
  "Europe/Helsinki",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland"
];

export function supportedTimeZones(selectedTimeZone: string = defaultTimeZone) {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : fallbackTimeZones;
  return Array.from(new Set(["UTC", defaultTimeZone, selectedTimeZone, ...zones])).sort((a, b) => a.localeCompare(b));
}

export function parseOptionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? Number(text) : null;
}
