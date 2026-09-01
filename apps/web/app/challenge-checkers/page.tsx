"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Clipboard, FileUp, Globe2, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/copy-text";

type Rule =
  | { type: "TOTAL_FINDS"; minimum: number }
  | { type: "CACHE_TYPE"; cacheTypeId: string; cacheTypeLabel: string; minimum: number }
  | { type: "LOCATION"; field: "country" | "region" | "county"; value: string; country?: string; region?: string; minimum: number }
  | { type: "CALENDAR_DAYS"; minimum: number }
  | { type: "DIFFICULTY_TERRAIN"; minimum: number }
  | { type: "CACHE_SIZE"; size: string; minimum: number }
  | { type: "FIND_STREAK"; minimum: number }
  | { type: "PLACED_MONTHS"; minimum: number }
  | { type: "MONTH_OF_YEAR"; month: number; minimum: number }
  | { type: "WEEKDAY"; weekday: number; minimum: number }
  | { type: "DIFFICULTY_RATING"; rating: number; minimum: number }
  | { type: "TERRAIN_RATING"; rating: number; minimum: number }
  | { type: "FAVORITE_POINTS"; minimumFavoritePoints: number; minimum: number }
  | { type: "ATTRIBUTE"; attributeId: string; attributeLabel: string; minimum: number }
  | { type: "PROJECT_GC_NUMBER"; minimum: number; filters: Array<Record<string, unknown>>; filterLabel: string };
