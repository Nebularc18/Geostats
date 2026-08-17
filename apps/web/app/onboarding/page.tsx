"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { defaultTimeZone, parseOptionalNumber, supportedTimeZones } from "../../lib/profile";

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [portableFile, setPortableFile] = useState<File | null>(null);
  const [ready, setReady] = useState(false);
  const timeZoneOptions = useMemo(() => supportedTimeZones(defaultTimeZone), []);

  useEffect(() => {
    let active = true;

    void apiFetch<{ profile: any }>("/profile")
      .then((data) => {
        if (!active) {
          return;
        }
        if (data.profile) {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          router.replace("/login");
        }
      });

    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      await apiFetch<{ profile: any }>("/profile", {
        method: "PUT",
        body: JSON.stringify({
          gcUsername: form.get("gcUsername"),
          homeLatitude: parseOptionalNumber(form.get("homeLatitude")),
          homeLongitude: parseOptionalNumber(form.get("homeLongitude")),
          timeZone: form.get("timeZone") || defaultTimeZone
        })
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
      setLoading(false);
    }
  }

  function selectPortableFile(event: ChangeEvent<HTMLInputElement>) {
    setPortableFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function importAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portableFile) return;

    setImporting(true);
    setError(null);
    try {
      const upload = new FormData();
      upload.append("file", portableFile);
      await apiFetch("/portability/import", { method: "POST", body: upload });
      const { profile } = await apiFetch<{ profile: any }>("/profile");
      if (!profile) {
        throw new Error("The import completed, but this export did not contain a profile. Set up your profile below to continue.");
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import account data");
      setImporting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Profile setup</p>
          <h1>Set up Geostats</h1>
          <p className="muted">Set up a new profile, or restore an existing Geostats export to continue with your saved data.</p>
        </div>
        {ready ? (
          <div className="onboarding-options">
            <form onSubmit={importAccount} className="form onboarding-import-form">
              <div>
                <strong>Import existing data</strong>
                <p className="muted">Choose a Geostats JSON export to restore its profile, finds, hides, statistics, and mystery workspaces.</p>
              </div>
              <label>
                <span className="field-label">Geostats export file</span>
                <input type="file" accept="application/json,.json" onChange={selectPortableFile} />
              </label>
              <button className="secondary-button" disabled={!portableFile || importing || loading} type="submit">
                <UploadCloud aria-hidden="true" size={18} />
                {importing ? "Importing..." : "Import and continue"}
              </button>
            </form>
            <p className="auth-separator">or create a new profile</p>
            <form onSubmit={submit} className="form">
              <label>
                <span className="field-label">
                  Geocaching username
                  <strong>Required</strong>
                </span>
                <input name="gcUsername" required maxLength={60} autoComplete="nickname" />
              </label>
              <label>
                <span className="field-label">
                  Home latitude
                  <em>Optional</em>
                </span>
                <input name="homeLatitude" type="number" step="0.000001" min="-90" max="90" />
              </label>
              <label>
                <span className="field-label">
                  Home longitude
                  <em>Optional</em>
                </span>
                <input name="homeLongitude" type="number" step="0.000001" min="-180" max="180" />
              </label>
              <label>
                <span className="field-label">
                  Time zone
                  <strong>Required</strong>
                </span>
                <select name="timeZone" required defaultValue={defaultTimeZone}>
                  {timeZoneOptions.map((timeZone) => (
                    <option key={timeZone} value={timeZone}>
                      {timeZone}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={loading || importing} type="submit">
                {loading ? "Saving..." : "Save profile"}
              </button>
            </form>
            {error ? <p className="error">{error}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
