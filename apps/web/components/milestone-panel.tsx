"use client";

type MilestoneEntry = {
  count: number;
  date: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
};

type FirstMilestoneEntry = {
  count: number;
  date: string;
  label: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
};

export type MilestoneStats = {
  countMilestones: MilestoneEntry[];
  firstByCountry: FirstMilestoneEntry[];
  firstByHomeCountryRegion: FirstMilestoneEntry[];
  firstByType: FirstMilestoneEntry[];
  firstBySize: FirstMilestoneEntry[];
  firstByDifficultyTerrain: FirstMilestoneEntry[];
  homeCountry: string | null;
};

const emptyMilestoneStats: MilestoneStats = {
  countMilestones: [],
  firstByCountry: [],
  firstByHomeCountryRegion: [],
  firstByType: [],
  firstBySize: [],
  firstByDifficultyTerrain: [],
  homeCountry: null
};

export function MilestonePanel({ stats }: { stats?: MilestoneStats }) {
  const data = stats ?? emptyMilestoneStats;

  return (
    <section className="panel milestone-panel">
      <div className="panel-heading">
        <h2>Milestones</h2>
        <div className="panel-metrics" aria-label="Milestone summary">
          <span>
            <small>Count marks</small>
            <strong>{data.countMilestones.length}</strong>
          </span>
          <span>
            <small>Countries</small>
            <strong>{data.firstByCountry.length}</strong>
          </span>
          <span>
            <small>Types</small>
            <strong>{data.firstByType.length}</strong>
          </span>
        </div>
      </div>
      <div className="stats-breakdown-grid">
        <CountMilestoneTable entries={data.countMilestones} />
        <FirstMilestoneTable title="First cache by country" label="Country" entries={data.firstByCountry} />
        <FirstMilestoneTable
          title={data.homeCountry ? `First cache by region in ${data.homeCountry}` : "First cache by region"}
          label="Region"
          entries={data.firstByHomeCountryRegion}
        />
        <FirstMilestoneTable title="First cache by type" label="Type" entries={data.firstByType} />
        <FirstMilestoneTable title="First cache by size" label="Size" entries={data.firstBySize} />
        <FirstMilestoneTable title="First cache by difficulty / terrain" label="D/T" entries={data.firstByDifficultyTerrain} />
      </div>
    </section>
  );
}

function CountMilestoneTable({ entries }: { entries: MilestoneEntry[] }) {
  return (
    <section className="mini-table wide-table">
      <h3>Find count milestones</h3>
      <table className="milestone-table count-milestone-table">
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Date</th>
            <th>Interval</th>
            <th>GC Code</th>
            <th>Type</th>
            <th>Cache name</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <CountMilestoneRow entry={entry} key={`${entry.count}-${entry.gcCode}`} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CountMilestoneRow({ entry }: { entry: MilestoneEntry }) {
  return (
    <tr>
      <td>
        <strong>{entry.count}</strong>
      </td>
      <td>{entry.date}</td>
      <td>{entry.intervalDays == null ? "-" : `${entry.intervalDays} days`}</td>
      <td>
        <a href={`https://coord.info/${entry.gcCode}`} rel="noreferrer" target="_blank">
          {entry.gcCode}
        </a>
      </td>
      <td>{entry.cacheType ?? "Unknown"}</td>
      <td>{entry.name}</td>
    </tr>
  );
}

function FirstMilestoneTable({ title, label, entries }: { title: string; label: string; entries: FirstMilestoneEntry[] }) {
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <table className="milestone-table first-milestone-table">
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Date</th>
            <th>{label}</th>
            <th>GC Code</th>
            <th>Type</th>
            <th>Cache name</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <FirstMilestoneRow entry={entry} key={`${label}-${entry.label}-${entry.gcCode}`} />
          ))}
        </tbody>
      </table>
      <div className="mini-table-footer">
        <span>Total</span>
        <strong>{entries.length}</strong>
      </div>
    </section>
  );
}

function FirstMilestoneRow({ entry }: { entry: FirstMilestoneEntry }) {
  return (
    <tr>
      <td>
        <strong>{entry.count}</strong>
      </td>
      <td>{entry.date}</td>
      <td>{entry.label}</td>
      <td>
        <a href={`https://coord.info/${entry.gcCode}`} rel="noreferrer" target="_blank">
          {entry.gcCode}
        </a>
      </td>
      <td>{entry.cacheType ?? "Unknown"}</td>
      <td>{entry.name}</td>
    </tr>
  );
}
