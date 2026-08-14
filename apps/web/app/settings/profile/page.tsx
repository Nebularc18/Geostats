"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { FileDown, KeyRound, Trash2, UploadCloud } from "lucide-react";
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

function hidesCsvCommand(token: string) {
  return `$env:GEOSTATS_COLLECTOR_TOKEN=${powerShellString(token)}; $env:GEOSTATS_COLLECTOR_NO_UPLOAD='1'; irm ${powerShellString(`${API_URL}/collector/hides.ps1`)} | iex`;
}

function projectGcCommand(token: string) {
  return `$env:GEOSTATS_COLLECTOR_TOKEN=${powerShellString(token)}; irm ${powerShellString(`${API_URL}/collector/project-gc.ps1`)} | iex`;
}

function aiSolverInstructions(token: string) {
  return [
    `Geostats API: ${API_URL}`,
    `Authorization: Bearer ${token}`,
    "Read workspaces: GET /agent/mysteries",
    "Read one cache: GET /agent/mysteries/GC_CODE",
    "Record work: POST /agent/mysteries/GC_CODE/attempts",
    'JSON: {"kind":"approach","answer":"Try ROT13 on the title","state":"planned","source":"my-ai-job"}',
    "States: planned (not tried), wrong, correct, unchecked. Kinds: approach, keyword, coordinate."
  ].join("\n");
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [projectGcText, setProjectGcText] = useState("");
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const [portableFile, setPortableFile] = useState<File | null>(null);
  const [portabilityBusy, setPortabilityBusy] = useState<"export" | "import" | null>(null);
  const [portabilityMessage, setPortabilityMessage] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
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
      body: JSON.stringify({ name: "Computer access" })
    });
    setCopiedCommandId(null);
    setTokens((current) => [data.collectorToken, ...current]);
  }

  async function deleteToken(id: string) {
    await apiFetch(`/collector/tokens/${id}`, { method: "DELETE" });
    setTokens((current) => current.filter((token) => token.id !== id));
  }

  async function importProjectGcFinderCountries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await apiFetch<{ rows: Array<{ country: string; count: number }> }>("/profile/owner-finder-countries", {
      method: "POST",
      body: JSON.stringify({ text: projectGcText })
    });
    setProjectGcText("");
    setMessage(`Imported ${data.rows.length} finder country rows from Project-GC.`);
  }

  async function copyCommand(token: any, mode: "direct" | "csv" | "project-gc" | "ai-solver") {
    if (!token.token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(
        mode === "csv" ? hidesCsvCommand(token.token) : mode === "project-gc" ? projectGcCommand(token.token) : mode === "ai-solver" ? aiSolverInstructions(token.token) : hidesCommand(token.token)
      );
      setCopiedCommandId(`${token.id}:${mode}`);
      setMessage(null);
    } catch {
      setCopiedCommandId(null);
      setMessage("Could not copy command. Select the command text and copy it manually.");
    }
  }

  async function exportAllData() {
    setPortabilityBusy("export");
    setPortabilityMessage(null);
    try {
      const response = await fetch(`${API_URL}/portability/export`, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `geostats-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPortabilityMessage("Your portable Geostats export was downloaded.");
    } catch (error) {
      setPortabilityMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setPortabilityBusy(null);
    }
  }

  function selectPortableFile(event: ChangeEvent<HTMLInputElement>) {
    setPortableFile(event.target.files?.[0] ?? null);
  }

  async function importAllData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portableFile) return;
    const formElement = event.currentTarget;
    setPortabilityBusy("import");
    setPortabilityMessage(null);
    try {
      const upload = new FormData();
      upload.append("file", portableFile);
      const result = await apiFetch<{ imported: Record<string, number> }>("/portability/import", { method: "POST", body: upload });
      setPortabilityMessage(`Import complete: ${result.imported.finds} finds, ${result.imported.hides} hides, and ${result.imported.mysteryWorkspaces} mysteries processed.`);
      const refreshed = await apiFetch<{ profile: any }>("/profile");
      setProfile(refreshed.profile);
      setPortableFile(null);
      formElement.reset();
    } catch (error) {
      setPortabilityMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setPortabilityBusy(null);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirmation !== "DELETE") return;
    setDeletingAccount(true);
    setPortabilityMessage(null);
    try {
      await apiFetch<{ deleted: true }>("/portability/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: deleteConfirmation })
      });
      for (const key of [
        "geostats-mysteries-v1",
        "geostats-mystery-sync-metadata-v1",
        "geostats-mysteries-backup-before-dedup-v1",
        "geostats-mystery-deletions-v1"
      ]) {
        try {
          localStorage.removeItem(key);
        } catch {
          // The server account is already deleted; continue to signed-out state.
        }
      }
      window.location.assign("/login");
    } catch (error) {
      setPortabilityMessage(error instanceof Error ? error.message : "Account deletion failed.");
      setDeletingAccount(false);
    }
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
            <span className="field-label">
              Geocaching username
              <strong>Required</strong>
            </span>
            <input name="gcUsername" required defaultValue={profile?.gcUsername ?? ""} />
          </label>
          <label>
            <span className="field-label">
              Home latitude
              <em>Optional</em>
            </span>
            <input name="homeLatitude" type="number" step="0.000001" defaultValue={profile?.homeLatitude ?? ""} />
          </label>
          <label>
            <span className="field-label">
              Home longitude
              <em>Optional</em>
            </span>
            <input name="homeLongitude" type="number" step="0.000001" defaultValue={profile?.homeLongitude ?? ""} />
          </label>
          <label>
            <span className="field-label">
              Time zone
              <strong>Required</strong>
            </span>
            <select key={selectedTimeZone} name="timeZone" required defaultValue={selectedTimeZone}>
              {timeZoneOptions.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">
              FTF auto-detect phrases
              <em>Optional</em>
            </span>
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
        <h2>Move or back up all your data</h2>
        <p className="muted">
          Download a portable JSON file containing your profile, finds, hides, cache details, corrected coordinates, statistics, and mystery workspaces. You can import it into any Geostats server while signed in to your destination account.
        </p>
        <button className="primary-button" type="button" disabled={portabilityBusy !== null} onClick={() => void exportAllData()}>
          <FileDown size={18} />
          {portabilityBusy === "export" ? "Preparing export…" : "Export all data"}
        </button>
        <form className="form portability-import-form" onSubmit={importAllData}>
          <label>
            <span className="field-label">Geostats export file</span>
            <input type="file" accept="application/json,.json" onChange={selectPortableFile} />
          </label>
          <p className="muted">
            Import merges records into this account. Matching profile settings, hides, corrected coordinates, and mystery workspaces are updated; unrelated data already on this server stays in place. Passwords, sign-in connections, access tokens, and sharing permissions never leave their original server.
          </p>
          <button className="secondary-button" type="submit" disabled={!portableFile || portabilityBusy !== null}>
            <UploadCloud size={18} />
            {portabilityBusy === "import" ? "Importing…" : "Import all data"}
          </button>
        </form>
        {portabilityMessage ? <p className="muted">{portabilityMessage}</p> : null}
        <form className="form portability-delete-form" onSubmit={deleteAccount}>
          <h3>Delete account and all data</h3>
          <p className="muted">
            This permanently removes your account, imported files, profile, finds, hides, corrected coordinates, statistics, mystery workspaces, access tokens, and sharing relationships. Export first if you may want this data later.
          </p>
          <label>
            <span className="field-label">Type DELETE to confirm</span>
            <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button className="primary-button danger-button" type="submit" disabled={deleteConfirmation !== "DELETE" || deletingAccount}>
            <Trash2 size={18} />
            {deletingAccount ? "Deleting account…" : "Permanently delete account"}
          </button>
        </form>
      </section>
      <section className="panel narrow">
        <h2>Computer access tokens</h2>
        <p className="muted">
          Use a revocable token for owner-log tools or an AI mystery-solving job on another computer. The AI connection can read your synced mystery context and record tried or planned approaches.
        </p>
        <button className="primary-button" type="button" onClick={createToken}>
          <KeyRound size={18} />
          Create computer token
        </button>
        <div className="table-list">
          {tokens.map((token) => (
            <div key={token.id} className="table-row collector-token-row">
              <div className="collector-token-header">
                <span>
                  {token.name} ({token.tokenPrefix}...)
                </span>
                <button className="ghost-button collector-token-delete" type="button" onClick={() => deleteToken(token.id)} aria-label="Delete token">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="collector-token-command">
                {token.token ? (
                  <div className="collector-token-commands">
                    <div className="collector-token-command-card">
                      <div className="collector-command-title">
                        <span>Direct upload command</span>
                        <button className="ghost-button collector-command-action" type="button" onClick={() => copyCommand(token, "direct")}>
                          <UploadCloud size={16} />
                          {copiedCommandId === `${token.id}:direct` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <textarea readOnly rows={3} value={hidesCommand(token.token)} />
                    </div>
                    <div className="collector-token-command-card">
                      <div className="collector-command-title">
                        <span>CSV to Downloads command</span>
                        <button className="ghost-button collector-command-action" type="button" onClick={() => copyCommand(token, "csv")}>
                          <FileDown size={16} />
                          {copiedCommandId === `${token.id}:csv` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <textarea readOnly rows={3} value={hidesCsvCommand(token.token)} />
                    </div>
                    <div className="collector-token-command-card">
                      <div className="collector-command-title">
                        <span>Project-GC country command</span>
                        <button className="ghost-button collector-command-action" type="button" onClick={() => copyCommand(token, "project-gc")}>
                          <UploadCloud size={16} />
                          {copiedCommandId === `${token.id}:project-gc` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <textarea readOnly rows={3} value={projectGcCommand(token.token)} />
                    </div>
                    <div className="collector-token-command-card">
                      <div className="collector-command-title">
                        <span>AI mystery solver connection</span>
                        <button className="ghost-button collector-command-action" type="button" onClick={() => copyCommand(token, "ai-solver")}>
                          <KeyRound size={16} />
                          {copiedCommandId === `${token.id}:ai-solver` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <textarea readOnly rows={8} value={aiSolverInstructions(token.token)} />
                    </div>
                  </div>
                ) : (
                  <p className="muted">Command unavailable for this older token. Delete it and create a new token once.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel narrow">
        <h2>Project-GC finder countries</h2>
        <form className="form" onSubmit={importProjectGcFinderCountries}>
          <label>
            <span className="field-label">
              Finders by country table
              <em>Optional</em>
            </span>
            <textarea
              rows={8}
              value={projectGcText}
              onChange={(event) => setProjectGcText(event.target.value)}
              placeholder={"Finders by country\nCountry Number Percent\n1 - Sweden 18 69.23%\n2 - Germany 5 19.23%"}
            />
          </label>
          <p className="muted">
            Paste the Finders by country rows from Project-GC Profile Stats. These aggregate rows are used only for the Hides finder-country chart.
          </p>
          <button className="primary-button" type="submit">
            <UploadCloud size={18} />
            Import Project-GC countries
          </button>
        </form>
      </section>
    </AppShell>
  );
}
