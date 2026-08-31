"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, BookOpen, CalendarDays, Check, ChevronRight,
  CircleDot, Download, Flag, Goal, ListChecks, MapPinned, Plus, Route,
  Sparkles, Trophy, Upload, Users, Vote, Wrench
} from "lucide-react";
import { AppShell } from "../../components/app-shell";

type Section = "logbook" | "trips" | "goals" | "maintenance" | "challenges";

const sections: Array<{ id: Section; label: string; icon: typeof BookOpen }> = [
  { id: "logbook", label: "Logbook", icon: BookOpen },
  { id: "trips", label: "Trips", icon: MapPinned },
  { id: "goals", label: "Goals", icon: Goal },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "challenges", label: "Challenges", icon: Trophy }
];

const logs = [
  { code: "GC9F3A2", name: "Old Quarry View", date: "Aug 24", type: "Traditional", place: "Skane", km: 14.2 },
  { code: "GC7K91P", name: "Under the Copper Beech", date: "Aug 23", type: "Multi-cache", place: "Halland", km: 8.7 },
  { code: "GCA2N44", name: "The Quiet Platform", date: "Aug 23", type: "Mystery", place: "Halland", km: 1.9 },
  { code: "GC8M0Q7", name: "Harbor Light", date: "Aug 17", type: "EarthCache", place: "Blekinge", km: 46.4 }
];

const tripStops = [
  { code: "GC8JQ2K", name: "Molle lighthouse", type: "Traditional", votes: 6, distance: "0.4 km off route", top: 62, left: 18 },
  { code: "GCA7M31", name: "Kullaberg geology", type: "EarthCache", votes: 4, distance: "1.8 km off route", top: 34, left: 48 },
  { code: "GC6P8VV", name: "Coffee by the harbor", type: "Multi-cache", votes: 2, distance: "0.7 km off route", top: 61, left: 78 }
];

const goalData = [
  { title: "Find 300 caches in 2026", kind: "Yearly", current: 218, target: 300, note: "82 finds left" },
  { title: "Fill the Jasmer grid", kind: "Jasmer", current: 168, target: 204, note: "36 months missing" },
  { title: "Complete the D/T grid", kind: "D/T", current: 67, target: 81, note: "14 combinations missing" },
  { title: "Visit every Swedish county", kind: "County", current: 14, target: 21, note: "7 counties left" },
  { title: "30 day finding streak", kind: "Streak", current: 12, target: 30, note: "Current streak: 12 days" },
  { title: "Find 20 EarthCaches", kind: "Cache type", current: 13, target: 20, note: "7 finds left" }
];

const maintenanceItems = [
  { id: 1, code: "GC6T8W2", name: "Pine Needle Hotel", issue: "Container is cracked", age: "11 days", distance: "2.1 km" },
  { id: 2, code: "GC91M4B", name: "The Mill Race", issue: "Needs a fresh logbook", age: "6 days", distance: "4.8 km" },
  { id: 3, code: "GCA5R7P", name: "Birch and Stone", issue: "Coordinates reported off", age: "2 days", distance: "7.3 km" }
];

const challengeRows = [
  { rank: 1, name: "MajaK", finds: 18, change: "+3 today" },
  { rank: 2, name: "TrailFox", finds: 16, change: "+1 today" },
  { rank: 3, name: "You", finds: 12, change: "+2 today" },
  { rank: 4, name: "northbound", finds: 9, change: "Last find yesterday" },
  { rank: 5, name: "Sten & Moss", finds: 7, change: "+2 today" }
];

