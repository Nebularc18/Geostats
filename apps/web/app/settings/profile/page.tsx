"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { AppShell } from "../../../components/app-shell";
import { API_URL, apiFetch } from "../../../lib/api";
import { defaultFtfTerms, defaultTimeZone, parseOptionalNumber, supportedTimeZones } from "../../../lib/profile";

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

function powerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function hidesCommand(token: string) {
  return `$env:GEOSTATS_COLLECTOR_TOKEN=${powerShellString(token)}; irm ${powerShellString(`${API_URL}/collector/hides.ps1`)} | iex`;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const selectedTimeZone = profile?.timeZone || defaultTimeZone;
  const timeZoneOptions = useMemo(() => supportedTimeZones(selectedTimeZone), [selectedTimeZone]);

  useEffect(() => {
    void apiFetch<{ profile: any }>("/profile").then((data) => setProfile(data.profile));
    void refreshTokens();
  }, []);

  async function refreshTokens() {
    const data = await apiFetch<{ tokens: any[] }>("/collector/tokens");
    setTokens(data.tokens);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      gcUsername: form.get("gcUsername"),
      homeLatitude: parseOptionalNumber(form.get("homeLatitude")),
      homeLongitude: parseOptionalNumber(form.get("homeLongitude")),
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

  async function createToken() {
    const data = await apiFetch<{ token: string; collectorToken: any }>("/collector/tokens", {
      method: "POST",
      body: JSON.stringify({ name: "Owner logs collector" })
    });
    setCopiedTokenId(null);
    setTokens((current) => [data.collectorToken, ...current]);
  }

  async function deleteToken(id: string) {
    await apiFetch(`/collector/tokens/${id}`, { method: "DELETE" });
    setTokens((current) => current.filter((token) => token.id !== id));
  }

  async function copyCommand(token: any) {
    if (!token.token) {
      return;
    }
    await navigator.clipboard.writeText(hidesCommand(token.token));
    setCopiedTokenId(token.id);
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
            <select key={selectedTimeZone} name="timeZone" required defaultValue={selectedTimeZone}>
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
      <section className="panel narrow">
        <h2>Owner log collector</h2>
        <button className="primary-button" type="button" onClick={createToken}>
          <KeyRound size={18} />
          Create collector token
        </button>
        <div className="table-list">
          {tokens.map((token) => (
            <div key={token.id} className="table-row collector-token-row">
              <div className="collector-token-command">
                <span>{token.name} ({token.tokenPrefix}...)</span>
                {token.token ? (
                  <label>
                    Hides command
                    <textarea readOnly rows={3} value={hidesCommand(token.token)} />
                  </label>
                ) : (
                  <p className="muted">Command unavailable for this older token. Delete it and create a new token once.</p>
                )}
              </div>
              <div className="collector-token-actions">
                {token.token ? (
                  <button className="ghost-button" type="button" onClick={() => copyCommand(token)}>
                    <Copy size={16} />
                    {copiedTokenId === token.id ? "Copied" : "Copy hides command"}
                  </button>
                ) : null}
                <button className="ghost-button" type="button" onClick={() => deleteToken(token.id)} aria-label="Delete token">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
