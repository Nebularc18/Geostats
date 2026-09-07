"use client";

import { useEffect, useState } from "react";
import { Check, Clipboard, Download } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { API_URL, apiFetch } from "../../lib/api";

export default function ProfileHtmlPage() {
  const [html, setHtml] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [publicStatsBusy, setPublicStatsBusy] = useState(false);
  const [publicStatsMessage, setPublicStatsMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [htmlResponse, mapResponse, profileData] = await Promise.all([
          fetch(`${API_URL}/stats/html`, { credentials: "include", signal: controller.signal }),
          fetch(`${API_URL}/stats/scratch-map-image`, { credentials: "include", signal: controller.signal }),
          apiFetch<{ profile: any }>("/profile", { signal: controller.signal })
        ]);

        if (!htmlResponse.ok) {
          const body = await htmlResponse.json().catch(() => ({ message: htmlResponse.statusText }));
          throw new Error(body.message ?? "Could not load profile HTML");
        }
        if (!mapResponse.ok) {
          const body = await mapResponse.json().catch(() => ({ message: mapResponse.statusText }));
          throw new Error(body.message ?? "Could not load the profile map");
        }

        const [profileHtml, mapSvg] = await Promise.all([htmlResponse.text(), mapResponse.text()]);
        if (controller.signal.aborted) {
          return;
        }

        const mapDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mapSvg)}`;
        setHtml(
          profileHtml
            .replace("img-src 'self';", "img-src 'self' data:;")
            .replace('src="/stats/scratch-map-image"', `src="${mapDataUrl}"`)
        );
        setProfile(profileData.profile);
        setError(null);
      } catch (cause) {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setError(cause.message);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  const publicUsername = profile?.publicStatsEnabled && profile.gcUsername ? encodeURIComponent(profile.gcUsername) : "";
  const dynamicHtmlUrl = publicUsername ? `${API_URL}/public/profile-stats/${publicUsername}` : "";
  const dynamicImageUrl = publicUsername ? `${API_URL}/public/profile-stats-image/${publicUsername}` : "";
  const dynamicExtremesImageUrl = publicUsername ? `${API_URL}/public/profile-extremes-image/${publicUsername}` : "";
  const dynamicScratchMapImageUrl = publicUsername ? `${API_URL}/public/profile-scratch-map-image/${publicUsername}` : "";
  const embedHtml = dynamicHtmlUrl && dynamicImageUrl && dynamicExtremesImageUrl && dynamicScratchMapImageUrl
    ? `<a href="${dynamicHtmlUrl}" target="_top"><img src="${dynamicImageUrl}" width="750"><br><img src="${dynamicExtremesImageUrl}" width="750"><br><img src="${dynamicScratchMapImageUrl}" width="750"></a>`
    : "";

  async function copyHtml() {
    if (!html) {
      return;
    }
    await navigator.clipboard.writeText(html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function copyEmbedHtml() {
    if (!embedHtml) {
      return;
    }
    await navigator.clipboard.writeText(embedHtml);
    setCopiedEmbed(true);
    window.setTimeout(() => setCopiedEmbed(false), 1800);
  }

  async function setPublicStatsEnabled(enabled: boolean) {
    if (!profile) {
      return;
    }
    setPublicStatsBusy(true);
    setPublicStatsMessage(null);
    try {
      const data = await apiFetch<{ profile: any }>("/profile/public-stats", {
        method: "PUT",
        body: JSON.stringify({ publicStatsEnabled: enabled })
      });
      setProfile(data.profile);
      setPublicStatsMessage(enabled ? "Public profile links are enabled." : "Public profile links are disabled.");
    } catch (cause) {
      setPublicStatsMessage(cause instanceof Error ? cause.message : "Could not update public profile access.");
    } finally {
      setPublicStatsBusy(false);
    }
  }

  function downloadHtml() {
    if (!html) {
      return;
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
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
          <button className="primary-button" type="button" onClick={copyHtml} disabled={!html}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
            {copied ? "Copied" : "Copy HTML"}
          </button>
          <button className="ghost-button inline-action" type="button" onClick={downloadHtml} disabled={!html}>
            <Download size={18} />
            Download
          </button>
        </div>
      </header>

      <section className="panel">
        <p className="muted">The exported HTML uses the same GSAK-style renderer as the Statistics page.</p>
      </section>

      {error ? <p className="stats-html-error">{error}</p> : null}
      {!html && !error ? <p className="stats-html-loading">Loading profile HTML…</p> : null}

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
        <label>
          <input
            type="checkbox"
            checked={profile?.publicStatsEnabled === true}
            disabled={!profile || publicStatsBusy}
            onChange={(event) => void setPublicStatsEnabled(event.target.checked)}
          />
          Publish my statistics at the public links below
        </label>
        <p className="muted">Disabled by default. Turning this off makes every public profile and image URL return not found.</p>
        {publicStatsMessage ? <p className="muted">{publicStatsMessage}</p> : null}
        <textarea
          readOnly
          rows={5}
          value={embedHtml || (profile?.publicStatsEnabled ? "Set your geocaching username in Profile first." : "Enable public statistics to create a dynamic snippet.")}
          aria-label="Dynamic geocaching profile image snippet"
        />
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
            <small className="muted">GSAK-style HTML</small>
          </div>
          <iframe title="Generated geocaching profile preview" srcDoc={html} />
        </div>
      </section>
    </AppShell>
  );
}