function downloadFile(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function RouteSketch({ maintenance = false }: { maintenance?: boolean }) {
  const points = maintenance ? maintenanceItems : tripStops;
  return (
    <div className="route-sketch" aria-label={maintenance ? "Maintenance route map" : "Trip route map"}>
      <div className="route-road route-road-one" />
      <div className="route-road route-road-two" />
      <div className="route-water" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={maintenance ? "M12 78 C25 55, 38 72, 52 44 S78 35, 89 16" : "M8 75 C24 38, 34 70, 49 43 S74 65, 92 25"} />
      </svg>
      {points.map((point, index) => {
        const top = "top" in point ? point.top : 72 - index * 25;
        const left = "left" in point ? point.left : 18 + index * 31;
        return <span key={point.code} className="map-stop" style={{ top: `${top}%`, left: `${left}%` }}>{index + 1}</span>;
      })}
      <span className="map-label map-label-one">Kullen</span>
      <span className="map-label map-label-two">Hoganas</span>
    </div>
  );
}

export default function FieldKitPage() {
  const [section, setSection] = useState<Section>("logbook");
  const [warning, setWarning] = useState(true);
  const [importNotice, setImportNotice] = useState("");
  const [votes, setVotes] = useState(() => new Set<string>(["GC8JQ2K"]));
  const [tripShared, setTripShared] = useState(true);
  const [activeGoals, setActiveGoals] = useState(() => new Set(goalData.map((goal) => goal.kind)));
  const [routeStops, setRouteStops] = useState(() => new Set(maintenanceItems.map((item) => item.id)));
  const [joined, setJoined] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalDistance = useMemo(() => logs.reduce((sum, log) => sum + log.km, 0), []);

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportNotice(`${file.name} is ready. Previewing 24 new finds and 3 updated logs.`);
    event.target.value = "";
  }

  function toggleVote(code: string) {
    setVotes((current) => {
      const next = new Set(current);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function exportTrip() {
    const points = tripStops.map((stop, index) => `<wpt lat="56.${30 + index}" lon="12.${51 + index}"><name>${stop.code} ${stop.name}</name></wpt>`).join("\n");
    downloadFile("kullen-saturday.gpx", `<?xml version="1.0"?><gpx version="1.1" creator="Geostats">\n${points}\n</gpx>`, "application/gpx+xml");
  }

  return (
    <AppShell>
      <header className="page-header field-kit-header">
        <div>
          <p className="eyebrow">Planning and progress</p>
          <h1>Field kit</h1>
          <p className="page-intro">Keep the parts of caching that happen between the find and the stats.</p>
        </div>
        <button className="primary-button header-action" onClick={() => fileRef.current?.click()}><Upload size={17} /> Import GPX or CSV</button>
        <input ref={fileRef} className="visually-hidden" type="file" accept=".gpx,.csv" onChange={importFile} />
      </header>

      {importNotice && <div className="inline-notice"><Check size={17} /><span>{importNotice}</span><button onClick={() => setImportNotice("")}>Dismiss</button></div>}

      <div className="field-kit-tabs" role="tablist" aria-label="Field kit sections">
        {sections.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon size={17} />{item.label}</button>;
        })}
      </div>

      {section === "logbook" && <section className="feature-section">
        {warning && <div className="last-seen-warning">
          <AlertTriangle size={22} />
          <div><strong>7 finds may be missing</strong><span>Your last import ended on Aug 24. Geocaching activity was last seen on Aug 29.</span></div>
          <button onClick={() => fileRef.current?.click()}>Import now</button>
          <button className="icon-button" aria-label="Dismiss warning" onClick={() => setWarning(false)}>×</button>
        </div>}
        <div className="field-stat-grid">
          <article><span>Total distance</span><strong>4,286 km</strong><small>Across all recorded journeys</small></article>
          <article><span>This year</span><strong>1,104 km</strong><small>218 finds on 47 days</small></article>
          <article><span>Latest journey</span><strong>{totalDistance.toFixed(1)} km</strong><small>Coast road, Aug 23 to 24</small></article>
          <article><span>Places visited</span><strong>86</strong><small>21 counties in 7 countries</small></article>
        </div>
        <div className="feature-grid logbook-grid">
          <article className="panel feature-panel">
            <div className="panel-heading"><div><p className="eyebrow">Latest journey</p><h2>Coast road weekend</h2></div><span className="quiet-pill">Aug 23 to 24</span></div>
            <RouteSketch />
            <div className="journey-summary"><span><Route size={16} /> 72.4 km</span><span><Flag size={16} /> 4 finds</span><span><CalendarDays size={16} /> 2 days</span></div>
          </article>
          <article className="panel feature-panel">
            <div className="panel-heading"><div><p className="eyebrow">Recent finds</p><h2>Logbook</h2></div><button className="text-button">View all <ChevronRight size={15} /></button></div>
            <div className="find-list">{logs.map((log) => <div key={log.code} className="find-row"><span className="cache-pin"><CircleDot size={17} /></span><div><strong>{log.name}</strong><small>{log.code} · {log.type} · {log.place}</small></div><div className="find-distance"><strong>{log.km} km</strong><small>{log.date}</small></div></div>)}</div>
          </article>
        </div>
      </section>}

      {section === "trips" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Shared list</p><h2>Kullen on Saturday</h2><p>3 stops · 4 people · Updated 12 min ago</p></div><div className="header-buttons"><button className="secondary-button" onClick={() => setTripShared(!tripShared)}><Users size={16} />{tripShared ? "Shared with 3" : "Invite people"}</button><button className="primary-button compact-button" onClick={exportTrip}><Download size={16} /> Export GPX</button></div></div>
        <div className="feature-grid trip-grid">
          <article className="panel feature-panel"><RouteSketch /><div className="trip-route-meta"><div><span className="route-avatar">Y</span><span className="route-avatar">MK</span><span className="route-avatar">TF</span><span className="route-avatar">+1</span></div><span>Suggested order saves about 18 km</span></div></article>
          <article className="panel feature-panel trip-stops-panel">
            <div className="panel-heading"><h2>Vote on stops</h2><span className="quiet-pill"><Vote size={14} /> Your picks: {votes.size}</span></div>
            <div className="trip-stop-list">{tripStops.map((stop, index) => <div key={stop.code} className="trip-stop"><span className="stop-number">{index + 1}</span><div><strong>{stop.name}</strong><small>{stop.code} · {stop.type}<br />{stop.distance}</small></div><button className={votes.has(stop.code) ? "vote-button voted" : "vote-button"} onClick={() => toggleVote(stop.code)}><Vote size={15} /> {stop.votes + (votes.has(stop.code) ? 1 : 0)}</button></div>)}</div>
            <button className="add-row-button"><Plus size={16} /> Suggest another cache</button>
          </article>
        </div>
      </section>}

      {section === "goals" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Personal targets</p><h2>Your 2026 goals</h2><p>Only you can see these unless you choose to share one.</p></div><button className="primary-button compact-button"><Plus size={16} /> New goal</button></div>
        <div className="goal-grid">{goalData.map((goal) => {
          const active = activeGoals.has(goal.kind);
          const progress = Math.round(goal.current / goal.target * 100);
          return <article key={goal.kind} className={`goal-card ${active ? "" : "goal-paused"}`}><div className="goal-card-heading"><span className="goal-icon"><Goal size={18} /></span><span className="quiet-pill">{goal.kind}</span><button className="goal-menu" aria-label={`Options for ${goal.title}`}>•••</button></div><h3>{goal.title}</h3><div className="goal-numbers"><strong>{goal.current}</strong><span>of {goal.target}</span><b>{progress}%</b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="goal-footer"><small>{active ? goal.note : "Goal paused"}</small><button onClick={() => setActiveGoals((current) => { const next = new Set(current); next.has(goal.kind) ? next.delete(goal.kind) : next.add(goal.kind); return next; })}>{active ? "Pause" : "Resume"}</button></div></article>;
        })}</div>
      </section>}

      {section === "maintenance" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Owner tools</p><h2>Maintenance board</h2><p>Three caches need a visit. The proposed route is 18.6 km.</p></div><button className="primary-button compact-button" onClick={() => downloadFile("maintenance-route.gpx", "<?xml version=\"1.0\"?><gpx version=\"1.1\" creator=\"Geostats\"></gpx>", "application/gpx+xml")}><ArrowDownToLine size={16} /> Export route</button></div>
        <div className="feature-grid maintenance-grid">
          <article className="panel feature-panel maintenance-list">
            <div className="board-summary"><span><strong>3</strong> needs attention</span><span><strong>8</strong> healthy</span><span><strong>1</strong> disabled</span></div>
            {maintenanceItems.map((item) => <label key={item.id} className="maintenance-row"><input type="checkbox" checked={routeStops.has(item.id)} onChange={() => setRouteStops((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><span className="maintenance-tool"><Wrench size={16} /></span><div><strong>{item.name}</strong><small>{item.code} · Reported {item.age} ago</small><p>{item.issue}</p></div><span className="maintenance-distance">{item.distance}</span></label>)}
          </article>
          <article className="panel feature-panel"><RouteSketch maintenance /><div className="route-plan-footer"><div><strong>{routeStops.size} stops selected</strong><small>1 hr 10 min · 18.6 km round trip</small></div><button className="secondary-button"><Route size={16} /> Optimize</button></div></article>
        </div>
      </section>}

      {section === "challenges" && <section className="feature-section">
        <div className="challenge-hero">
          <div><span className="challenge-kicker"><Sparkles size={15} /> August group challenge</span><h2>Find something different</h2><p>Score one point for each cache type. The group is capped at 12 friends, and totals reset on September 1.</p><div className="challenge-meta"><span><Users size={16} /> 8 of 12 joined</span><span><CalendarDays size={16} /> 2 days left</span><span><ListChecks size={16} /> 14 cache types</span></div></div>
          <button className={joined ? "secondary-button joined-button" : "primary-button"} onClick={() => setJoined(!joined)}>{joined ? <><Check size={16} /> Joined</> : "Join challenge"}</button>
        </div>
        <div className="feature-grid challenge-grid">
          <article className="panel feature-panel leaderboard"><div className="panel-heading"><h2>Leaderboard</h2><span className="quiet-pill">Friends only</span></div>{challengeRows.map((row) => <div key={row.rank} className={`leader-row ${row.name === "You" ? "is-you" : ""}`}><span className="leader-rank">{row.rank}</span><span className="leader-avatar">{row.name.slice(0, 2).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.change}</small></div><strong>{row.finds}<small> pts</small></strong></div>)}</article>
          <article className="panel feature-panel personal-challenge"><p className="eyebrow">Your progress</p><div className="challenge-score"><strong>12</strong><span>of 14 types</span></div><div className="progress-track large"><span style={{ width: "86%" }} /></div><h3>Still missing</h3><div className="missing-types"><span>Letterbox Hybrid</span><span>Wherigo</span></div><p className="muted-copy">Your exact finds stay private. Friends only see your point total.</p></article>
        </div>
      </section>}
    </AppShell>
  );
}
