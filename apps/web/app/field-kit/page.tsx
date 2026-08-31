"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

const FIELD_KIT_STORAGE_KEY = "geostats-field-kit-v1";

type GoalItem = {
  id: string;
  title: string;
  kind: string;
  current: number;
  target: number;
  note: string;
};

type TripSuggestion = {
  code: string;
  name: string;
  type: string;
  votes: number;
  distance: string;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

type RoutePoint = Coordinates & {
  code: string;
  name: string;
  top?: number;
  left?: number;
};

const logs = [
  { code: "GC9F3A2", name: "Old Quarry View", date: "Aug 24", type: "Traditional", place: "Skane", km: 14.2 },
  { code: "GC7K91P", name: "Under the Copper Beech", date: "Aug 23", type: "Multi-cache", place: "Halland", km: 8.7 },
  { code: "GCA2N44", name: "The Quiet Platform", date: "Aug 23", type: "Mystery", place: "Halland", km: 1.9 },
  { code: "GC8M0Q7", name: "Harbor Light", date: "Aug 17", type: "EarthCache", place: "Blekinge", km: 46.4 }
];

const tripStops = [
  { code: "GC8JQ2K", name: "Molle lighthouse", type: "Traditional", votes: 6, distance: "0.4 km off route", latitude: 56.28382, longitude: 12.49174, top: 62, left: 18 },
  { code: "GCA7M31", name: "Kullaberg geology", type: "EarthCache", votes: 4, distance: "1.8 km off route", latitude: 56.29791, longitude: 12.50764, top: 34, left: 48 },
  { code: "GC6P8VV", name: "Coffee by the harbor", type: "Multi-cache", votes: 2, distance: "0.7 km off route", latitude: 56.24751, longitude: 12.55683, top: 61, left: 78 }
];

const goalData: GoalItem[] = [
  { id: "yearly", title: "Find 300 caches in 2026", kind: "Yearly", current: 218, target: 300, note: "82 finds left" },
  { id: "jasmer", title: "Fill the Jasmer grid", kind: "Jasmer", current: 168, target: 204, note: "36 months missing" },
  { id: "dt", title: "Complete the D/T grid", kind: "D/T", current: 67, target: 81, note: "14 combinations missing" },
  { id: "county", title: "Visit every Swedish county", kind: "County", current: 14, target: 21, note: "7 counties left" },
  { id: "streak", title: "30 day finding streak", kind: "Streak", current: 12, target: 30, note: "Current streak: 12 days" },
  { id: "cache-type", title: "Find 20 EarthCaches", kind: "Cache type", current: 13, target: 20, note: "7 finds left" }
];

const maintenanceItems = [
  { id: 1, code: "GC6T8W2", name: "Pine Needle Hotel", issue: "Container is cracked", age: "11 days", distance: "2.1 km", latitude: 56.29544, longitude: 12.53137 },
  { id: 2, code: "GC91M4B", name: "The Mill Race", issue: "Needs a fresh logbook", age: "6 days", distance: "4.8 km", latitude: 56.27406, longitude: 12.53972 },
  { id: 3, code: "GCA5R7P", name: "Birch and Stone", issue: "Coordinates reported off", age: "2 days", distance: "7.3 km", latitude: 56.25217, longitude: 12.56601 }
];

const maintenanceRouteOrigin: Coordinates = { latitude: 56.238, longitude: 12.58 };

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
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;"
  })[character] ?? character);
}

function gpxWaypoint(point: Coordinates & { code: string; name: string }) {
  return `  <wpt lat="${point.latitude}" lon="${point.longitude}"><name>${escapeXml(point.code)} ${escapeXml(point.name)}</name></wpt>`;
}

function gpxRoutePoint(point: Coordinates & { code: string; name: string }) {
  return `    <rtept lat="${point.latitude}" lon="${point.longitude}"><name>${escapeXml(point.code)} ${escapeXml(point.name)}</name></rtept>`;
}

function parseCsvRecords(contents: string, delimiter: "," | ";" = ",") {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    const nextCharacter = contents[index + 1];
    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.trim().length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    if (record.some((value) => value.trim())) records.push(record);
  }
  return records;
}

