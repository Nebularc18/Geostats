"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Compass, Goal, Plus, Trash2 } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";

type GoalKind =
  | "YEARLY_FINDS"
  | "TOTAL_FINDS"
  | "DT_GRID"
  | "JASMER"
  | "CALENDAR_366"
  | "STREAK"
  | "COUNTRIES"
  | "REGIONS"
  | "COUNTIES"
  | "CACHE_TYPE"
  | "CUSTOM";

type EnrichedGoal = {
  id: string;
  title: string;
  kind: GoalKind;
  target: number;
  current: number;
  remaining: number;
  percent: number;
  completed: boolean;
  archived: boolean;
  config: { year?: number; cacheType?: string; manualCurrent?: number; note?: string };
  gapFilter: "missing_dt" | "missing_jasmer" | "missing_county" | null;
};

const CURRENT_YEAR = new Date().getUTCFullYear();

const PRESETS: Array<{ title: string; kind: GoalKind; target: number; config?: Record<string, unknown> }> = [
  { title: `Find 250 caches in ${CURRENT_YEAR}`, kind: "YEARLY_FINDS", target: 250, config: { year: CURRENT_YEAR } },
  { title: "Complete the 81 D/T grid", kind: "DT_GRID", target: 81 },
  { title: "Fill 150 Jasmer months", kind: "JASMER", target: 150 },
  { title: "Fill the 366 calendar", kind: "CALENDAR_366", target: 366 },
  { title: "30-day find streak", kind: "STREAK", target: 30 },
  { title: "Visit 25 counties", kind: "COUNTIES", target: 25 },
  { title: "Find 25 EarthCaches", kind: "CACHE_TYPE", target: 25, config: { cacheType: "Earthcache" } }
];