type Checker = { id: string; name: string; gcCode: string | null; description: string | null; rules: Rule[]; publicSlug: string | null; publishedAt: string | null; updatedAt: string };
type Evidence = { date: string; gcCode: string; name: string };
type Result = { passed: boolean; username: string; checkedAt: string; dataUpdatedAt: string | null; proofText: string; rules: Array<{ label: string; current: number; required: number; passed: boolean; detail: string; evidence: Evidence[]; evidenceLimited: boolean }> };
type LocationCountry = { name: string; regions: Array<{ name: string; counties: string[] }> };
type CacheTypeOption = { id: string; label: string; aliases: string[]; imported: boolean };
type AttributeOption = { id: string; label: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RATINGS = Array.from({ length: 9 }, (_, index) => 1 + index / 2);

function defaultRule(type: Rule["type"]): Rule {
  if (type === "PROJECT_GC_NUMBER") return { type, minimum: 1, filters: [{}], filterLabel: "all finds" };
  if (type === "CACHE_TYPE") return { type, cacheTypeId: "2", cacheTypeLabel: "Traditional Cache", minimum: 100 };
  if (type === "LOCATION") return { type, field: "country", value: "", minimum: 1 };
  if (type === "CALENDAR_DAYS") return { type, minimum: 365 };
  if (type === "DIFFICULTY_TERRAIN") return { type, minimum: 81 };
  if (type === "CACHE_SIZE") return { type, size: "Micro", minimum: 100 };
  if (type === "FIND_STREAK") return { type, minimum: 30 };
  if (type === "PLACED_MONTHS") return { type, minimum: 100 };
  if (type === "MONTH_OF_YEAR") return { type, month: 1, minimum: 100 };
  if (type === "WEEKDAY") return { type, weekday: 1, minimum: 100 };
  if (type === "DIFFICULTY_RATING" || type === "TERRAIN_RATING") return { type, rating: 1, minimum: 100 };
  if (type === "FAVORITE_POINTS") return { type, minimumFavoritePoints: 10, minimum: 1 };
  if (type === "ATTRIBUTE") return { type, attributeId: "", attributeLabel: "Select an attribute", minimum: 1 };
  return { type, minimum: 1000 };
}

export default function ChallengeCheckersPage() {
  const [checkers, setCheckers] = useState<Checker[]>([]);
  const [name, setName] = useState("");
  const [gcCode, setGcCode] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<Rule[]>([defaultRule("TOTAL_FINDS")]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [locationCountries, setLocationCountries] = useState<LocationCountry[]>([]);
  const [cacheTypes, setCacheTypes] = useState<CacheTypeOption[]>([]);
  const [cacheSizes, setCacheSizes] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<AttributeOption[]>([]);
  const [regionCatalogs, setRegionCatalogs] = useState<Record<string, string[]>>({});
  const [countyCatalogs, setCountyCatalogs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountUsername, setAccountUsername] = useState("");
  const [checkerSearch, setCheckerSearch] = useState("");
  const [checkerSort, setCheckerSort] = useState("updated-desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [showProjectGcImport, setShowProjectGcImport] = useState(false);
  const [projectGcScript, setProjectGcScript] = useState("");
  const [projectGcConfig, setProjectGcConfig] = useState('{\n  "limit": 100\n}');
  const [projectGcSummary, setProjectGcSummary] = useState("");
  const formSectionRef = useRef<HTMLElement>(null);

  async function load() {
    const [checkerData, locationData, catalog] = await Promise.all([
      apiFetch<{ checkers: Checker[]; username: string }>("/challenge-checkers"),
      apiFetch<{ countries: LocationCountry[] }>("/challenge-checkers/locations"),
      apiFetch<{ cacheTypes: CacheTypeOption[]; sizes: string[]; attributes: AttributeOption[] }>("/challenge-checkers/catalog")
    ]);
    setCheckers(checkerData.checkers);
    setSelectedIds((current) => new Set([...current].filter((id) => checkerData.checkers.some((checker) => checker.id === id))));
    setAccountUsername(checkerData.username);
    setLocationCountries(locationData.countries);
    setCacheTypes(catalog.cacheTypes);
    setCacheSizes(catalog.sizes);
    setAttributes(catalog.attributes);
  }

  useEffect(() => { void load().catch((cause) => setError(cause.message)); }, []);

  function replaceRule(index: number, rule: Rule) {
    setRules((current) => current.map((item, itemIndex) => itemIndex === index ? rule : item));
  }

  async function loadLocationCatalog(country: string, region?: string) {
    if (!country) return;
    const key = `${country}\u0000${region ?? ""}`;
    if (region ? countyCatalogs[key] : regionCatalogs[country]) return;
    try {
      const query = new URLSearchParams({ country });
      if (region) query.set("region", region);
      const data = await apiFetch<{ regions: string[]; counties: string[] }>(`/challenge-checkers/location-catalog?${query}`);
      if (region) setCountyCatalogs((current) => ({ ...current, [key]: data.counties }));
      else setRegionCatalogs((current) => ({ ...current, [country]: data.regions }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load location choices");
    }
  }

  function resetForm() {
    setName(""); setGcCode(""); setDescription(""); setRules([defaultRule("TOTAL_FINDS")]); setEditingId(null); setProjectGcSummary("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save"); setError("");
    try {
      await apiFetch(editingId ? `/challenge-checkers/${editingId}` : "/challenge-checkers", { method: editingId ? "PATCH" : "POST", body: JSON.stringify({ name, gcCode, description, rules }) });
      if (editingId) setResults((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== editingId)));
      resetForm();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not ${editingId ? "update" : "create"} checker`); }
    finally { setBusy(null); }
  }

  async function importProjectGc() {
    setBusy("project-gc-import"); setError(""); setProjectGcSummary("");
    try {
      const imported = await apiFetch<{ rules: Rule[]; summary: string }>("/challenge-checkers/import-project-gc", {
        method: "POST",
        body: JSON.stringify({ script: projectGcScript, config: projectGcConfig })
      });
      setRules(imported.rules);
      setProjectGcSummary(imported.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the Project-GC script");
    } finally { setBusy(null); }
  }

  function edit(checker: Checker) {
    setEditingId(checker.id);
    setName(checker.name);
    setGcCode(checker.gcCode ?? "");
    setDescription(checker.description ?? "");
    setRules(checker.rules.map((rule) => ({ ...rule })));
    setError("");
    window.requestAnimationFrame(() => formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function run(checker: Checker) {
    setBusy(checker.id); setError("");
    try {
      const result = await apiFetch<Result>(`/challenge-checkers/${checker.id}/run`, { method: "POST" });
      setResults((current) => ({ ...current, [checker.id]: result }));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not run checker"); }
    finally { setBusy(null); }
  }

  async function runMany(targets: Checker[]) {
    if (!targets.length) return;
    setBusy("batch"); setError(""); setBatchProgress({ done: 0, total: targets.length });
    const failures: string[] = [];
    let nextIndex = 0;
    let completed = 0;
    async function worker() {
      while (nextIndex < targets.length) {
        const checker = targets[nextIndex++];
        try {
          const result = await apiFetch<Result>(`/challenge-checkers/${checker.id}/run`, { method: "POST" });
          setResults((current) => ({ ...current, [checker.id]: result }));
        } catch {
          failures.push(checker.gcCode ?? checker.name);
        } finally {
          completed += 1;
          setBatchProgress({ done: completed, total: targets.length });
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
      if (failures.length) setError(`Could not run ${failures.length} checker${failures.length === 1 ? "" : "s"}: ${failures.join(", ")}`);
    } finally {
      setBusy(null); setBatchProgress(null);
    }
  }

  async function publish(checker: Checker) {
    setBusy(checker.id); setError("");
    try {
      await apiFetch(`/challenge-checkers/${checker.id}/publish`, { method: "PATCH", body: JSON.stringify({ published: !checker.publishedAt }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update sharing"); }
    finally { setBusy(null); }
  }

  async function remove(checker: Checker) {
    if (!window.confirm(`Delete “${checker.name}”?`)) return;
    await apiFetch(`/challenge-checkers/${checker.id}`, { method: "DELETE" });
    if (editingId === checker.id) resetForm();
    await load();
  }

  async function copy(value: string, key: string) {
    const success = await copyText(value);
    if (!success) { setError("Could not copy automatically. Select the text and press Ctrl+C."); return; }
    setCopied(key); window.setTimeout(() => setCopied(""), 1600);
  }

  function shareUrl(checker: Checker) { return `${window.location.origin}/challenge/${encodeURIComponent(accountUsername)}/${encodeURIComponent(checker.gcCode!)}`; }

  const visibleCheckers = useMemo(() => {
    const query = checkerSearch.trim().toLocaleLowerCase();
    const filtered = query ? checkers.filter((checker) => [checker.gcCode, checker.name, checker.description].some((value) => value?.toLocaleLowerCase().includes(query))) : [...checkers];
    return filtered.sort((left, right) => {
      if (checkerSort === "name-asc") return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      if (checkerSort === "code-asc") return (left.gcCode ?? "").localeCompare(right.gcCode ?? "", undefined, { sensitivity: "base", numeric: true });
      if (checkerSort === "status") {
        const rank = (checker: Checker) => results[checker.id]?.passed === true ? 0 : results[checker.id]?.passed === false ? 1 : 2;
        return rank(left) - rank(right) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [checkerSearch, checkerSort, checkers, results]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  const selectedCheckers = checkers.filter((checker) => selectedIds.has(checker.id));
  const allVisibleSelected = visibleCheckers.length > 0 && visibleCheckers.every((checker) => selectedIds.has(checker.id));

  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">Proof from your own data</p><h1>Challenge Checkers</h1></div></header>
    <div className="challenge-notice"><strong>Independent checker</strong><span>Geostats can validate and share your imported-data result, but Project-GC remains the checker accepted for newly published challenge caches on Geocaching.com.</span></div>

    <section className="panel" ref={formSectionRef}>
      <div className="challenge-form-heading"><div><h2>{editingId ? "Edit checker" : "Create a checker"}</h2><p className="muted">Build the rules here or translate a supported Project-GC script.</p></div><button className="ghost-button challenge-small-button" type="button" onClick={() => setShowProjectGcImport((current) => !current)}><FileUp size={17} />{showProjectGcImport ? "Close importer" : "Import from Project-GC"}</button></div>
      {showProjectGcImport && <div className="challenge-project-gc-import">
        <div><h3>Import a Project-GC count checker</h3><p className="muted">Paste the Lua checker and its tag config. Geostats translates the <code>c_number</code> rules and does not run the Lua.</p></div>
        <label>Lua script<textarea value={projectGcScript} onChange={(event) => setProjectGcScript(event.target.value)} placeholder="Paste the Project-GC Lua script…" rows={9} /></label>
        <label className="challenge-file-button"><span>Or choose a .lua file</span><input type="file" accept=".lua,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(setProjectGcScript).catch(() => setError("Could not read the Lua file")); }} /></label>
        <label>Project-GC tag config <small>JSON</small><textarea value={projectGcConfig} onChange={(event) => setProjectGcConfig(event.target.value)} rows={6} spellCheck={false} /></label>
        <div className="challenge-actions"><button className="ghost-button challenge-small-button" type="button" disabled={busy !== null || !projectGcScript.trim() || !projectGcConfig.trim()} onClick={() => void importProjectGc()}><FileUp size={17} />{busy === "project-gc-import" ? "Importing…" : "Use imported rules"}</button>{projectGcSummary && <span className="challenge-import-success"><Check size={16} />Imported {projectGcSummary}</span>}</div>
      </div>}
      <form className="form" onSubmit={save}>
        <div className="challenge-form-grid">
          <label>Name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="365-day calendar challenge" /></label>
          <label>Challenge GC code<input required maxLength={20} value={gcCode} onChange={(event) => setGcCode(event.target.value.toUpperCase())} placeholder="GC12345" /></label>
        </div>
        <label>Description <small>Optional note shown on the public result</small><textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="The challenge requirements…" /></label>
        <div className="challenge-rules">
          {rules.map((rule, index) => <div className="challenge-rule" key={index}>
            <label>Rule type<select value={rule.type} onChange={(event) => replaceRule(index, defaultRule(event.target.value as Rule["type"]))}>
              {rule.type === "PROJECT_GC_NUMBER" && <option value="PROJECT_GC_NUMBER">Imported Project-GC count</option>}
              <option value="TOTAL_FINDS">Total finds</option>
              <option value="CACHE_TYPE">Finds by cache type</option>
              <option value="CACHE_SIZE">Finds by cache size</option>
              <option value="LOCATION">Finds in a location</option>
              <option value="CALENDAR_DAYS">Unique calendar days</option>
              <option value="FIND_STREAK">Longest find streak</option>
              <option value="PLACED_MONTHS">Unique placement months</option>
              <option value="MONTH_OF_YEAR">Finds in a calendar month</option>
              <option value="WEEKDAY">Finds on a weekday</option>
              <option value="DIFFICULTY_TERRAIN">Difficulty/terrain grid</option>
              <option value="DIFFICULTY_RATING">Finds by difficulty</option>
              <option value="TERRAIN_RATING">Finds by terrain</option>
              <option value="FAVORITE_POINTS">Finds by Favorite points</option>
              <option value="ATTRIBUTE">Finds with an attribute</option>
            </select></label>
            {rule.type === "CACHE_TYPE" && <label>Cache type<select value={rule.cacheTypeId} onChange={(event) => { const selected = cacheTypes.find((type) => type.id === event.target.value); replaceRule(index, { ...rule, cacheTypeId: event.target.value, cacheTypeLabel: selected?.label ?? event.target.selectedOptions[0]?.text ?? event.target.value }); }}>{cacheTypes.map((type) => <option value={type.id} key={type.id}>{type.label}{type.imported ? " · imported" : ""}</option>)}</select></label>}
            {rule.type === "CACHE_SIZE" && <label>Cache size<select value={rule.size} onChange={(event) => replaceRule(index, { ...rule, size: event.target.value })}>{cacheSizes.map((size) => <option key={size}>{size}</option>)}</select></label>}
            {rule.type === "LOCATION" && <LocationRuleFields rule={rule} countries={locationCountries} regionCatalogs={regionCatalogs} countyCatalogs={countyCatalogs} loadCatalog={loadLocationCatalog} onChange={(nextRule) => replaceRule(index, nextRule)} />}
            {rule.type === "MONTH_OF_YEAR" && <label>Month<select value={rule.month} onChange={(event) => replaceRule(index, { ...rule, month: Number(event.target.value) })}>{MONTHS.map((month, monthIndex) => <option value={monthIndex + 1} key={month}>{month}</option>)}</select></label>}
            {rule.type === "WEEKDAY" && <label>Weekday<select value={rule.weekday} onChange={(event) => replaceRule(index, { ...rule, weekday: Number(event.target.value) })}>{WEEKDAYS.map((weekday, weekdayIndex) => <option value={weekdayIndex} key={weekday}>{weekday}</option>)}</select></label>}
            {(rule.type === "DIFFICULTY_RATING" || rule.type === "TERRAIN_RATING") && <label>{rule.type === "DIFFICULTY_RATING" ? "Difficulty" : "Terrain"}<select value={rule.rating} onChange={(event) => replaceRule(index, { ...rule, rating: Number(event.target.value) })}>{RATINGS.map((rating) => <option value={rating} key={rating}>{rating.toFixed(1)}</option>)}</select></label>}
            {rule.type === "FAVORITE_POINTS" && <label>Favorite points per cache<input type="number" min={1} max={1000000} required value={rule.minimumFavoritePoints} onChange={(event) => replaceRule(index, { ...rule, minimumFavoritePoints: Number(event.target.value) })} /></label>}
            {rule.type === "ATTRIBUTE" && <label>Positive attribute<select required value={rule.attributeId} onChange={(event) => { const selected = attributes.find((attribute) => attribute.id === event.target.value); replaceRule(index, { ...rule, attributeId: event.target.value, attributeLabel: selected?.label ?? event.target.value }); }}><option value="" disabled>Select an attribute</option>{attributes.map((attribute) => <option value={attribute.id} key={attribute.id}>{attribute.label}</option>)}</select></label>}
            {rule.type === "PROJECT_GC_NUMBER" && <div className="challenge-imported-filter"><span>Imported filters</span><strong>{rule.filterLabel}</strong><small>Re-import the script to change these filters.</small></div>}
            <label>Required<input type="number" min={1} max={rule.type === "CALENDAR_DAYS" ? 366 : rule.type === "DIFFICULTY_TERRAIN" ? 81 : rule.type === "FIND_STREAK" ? 365 : 1000000} required value={rule.minimum} onChange={(event) => replaceRule(index, { ...rule, minimum: Number(event.target.value) })} /></label>
            {rules.length > 1 && <button className="challenge-icon-button" type="button" aria-label="Remove rule" onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={18} /></button>}
          </div>)}
        </div>
        <div className="challenge-actions"><button className="ghost-button challenge-small-button" type="button" disabled={rules.length >= 10} onClick={() => setRules((current) => [...current, defaultRule("TOTAL_FINDS")])}><Plus size={17} />Add AND rule</button>{editingId && <button className="ghost-button challenge-small-button" type="button" onClick={resetForm}><X size={17} />Cancel editing</button>}<button className="primary-button" disabled={busy !== null}>{busy === "save" ? "Saving…" : editingId ? "Update checker" : "Save checker"}</button></div>
      </form>
    </section>

    {error && <p className="error">{error}</p>}
    {!!checkers.length && <section className="panel challenge-checker-toolbar">
      <div className="challenge-checker-filters">
        <label className="challenge-checker-search"><span>Search caches</span><div><Search size={17} /><input type="search" value={checkerSearch} onChange={(event) => setCheckerSearch(event.target.value)} placeholder="GC code, name, or description…" /></div></label>
        <label><span>Sort by</span><select value={checkerSort} onChange={(event) => setCheckerSort(event.target.value)}><option value="updated-desc">Recently edited</option><option value="name-asc">Name A–Z</option><option value="code-asc">GC code</option><option value="status">Result status</option></select></label>
      </div>
      <div className="challenge-actions challenge-batch-actions">
        <button className="ghost-button challenge-small-button" type="button" disabled={!visibleCheckers.length || busy === "batch"} onClick={() => setSelectedIds((current) => { const next = new Set(current); visibleCheckers.forEach((checker) => allVisibleSelected ? next.delete(checker.id) : next.add(checker.id)); return next; })}>{allVisibleSelected ? "Clear visible" : `Select visible (${visibleCheckers.length})`}</button>
        <button className="ghost-button challenge-small-button" type="button" disabled={!selectedCheckers.length || busy !== null} onClick={() => void runMany(selectedCheckers)}><Play size={17} />Run selected ({selectedCheckers.length})</button>
        <button className="primary-button challenge-small-button" type="button" disabled={!checkers.length || busy !== null} onClick={() => void runMany(checkers)}><Play size={17} />Run all ({checkers.length})</button>
        {batchProgress && <span className="muted challenge-batch-progress" role="status">Running {batchProgress.done} of {batchProgress.total}…</span>}
      </div>
      <small className="muted">Showing {visibleCheckers.length} of {checkers.length} checker{checkers.length === 1 ? "" : "s"}</small>
    </section>}
    <section className="challenge-list">
      {visibleCheckers.map((checker) => { const result = results[checker.id]; return <article className={`panel challenge-card ${selectedIds.has(checker.id) ? "selected" : ""}`} key={checker.id}>
        <div className="challenge-card-heading"><div className="challenge-card-title"><label className="challenge-card-selector"><input type="checkbox" checked={selectedIds.has(checker.id)} onChange={() => toggleSelected(checker.id)} aria-label={`Select ${checker.gcCode ?? checker.name}`} /></label><div><p className="eyebrow">{checker.gcCode || "Unlinked checker"}</p><h2>{checker.name}</h2>{checker.description && <p className="muted">{checker.description}</p>}</div></div><span className={`challenge-status ${result ? result.passed ? "pass" : "fail" : ""}`}>{result ? result.passed ? <><Check size={18} />Qualified</> : <><X size={18} />Not yet</> : "Not run"}</span></div>
        <div className="challenge-actions"><button className="primary-button" disabled={busy !== null} onClick={() => void run(checker)}><Play size={17} />{busy === checker.id ? "Running…" : "Run checker"}</button><button className="ghost-button challenge-small-button" disabled={busy !== null} onClick={() => edit(checker)}><Pencil size={17} />Edit</button><button className="ghost-button challenge-small-button" disabled={busy !== null} onClick={() => void publish(checker)}><Globe2 size={17} />{checker.publishedAt ? "Unpublish" : "Publish result"}</button>{checker.publishedAt && checker.gcCode && <button className="ghost-button challenge-small-button" disabled={busy !== null} onClick={() => void copy(shareUrl(checker), `url-${checker.id}`)}><Clipboard size={17} />{copied === `url-${checker.id}` ? "Copied" : "Copy public link"}</button>}<button className="challenge-icon-button danger" disabled={busy !== null} aria-label="Delete checker" onClick={() => void remove(checker)}><Trash2 size={17} /></button></div>
        {result && <div className="challenge-result"><div className="challenge-result-rules">{result.rules.map((rule, index) => <div key={index}><span>{rule.passed ? <Check size={17} /> : <X size={17} />}{rule.label}</span><strong>{rule.current.toLocaleString()} / {rule.required.toLocaleString()}</strong><small>{rule.detail}</small><EvidenceList evidence={rule.evidence} limited={rule.evidenceLimited} /></div>)}</div><label>Proof for your log or cache owner<textarea readOnly value={result.proofText} /></label><button className="ghost-button challenge-small-button" onClick={() => void copy(result.proofText, `proof-${checker.id}`)}><Clipboard size={17} />{copied === `proof-${checker.id}` ? "Copied" : "Copy proof"}</button></div>}
      </article>; })}
      {!checkers.length && <div className="panel muted">No saved checkers yet. Create one above and run it against your imported finds.</div>}
      {!!checkers.length && !visibleCheckers.length && <div className="panel muted">No challenge caches match “{checkerSearch}”.</div>}
    </section>
  </AppShell>;
}

function EvidenceList({ evidence, limited }: { evidence: Evidence[]; limited: boolean }) {
  if (!evidence.length) return null;
  return <details className="challenge-evidence"><summary>View supporting finds ({evidence.length}{limited ? "+" : ""})</summary><div>{evidence.map((row, index) => <p key={`${row.gcCode}-${row.date}-${index}`}><time>{row.date}</time><a href={`https://coord.info/${row.gcCode}`} target="_blank" rel="noreferrer">{row.gcCode}</a><span>{row.name}</span></p>)}</div>{limited && <small>Showing the first 500 supporting finds.</small>}</details>;
}

function LocationRuleFields({ rule, countries, regionCatalogs, countyCatalogs, loadCatalog, onChange }: { rule: Extract<Rule, { type: "LOCATION" }>; countries: LocationCountry[]; regionCatalogs: Record<string, string[]>; countyCatalogs: Record<string, string[]>; loadCatalog: (country: string, region?: string) => Promise<void>; onChange: (rule: Extract<Rule, { type: "LOCATION" }>) => void }) {
  const inferredCountry = rule.field === "region"
    ? countries.find((item) => item.regions.some((region) => region.name === rule.value))?.name
    : rule.field === "county"
      ? countries.find((item) => item.regions.some((region) => region.counties.includes(rule.value)))?.name
      : undefined;
  const selectedCountry = rule.country ?? (rule.field === "country" ? rule.value : inferredCountry ?? "");
  const inferredRegion = rule.field === "county"
    ? countries.find((item) => item.name === selectedCountry)?.regions.find((region) => region.counties.includes(rule.value))?.name
    : undefined;
  const selectedRegion = rule.region ?? (rule.field === "region" ? rule.value : inferredRegion ?? "");
  const selectedCounty = rule.field === "county" ? rule.value : "";
  const country = countries.find((item) => item.name === selectedCountry);
  const region = country?.regions.find((item) => item.name === selectedRegion);
  const regionNames = regionCatalogs[selectedCountry] ?? country?.regions.map((item) => item.name) ?? [];
  const countyNames = countyCatalogs[`${selectedCountry}\u0000${selectedRegion}`] ?? region?.counties ?? [];
  useEffect(() => { if (selectedCountry) void loadCatalog(selectedCountry); }, [selectedCountry]);
  useEffect(() => { if (selectedCountry && selectedRegion) void loadCatalog(selectedCountry, selectedRegion); }, [selectedCountry, selectedRegion]);
  return <>
    <SearchableLocationInput label="Country" required value={selectedCountry} options={countries.map((item) => item.name)} placeholder="Search countries…" onSelect={(value) => {
      onChange({ type: "LOCATION", field: "country", value, country: value || undefined, minimum: rule.minimum });
    }} />
    <SearchableLocationInput label="Region" optional emptyLabel="Whole country" value={selectedRegion} options={regionNames} placeholder="Whole country / search…" disabled={!selectedCountry || !regionNames.length} onSelect={(value) => {
      onChange(value
        ? { type: "LOCATION", field: "region", value, country: selectedCountry, region: value, minimum: rule.minimum }
        : { type: "LOCATION", field: "country", value: selectedCountry, country: selectedCountry, minimum: rule.minimum });
    }} />
    <SearchableLocationInput label="County" optional emptyLabel="Whole region" value={selectedCounty} options={countyNames} placeholder="Whole region / search…" disabled={!selectedRegion || !countyNames.length} onSelect={(value) => {
      onChange(value
        ? { type: "LOCATION", field: "county", value, country: selectedCountry, region: selectedRegion, minimum: rule.minimum }
        : { type: "LOCATION", field: "region", value: selectedRegion, country: selectedCountry, region: selectedRegion, minimum: rule.minimum });
    }} />
  </>;
}

function searchableLocation(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replaceAll("ø", "o").replaceAll("æ", "ae").replaceAll("ð", "d").replaceAll("þ", "th");
}

function SearchableLocationInput({ label, optional, required, emptyLabel, value, options, placeholder, disabled, onSelect }: { label: string; optional?: boolean; required?: boolean; emptyLabel?: string; value: string; options: string[]; placeholder: string; disabled?: boolean; onSelect: (value: string) => void }) {
  const listId = useId();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setDraft(value), [value]);
  const exactOption = (candidate: string) => options.find((option) => option.localeCompare(candidate.trim(), undefined, { sensitivity: "base" }) === 0);
  const query = draft === value ? "" : searchableLocation(draft.trim());
  const filtered = query ? options.filter((option) => searchableLocation(option).includes(query)) : options;
  const choices = [...(optional && emptyLabel && !query ? [{ value: "", label: emptyLabel }] : []), ...filtered.map((option) => ({ value: option, label: option }))];
  const choose = (next: string) => {
    setDraft(next);
    setOpen(false);
    onSelect(next);
  };
  const activeOptionId = `${listId}-option-${activeIndex}`;
  useEffect(() => {
    if (open) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, activeOptionId, open]);
  return <div className="challenge-location-field" onBlur={(event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    const match = exactOption(draft);
    if (match) choose(match);
    else if (!draft && optional) choose("");
    else setDraft(value);
    setOpen(false);
  }}>
    <span>{label}{optional && <small>Optional</small>}</span>
    <div className="challenge-location-search"><Search aria-hidden="true" size={15} /><input
      type="text"
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && choices.length ? activeOptionId : undefined}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      required={required}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        setOpen(true);
        setActiveIndex(0);
        event.target.setCustomValidity("");
        if (!next) onSelect("");
      }}
      onFocus={(event) => {
        setOpen(true);
        setActiveIndex(Math.max(0, choices.findIndex((choice) => choice.value === value)));
        event.currentTarget.select();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setActiveIndex((current) => choices.length ? (current + direction + choices.length) % choices.length : 0);
        } else if (event.key === "Enter" && open && choices[activeIndex]) {
          event.preventDefault();
          choose(choices[activeIndex]!.value);
        } else if (event.key === "Escape") {
          event.preventDefault(); setDraft(value); setOpen(false);
        }
      }}
    />{open && <div className="challenge-location-menu" id={listId} role="listbox">
      {choices.map((choice, index) => <button
        type="button"
        id={`${listId}-option-${index}`}
        role="option"
        aria-selected={choice.value === value}
        className={index === activeIndex ? "active" : undefined}
        key={choice.value || "__empty"}
        tabIndex={-1}
        onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(choice.value)}
      ><span>{choice.label}</span>{choice.value === value && <Check aria-hidden="true" size={15} />}</button>)}
      {!choices.length && <p>No matching {label.toLocaleLowerCase()}s</p>}
    </div>}</div>
  </div>;
}
