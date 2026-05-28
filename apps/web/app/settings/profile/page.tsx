"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch } from "../../../lib/api";

const defaultFtfTerms = ["FTF", "first to find"];
const defaultTimeZone = "Europe/Stockholm";
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

function termsText(profile: any) {
  const terms = Array.isArray(profile?.ftfDetectionTerms) ? profile.ftfDetectionTerms : defaultFtfTerms;
  return terms.join("\n");
}

function parseTerms(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function supportedTimeZones(selectedTimeZone: string) {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : fallbackTimeZones;
  return Array.from(new Set(["UTC", defaultTimeZone, selectedTimeZone, ...zones])).sort((a, b) => a.localeCompare(b));
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedTimeZone = profile?.timeZone || defaultTimeZone;
  const timeZoneOptions = useMemo(() => supportedTimeZones(selectedTimeZone), [selectedTimeZone]);

  useEffect(() => {
    void apiFetch<{ profile: any }>("/profile").then((data) => setProfile(data.profile));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      gcUsername: form.get("gcUsername"),
      homeLatitude: form.get("homeLatitude") ? Number(form.get("homeLatitude")) : null,
      homeLongitude: form.get("homeLongitude") ? Number(form.get("homeLongitude")) : null,
      timeZone: form.get("timeZone") || defaultTimeZone,
      ftfDetectionTerms: parseTerms(form.get("ftfDetectionTerms"))
    };
    const data = await apiFetch<{ profile: any }>("/profile", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    setProfile(data.profile);
    setMessage("Profile saved.");
  }

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Per-user ownership</p>
        <h1>Geocaching profile</h1>
      </header>
      <section className="panel narrow">
        <form onSubmit={submit} className="form">
          <label>
            Geocaching username
            <input name="gcUsername" required defaultValue={profile?.gcUsername ?? ""} />
          </label>
          <label>
            Home latitude
            <input name="homeLatitude" type="number" step="0.000001" defaultValue={profile?.homeLatitude ?? ""} />
          </label>
          <label>
            Home longitude
            <input name="homeLongitude" type="number" step="0.000001" defaultValue={profile?.homeLongitude ?? ""} />
          </label>
          <label>
            Time zone
            <select key={selectedTimeZone} name="timeZone" defaultValue={selectedTimeZone}>
              {timeZoneOptions.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
          </label>
          <label>
            FTF auto-detect phrases
            <textarea
              name="ftfDetectionTerms"
              rows={5}
              defaultValue={termsText(profile)}
              placeholder="FTF&#10;first to find"
            />
          </label>
          <p className="muted">
            Put one phrase per line. Future imports will mark a find as FTF when your found-log text contains one of these phrases.
          </p>
          <button className="primary-button" type="submit">
            Save profile
          </button>
          {message ? <p className="muted">{message}</p> : null}
        </form>
      </section>
    </AppShell>
  );
}