const KIND_LABELS: Record<GoalKind, string> = {
  YEARLY_FINDS: "Yearly finds",
  TOTAL_FINDS: "Total finds",
  DT_GRID: "D/T grid",
  JASMER: "Jasmer grid",
  CALENDAR_366: "366 Calendar",
  STREAK: "Find streak",
  COUNTRIES: "Countries",
  REGIONS: "Regions",
  COUNTIES: "Counties",
  CACHE_TYPE: "Cache type",
  CUSTOM: "Custom"
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<EnrichedGoal[]>([]);
  const [cacheTypes, setCacheTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<GoalKind>("YEARLY_FINDS");
  const [target, setTarget] = useState("200");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [cacheType, setCacheType] = useState("Traditional Cache");
  const [manualCurrent, setManualCurrent] = useState("0");

  async function load() {
    setLoading(true);
    try {
      const response = await apiFetch<{ goals: EnrichedGoal[]; cacheTypes: string[] }>("/goals");
      setGoals(response.goals);
      setCacheTypes(response.cacheTypes);
      if (response.cacheTypes.length > 0 && !response.cacheTypes.includes(cacheType)) {
        setCacheType(response.cacheTypes[0]!);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load goals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createGoal(payload: { title: string; kind: GoalKind; target: number; config?: Record<string, unknown> }) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/goals", { method: "POST", body: JSON.stringify(payload) });
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save goal");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedTarget = Number(target);
    if (!title.trim() || !Number.isInteger(parsedTarget) || parsedTarget < 1) {
      setError("Enter a goal title and a positive target number.");
      return;
    }
    const config: Record<string, unknown> = {};
    if (kind === "YEARLY_FINDS") config.year = Number(year) || CURRENT_YEAR;
    if (kind === "CACHE_TYPE") config.cacheType = cacheType;
    if (kind === "CUSTOM") config.manualCurrent = Math.max(0, Number(manualCurrent) || 0);
    const draft = title;
    if (await createGoal({ title: draft.trim(), kind, target: parsedTarget, config })) {
      setTitle((current) => current === draft ? "" : current);
    }
  }

  async function incrementCustomGoal(goal: EnrichedGoal, delta: number) {
    setBusy(true);
    try {
      const nextValue = Math.max(0, (goal.config.manualCurrent ?? goal.current) + delta);
      await apiFetch(`/goals/${goal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config: { ...goal.config, manualCurrent: nextValue } })
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update goal");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGoal(goal: EnrichedGoal) {
    setBusy(true);
    try {
      await apiFetch(`/goals/${goal.id}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete goal");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(goal: EnrichedGoal) {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ goal: EnrichedGoal }>(`/goals/${goal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !goal.archived })
      });
      setGoals((current) => current.map((item) => item.id === goal.id ? response.goal : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update goal");
    } finally {
      setBusy(false);
    }
  }

  const activeGoals = goals.filter((goal) => !goal.archived);
  const archivedGoals = goals.filter((goal) => goal.archived);
  const completedCount = activeGoals.filter((goal) => goal.completed).length;

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Account-synced targets</p>
          <h1>Goals</h1>
        </div>
        <Link className="secondary-button" href="/travel?gapFilter=missing_dt">
          <Compass size={16} /> Find gap-filling caches
        </Link>
      </header>

      <section className="stat-grid stat-grid-3">
        <div className="stat-card">
          <span>Active goals</span>
          <strong>{activeGoals.length}</strong>
        </div>
        <div className="stat-card">
          <span>Completed</span>
          <strong>{completedCount}</strong>
        </div>
        <div className="stat-card">
          <span>In progress</span>
          <strong>{activeGoals.length - completedCount}</strong>
        </div>
      </section>

      {error ? <p className="notice error">{error}</p> : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your goals</h2>
            <p className="muted">Progress updates automatically from your latest stats snapshot.</p>
          </div>
        </div>

        {loading ? <p className="muted">Loading goals…</p> : null}

        {!loading && activeGoals.length === 0 ? (
          <div className="travel-empty">
            <Goal size={30} />
            <h3>No active goals</h3>
            <p className="muted">Pick a starter preset below or create your own geocaching target.</p>
          </div>
        ) : null}

        <div className="goals-grid">
          {activeGoals.map((goal) => (
            <article key={goal.id} className={`goal-card${goal.completed ? " goal-completed" : ""}`}>
              <div className="goal-card-top">
                <div>
                  <span className="goal-kind-pill">{KIND_LABELS[goal.kind]}</span>
                  <h3>{goal.title}</h3>
                </div>
                <button
                  type="button"
                  className="row-delete"
                  aria-label={`Delete ${goal.title}`}
                  disabled={busy}
                  onClick={() => void deleteGoal(goal)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="goal-progress-numbers">
                <strong>
                  {goal.current.toLocaleString()} / {goal.target.toLocaleString()}
                </strong>
                <span>{goal.completed ? <><CheckCircle2 size={14} style={{ verticalAlign: "-2px" }} /> Complete</> : `${goal.remaining.toLocaleString()} left (${goal.percent}%)`}</span>
              </div>
              <div className="goal-progress-track" role="progressbar" aria-valuenow={goal.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="goal-progress-fill" style={{ width: `${goal.percent}%` }} />
              </div>
              <div className="goal-card-actions">
                <button type="button" className="text-button" disabled={busy} onClick={() => void toggleArchive(goal)}>
                  Archive
                </button>
                {goal.gapFilter ? (
                  <Link className="text-button" href={`/travel?gapFilter=${goal.gapFilter}`}>
                    <Compass size={14} /> Find caches in Travel
                  </Link>
                ) : null}
                {goal.kind === "CUSTOM" ? (
                  <div className="goal-custom-steppers">
                    <button type="button" className="secondary-button" disabled={busy || goal.current <= 0} onClick={() => void incrementCustomGoal(goal, -1)}>
                      -1
                    </button>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void incrementCustomGoal(goal, 1)}>
                      +1
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {archivedGoals.length > 0 ? (
        <section className="panel">
          <h2>Archived goals</h2>
          <div className="goals-grid">
            {archivedGoals.map((goal) => (
              <article key={goal.id} className="goal-card">
                <h3>{goal.title}</h3>
                <div className="goal-card-actions">
                  <button type="button" className="text-button" disabled={busy} onClick={() => void toggleArchive(goal)}>Restore</button>
                  <button type="button" className="row-delete" aria-label={`Delete ${goal.title}`} disabled={busy} onClick={() => void deleteGoal(goal)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Quick-add presets</h2>
        <div className="goal-preset-list">
          {PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void createGoal(preset)}
            >
              <Plus size={15} /> {preset.title}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Create a custom goal</h2>
        <form className="goal-composer-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>Goal title</span>
            <input
              required
              maxLength={140}
              placeholder="e.g. Find 50 Mystery caches"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Metric</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as GoalKind)}>
              {(Object.keys(KIND_LABELS) as GoalKind[]).map((key) => (
                <option key={key} value={key}>{KIND_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Target</span>
            <input type="number" min={1} max={1000000} required value={target} onChange={(event) => setTarget(event.target.value)} />
          </label>
          {kind === "YEARLY_FINDS" ? (
            <label>
              <span>Year</span>
              <input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(event.target.value)} />
            </label>
          ) : null}
          {kind === "CACHE_TYPE" ? (
            <label>
              <span>Cache type</span>
              <select value={cacheType} onChange={(event) => setCacheType(event.target.value)}>
                {(cacheTypes.length ? cacheTypes : ["Traditional Cache", "Mystery Cache", "Multi-cache", "Earthcache", "Virtual Cache"]).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === "CUSTOM" ? (
            <label>
              <span>Starting progress</span>
              <input type="number" min={0} value={manualCurrent} onChange={(event) => setManualCurrent(event.target.value)} />
            </label>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            <Plus size={16} /> Add goal
          </button>
        </form>
      </section>
    </AppShell>
  );
}
