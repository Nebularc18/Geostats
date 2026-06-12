"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { defaultTimeZone, parseOptionalNumber, supportedTimeZones } from "../../lib/profile";

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Profile setup</p>
          <h1>Set up Geostats</h1>
          <p className="muted">Add the required profile details before importing and reviewing your cache statistics.</p>
        </div>
        {ready ? (
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
            {error ? <p className="error">{error}</p> : null}
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? "Saving..." : "Save profile"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