function detectCsvDelimiter(contents: string) {
  let firstRecord = contents;
  let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    const nextCharacter = contents[index + 1];
    if (quoted) {
      if (character === '"' && nextCharacter === '"') index += 1;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === "\n") {
      firstRecord = contents.slice(0, index);
      break;
    }
  }
  let commaCount = 0;
  let semicolonCount = 0;
  quoted = false;
  for (let index = 0; index < firstRecord.length; index += 1) {
    const character = firstRecord[index];
    if (character === '"' && firstRecord[index + 1] === '"') {
      index += 1;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (!quoted && character === ",") commaCount += 1;
    if (!quoted && character === ";") semicolonCount += 1;
  }
  return semicolonCount > commaCount ? ";" : ",";
}

function importPreview(fileName: string, contents: string) {
  if (fileName.toLowerCase().endsWith(".gpx")) {
    if (typeof DOMParser === "undefined") throw new Error("XML parsing is unavailable");
    const document = new DOMParser().parseFromString(contents, "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error("Invalid GPX");
    const elements = Array.from(document.getElementsByTagName("*"));
    const points = elements.filter((element) => element.localName === "wpt").length;
    const logs = elements.filter((element) => element.localName === "log").length;
    return { records: points, recordLabel: "cache point", logs };
  }

  const records = parseCsvRecords(contents, detectCsvDelimiter(contents));
  const header = records[0]?.map((field) => field.trim().toLowerCase()) ?? [];
  const hasHeader = header.some((field) => field === "code" || field === "gc code" || field === "latitude");
  return { records: Math.max(records.length - (hasHeader ? 1 : 0), 0), recordLabel: "CSV row", logs: 0 };
}

function coordinateDistanceSquared(first: Coordinates, second: Coordinates) {
  const latitudeDelta = first.latitude - second.latitude;
  const longitudeDelta = first.longitude - second.longitude;
  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
}

function routeDistance(points: typeof maintenanceItems) {
  return points.reduce((total, point, index) => {
    const previous = index === 0 ? maintenanceRouteOrigin : points[index - 1];
    return total + coordinateDistanceSquared(previous, point);
  }, 0) + (points.length ? coordinateDistanceSquared(points.at(-1)!, maintenanceRouteOrigin) : 0);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function optimizeMaintenanceStops(stops: typeof maintenanceItems) {
  return permutations(stops).reduce((best, candidate) => {
    const distanceDifference = routeDistance(candidate) - routeDistance(best);
    const startsCloser = candidate.length > 0 && best.length > 0
      && coordinateDistanceSquared(maintenanceRouteOrigin, candidate[0]) < coordinateDistanceSquared(maintenanceRouteOrigin, best[0]);
    return distanceDifference < -1e-12 || (Math.abs(distanceDifference) <= 1e-12 && startsCloser) ? candidate : best;
  }, [...stops]);
}

function RouteSketch({ maintenance = false, routePoints }: { maintenance?: boolean; routePoints?: RoutePoint[] }) {
  const points = routePoints ?? (maintenance ? maintenanceItems : tripStops);
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
  const [notice, setNotice] = useState("");
  const [votes, setVotes] = useState(() => new Set<string>(["GC8JQ2K"]));
  const [tripShared, setTripShared] = useState(true);
  const [activeGoals, setActiveGoals] = useState(() => new Set(goalData.map((goal) => goal.id)));
  const [customGoals, setCustomGoals] = useState<GoalItem[]>([]);
  const [routeStops, setRouteStops] = useState(() => new Set(maintenanceItems.map((item) => item.id)));
  const [joined, setJoined] = useState(true);
  const [suggestions, setSuggestions] = useState<TripSuggestion[]>([]);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionName, setSuggestionName] = useState("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [goalComposerOpen, setGoalComposerOpen] = useState(false);
  const [goalMenuId, setGoalMenuId] = useState<string | null>(null);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalTarget, setNewGoalTarget] = useState("10");
  const [newGoalKind, setNewGoalKind] = useState("Personal");
  const [routeOptimized, setRouteOptimized] = useState(false);
  const [maintenanceRouteOrder, setMaintenanceRouteOrder] = useState(() => maintenanceItems.map((item) => item.id));
  const [storageReady, setStorageReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalDistance = useMemo(() => logs.reduce((sum, log) => sum + log.km, 0), []);
  const allGoals = useMemo(() => [...goalData, ...customGoals], [customGoals]);
  const visibleLogs = useMemo(() => showAllLogs ? [...logs, ...[
    { code: "GC5Q2L8", name: "Windmill at Dusk", date: "Aug 12", type: "Traditional", place: "Skane", km: 12.1 },
    { code: "GCB1R5T", name: "Granite Shoreline", date: "Aug 04", type: "EarthCache", place: "Blekinge", km: 31.6 }
  ]] : logs, [showAllLogs]);
  const visibleTripStops = useMemo(() => [...tripStops, ...suggestions], [suggestions]);
  const orderedMaintenanceItems = useMemo(() => {
    const selected = new Set(routeStops);
    const byId = new Map(maintenanceItems.map((item) => [item.id, item]));
    const ordered = maintenanceRouteOrder.flatMap((id) => selected.has(id) && byId.has(id) ? [byId.get(id)!] : []);
    const alreadyOrdered = new Set(ordered.map((item) => item.id));
    return [...ordered, ...maintenanceItems.filter((item) => selected.has(item.id) && !alreadyOrdered.has(item.id))];
  }, [maintenanceRouteOrder, routeStops]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FIELD_KIT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          warning?: unknown;
          votes?: unknown;
          tripShared?: unknown;
          activeGoals?: unknown;
          customGoals?: unknown;
          routeStops?: unknown;
          joined?: unknown;
          suggestions?: unknown;
          routeOptimized?: unknown;
          maintenanceRouteOrder?: unknown;
        };
        if (typeof parsed.warning === "boolean") setWarning(parsed.warning);
        if (Array.isArray(parsed.votes)) setVotes(new Set(parsed.votes.filter((value): value is string => typeof value === "string")));
        if (typeof parsed.tripShared === "boolean") setTripShared(parsed.tripShared);
        if (Array.isArray(parsed.activeGoals)) setActiveGoals(new Set(parsed.activeGoals.filter((value): value is string => typeof value === "string")));
        if (Array.isArray(parsed.customGoals)) {
          setCustomGoals(parsed.customGoals.filter((value): value is GoalItem => {
            if (!value || typeof value !== "object") return false;
            const goal = value as Partial<GoalItem>;
            return typeof goal.id === "string" && typeof goal.title === "string" && typeof goal.kind === "string"
              && typeof goal.current === "number" && typeof goal.target === "number" && typeof goal.note === "string";
          }));
        }
        if (Array.isArray(parsed.routeStops)) setRouteStops(new Set(parsed.routeStops.filter((value): value is number => typeof value === "number")));
        if (typeof parsed.joined === "boolean") setJoined(parsed.joined);
        if (Array.isArray(parsed.suggestions)) {
          setSuggestions(parsed.suggestions.filter((value): value is TripSuggestion => {
            if (!value || typeof value !== "object") return false;
            const suggestion = value as Partial<TripSuggestion>;
            return typeof suggestion.code === "string" && typeof suggestion.name === "string" && typeof suggestion.type === "string"
              && typeof suggestion.votes === "number" && typeof suggestion.distance === "string";
          }));
        }
        if (typeof parsed.routeOptimized === "boolean") setRouteOptimized(parsed.routeOptimized);
        if (Array.isArray(parsed.maintenanceRouteOrder)) setMaintenanceRouteOrder(parsed.maintenanceRouteOrder.filter((value): value is number => typeof value === "number"));
      }
    } catch {
      // A bad or unavailable local copy should not prevent the workspace from opening.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(FIELD_KIT_STORAGE_KEY, JSON.stringify({
        warning,
        votes: [...votes],
        tripShared,
        activeGoals: [...activeGoals],
        customGoals,
        routeStops: [...routeStops],
        joined,
        suggestions,
        routeOptimized,
        maintenanceRouteOrder
      }));
    } catch {
      // Storage can be disabled in private browsing. The controls still work for this visit.
    }
  }, [storageReady, warning, votes, tripShared, activeGoals, customGoals, routeStops, joined, suggestions, routeOptimized, maintenanceRouteOrder]);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const preview = importPreview(file.name, await file.text());
      const pointLabel = `${preview.records} ${preview.recordLabel}${preview.records === 1 ? "" : "s"}`;
      const logLabel = preview.logs ? ` and ${preview.logs} ${preview.logs === 1 ? "log" : "logs"}` : "";
      setNotice(`${file.name} is ready for review. Found ${pointLabel}${logLabel}. No records have been imported yet.`);
    } catch {
      setNotice(`${file.name} could not be read. No records were imported.`);
    } finally {
      event.target.value = "";
    }
  }

  function toggleVote(code: string) {
    setVotes((current) => {
      const next = new Set(current);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function exportGpx(fileName: string, routeName: string, points: Array<Coordinates & { code: string; name: string }>) {
    const waypoints = points.map(gpxWaypoint).join("\n");
    const routePoints = points.map(gpxRoutePoint).join("\n");
    downloadFile(fileName, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">\n  <rte><name>${escapeXml(routeName)}</name>\n${routePoints}\n  </rte>\n${waypoints}\n</gpx>`, "application/gpx+xml");
  }

  function exportTrip() {
    exportGpx("kullen-saturday.gpx", "Kullen on Saturday", tripStops);
    setNotice(`Exported ${tripStops.length} stops with their saved coordinates${suggestions.length ? `; ${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} without coordinates ${suggestions.length === 1 ? "was" : "were"} left out` : ""}.`);
  }

  function exportMaintenanceRoute() {
    const selected = orderedMaintenanceItems;
    if (!selected.length) {
      setNotice("Select at least one maintenance stop before exporting a route.");
      return;
    }
    exportGpx("maintenance-route.gpx", "Maintenance route", selected);
    setNotice(`Exported ${selected.length} selected maintenance ${selected.length === 1 ? "stop" : "stops"} with coordinates.`);
  }

  function submitSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = suggestionName.trim();
    if (!name) return;
    const suggestion: TripSuggestion = {
      code: `SUG-${suggestions.length + 1}`,
      name,
      type: "Suggested stop",
      votes: 0,
      distance: "Awaiting route check"
    };
    setSuggestions((current) => [...current, suggestion]);
    setSuggestionName("");
    setSuggestionOpen(false);
    setNotice(`Added ${name} to the shared trip list for everyone to vote on.`);
  }

  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newGoalTitle.trim();
    const target = Number.parseInt(newGoalTarget, 10);
    if (!title || !Number.isFinite(target) || target < 1) return;
    const goal: GoalItem = {
      id: `custom-${Date.now()}`,
      title,
      kind: newGoalKind.trim() || "Personal",
      current: 0,
      target,
      note: `${target} to go`
    };
    setCustomGoals((current) => [...current, goal]);
    setActiveGoals((current) => new Set(current).add(goal.id));
    setNewGoalTitle("");
    setNewGoalTarget("10");
    setGoalComposerOpen(false);
    setNotice(`Created goal: ${title}.`);
  }

  function toggleGoal(goalId: string) {
    setActiveGoals((current) => {
      const next = new Set(current);
      next.has(goalId) ? next.delete(goalId) : next.add(goalId);
      return next;
    });
  }

  function toggleMaintenanceStop(stopId: number) {
    setRouteStops((current) => {
      const next = new Set(current);
      next.has(stopId) ? next.delete(stopId) : next.add(stopId);
      return next;
    });
    setRouteOptimized(false);
  }

  return (
    <AppShell>
      <header className="page-header field-kit-header">
        <div>
          <p className="eyebrow">Planning and progress</p>
          <h1>Field kit</h1>
          <p className="page-intro">Keep the parts of caching that happen between the find and the stats.</p>
        </div>
        <button type="button" className="primary-button header-action" onClick={() => fileRef.current?.click()}><Upload size={17} /> Import GPX or CSV</button>
        <input ref={fileRef} className="visually-hidden" type="file" accept=".gpx,.csv" onChange={importFile} />
      </header>

      {notice && <div className="inline-notice"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

      <div className="field-kit-tabs" role="tablist" aria-label="Field kit sections">
        {sections.map((item) => {
          const Icon = item.icon;
          return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon size={17} />{item.label}</button>;
        })}
      </div>

      {section === "logbook" && <section className="feature-section">
        {warning && <div className="last-seen-warning">
          <AlertTriangle size={22} />
          <div><strong>7 finds may be missing</strong><span>Your last import ended on Aug 24. Geocaching activity was last seen on Aug 29.</span></div>
          <button type="button" onClick={() => fileRef.current?.click()}>Import now</button>
          <button type="button" className="icon-button" aria-label="Dismiss warning" onClick={() => setWarning(false)}>×</button>
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
            <div className="panel-heading"><div><p className="eyebrow">Recent finds</p><h2>Logbook</h2></div><button type="button" className="text-button" onClick={() => setShowAllLogs((current) => !current)}>{showAllLogs ? "Show recent" : "View all"} <ChevronRight size={15} /></button></div>
            <div className="find-list">{visibleLogs.map((log) => <div key={log.code} className="find-row"><span className="cache-pin"><CircleDot size={17} /></span><div><strong>{log.name}</strong><small>{log.code} · {log.type} · {log.place}</small></div><div className="find-distance"><strong>{log.km} km</strong><small>{log.date}</small></div></div>)}</div>
          </article>
        </div>
      </section>}

      {section === "trips" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Shared list</p><h2>Kullen on Saturday</h2><p>3 stops · 4 people · Updated 12 min ago</p></div><div className="header-buttons"><button type="button" className="secondary-button" onClick={() => setTripShared(!tripShared)}><Users size={16} />{tripShared ? "Shared with 3" : "Invite people"}</button><button type="button" className="primary-button compact-button" onClick={exportTrip}><Download size={16} /> Export GPX</button></div></div>
        <div className="feature-grid trip-grid">
          <article className="panel feature-panel"><RouteSketch /><div className="trip-route-meta"><div><span className="route-avatar">Y</span><span className="route-avatar">MK</span><span className="route-avatar">TF</span><span className="route-avatar">+1</span></div><span>Suggested order saves about 18 km</span></div></article>
          <article className="panel feature-panel trip-stops-panel">
            <div className="panel-heading"><h2>Vote on stops</h2><span className="quiet-pill"><Vote size={14} /> Your picks: {votes.size}</span></div>
            <div className="trip-stop-list">{visibleTripStops.map((stop, index) => <div key={stop.code} className="trip-stop"><span className="stop-number">{index + 1}</span><div><strong>{stop.name}</strong><small>{stop.code} · {stop.type}<br />{stop.distance}</small></div><button type="button" className={votes.has(stop.code) ? "vote-button voted" : "vote-button"} onClick={() => toggleVote(stop.code)}><Vote size={15} /> {stop.votes + (votes.has(stop.code) ? 1 : 0)}</button></div>)}</div>
            {suggestionOpen && <form className="inline-action-form" onSubmit={submitSuggestion}><label htmlFor="suggestion-name">Cache or stop name</label><div><input id="suggestion-name" value={suggestionName} onChange={(event) => setSuggestionName(event.target.value)} placeholder="e.g. Picnic at the overlook" autoFocus /><button type="submit" className="primary-button compact-button">Add stop</button></div><button type="button" className="form-cancel" onClick={() => setSuggestionOpen(false)}>Cancel</button></form>}
            {!suggestionOpen && <button type="button" className="add-row-button" onClick={() => setSuggestionOpen(true)}><Plus size={16} /> Suggest another cache</button>}
          </article>
        </div>
      </section>}

      {section === "goals" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Personal targets</p><h2>Your 2026 goals</h2><p>Only you can see these unless you choose to share one.</p></div><button type="button" className="primary-button compact-button" onClick={() => setGoalComposerOpen((current) => !current)}><Plus size={16} /> New goal</button></div>
        {goalComposerOpen && <form className="panel goal-composer" onSubmit={submitGoal}><div><p className="eyebrow">Add a target</p><h3>What do you want to work toward?</h3></div><label>Goal name<input value={newGoalTitle} onChange={(event) => setNewGoalTitle(event.target.value)} placeholder="e.g. Find 50 caches near home" autoFocus required /></label><div className="goal-composer-fields"><label>Category<input value={newGoalKind} onChange={(event) => setNewGoalKind(event.target.value)} placeholder="Personal" /></label><label>Target<input type="number" min="1" value={newGoalTarget} onChange={(event) => setNewGoalTarget(event.target.value)} required /></label></div><div className="goal-composer-actions"><button type="button" className="secondary-button" onClick={() => setGoalComposerOpen(false)}>Cancel</button><button type="submit" className="primary-button">Create goal</button></div></form>}
        <div className="goal-grid">{allGoals.map((goal) => {
          const active = activeGoals.has(goal.id);
          const progress = Math.round(goal.current / goal.target * 100);
          return <article key={goal.id} className={`goal-card ${active ? "" : "goal-paused"}`}><div className="goal-card-heading"><span className="goal-icon"><Goal size={18} /></span><span className="quiet-pill">{goal.kind}</span><span className="goal-menu-wrap"><button type="button" className="goal-menu" aria-label={`Options for ${goal.title}`} aria-expanded={goalMenuId === goal.id} onClick={() => setGoalMenuId((current) => current === goal.id ? null : goal.id)}>•••</button>{goalMenuId === goal.id && <span className="goal-action-menu"><button type="button" onClick={() => { toggleGoal(goal.id); setGoalMenuId(null); }}>{active ? "Pause goal" : "Resume goal"}</button>{customGoals.some((customGoal) => customGoal.id === goal.id) && <button type="button" onClick={() => { setCustomGoals((current) => current.filter((customGoal) => customGoal.id !== goal.id)); setActiveGoals((current) => { const next = new Set(current); next.delete(goal.id); return next; }); setGoalMenuId(null); setNotice(`Removed goal: ${goal.title}.`); }}>Delete goal</button>}</span>}</span></div><h3>{goal.title}</h3><div className="goal-numbers"><strong>{goal.current}</strong><span>of {goal.target}</span><b>{progress}%</b></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="goal-footer"><small>{active ? goal.note : "Goal paused"}</small><button type="button" onClick={() => toggleGoal(goal.id)}>{active ? "Pause" : "Resume"}</button></div></article>;
        })}</div>
      </section>}

      {section === "maintenance" && <section className="feature-section">
        <div className="feature-title-row"><div><p className="eyebrow">Owner tools</p><h2>Maintenance board</h2><p>Three caches need a visit. The proposed route is 18.6 km.</p></div><button type="button" className="primary-button compact-button" onClick={exportMaintenanceRoute}><ArrowDownToLine size={16} /> Export route</button></div>
        <div className="feature-grid maintenance-grid">
          <article className="panel feature-panel maintenance-list">
            <div className="board-summary"><span><strong>3</strong> needs attention</span><span><strong>8</strong> healthy</span><span><strong>1</strong> disabled</span></div>
            {maintenanceItems.map((item) => <label key={item.id} className="maintenance-row"><input type="checkbox" checked={routeStops.has(item.id)} onChange={() => toggleMaintenanceStop(item.id)} /><span className="maintenance-tool"><Wrench size={16} /></span><div><strong>{item.name}</strong><small>{item.code} · Reported {item.age} ago</small><p>{item.issue}</p></div><span className="maintenance-distance">{item.distance}</span></label>)}
          </article>
          <article className="panel feature-panel"><RouteSketch maintenance routePoints={orderedMaintenanceItems} /><div className="route-plan-footer"><div><strong>{routeStops.size} stops selected</strong><small>{routeOptimized ? "Optimized order · " : "Suggested order · "}1 hr 10 min · 18.6 km round trip</small></div><button type="button" className={routeOptimized ? "secondary-button optimized-button" : "secondary-button"} onClick={() => { if (!routeStops.size) { setRouteOptimized(false); setNotice("Select at least one maintenance stop to optimize a route."); return; } const optimized = optimizeMaintenanceStops(orderedMaintenanceItems); setMaintenanceRouteOrder((current) => [...optimized.map((item) => item.id), ...current.filter((id) => !routeStops.has(id))]); setRouteOptimized(true); setNotice(`Optimized the route for ${optimized.length} selected maintenance stops.`); }}><Route size={16} /> {routeOptimized ? "Optimized" : "Optimize"}</button></div></article>
        </div>
      </section>}

      {section === "challenges" && <section className="feature-section">
        <div className="challenge-hero">
          <div><span className="challenge-kicker"><Sparkles size={15} /> August group challenge</span><h2>Find something different</h2><p>Score one point for each cache type. The group is capped at 12 friends, and totals reset on September 1.</p><div className="challenge-meta"><span><Users size={16} /> 8 of 12 joined</span><span><CalendarDays size={16} /> 2 days left</span><span><ListChecks size={16} /> 14 cache types</span></div></div>
          <button type="button" className={joined ? "secondary-button joined-button" : "primary-button"} onClick={() => setJoined(!joined)}>{joined ? <><Check size={16} /> Joined</> : "Join challenge"}</button>
        </div>
        <div className="feature-grid challenge-grid">
          <article className="panel feature-panel leaderboard"><div className="panel-heading"><h2>Leaderboard</h2><span className="quiet-pill">Friends only</span></div>{challengeRows.map((row) => <div key={row.rank} className={`leader-row ${row.name === "You" ? "is-you" : ""}`}><span className="leader-rank">{row.rank}</span><span className="leader-avatar">{row.name.slice(0, 2).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.change}</small></div><strong>{row.finds}<small> pts</small></strong></div>)}</article>
          <article className="panel feature-panel personal-challenge"><p className="eyebrow">Your progress</p><div className="challenge-score"><strong>12</strong><span>of 14 types</span></div><div className="progress-track large"><span style={{ width: "86%" }} /></div><h3>Still missing</h3><div className="missing-types"><span>Letterbox Hybrid</span><span>Wherigo</span></div><p className="muted-copy">Your exact finds stay private. Friends only see your point total.</p></article>
        </div>
      </section>}
    </AppShell>
  );
}
