export type ExtremeBadgeKind =
  | "northernmost"
  | "easternmost"
  | "southernmost"
  | "westernmost"
  | "highest"
  | "lowest"
  | "oldest";

const badgeLabels: Record<ExtremeBadgeKind, string> = {
  northernmost: "North",
  easternmost: "East",
  southernmost: "South",
  westernmost: "West",
  highest: "Highest",
  lowest: "Lowest",
  oldest: "Oldest"
};

function BadgeMark({ kind }: { kind: ExtremeBadgeKind }) {
  if (kind === "northernmost" || kind === "easternmost" || kind === "southernmost" || kind === "westernmost") {
    const letter = {
      northernmost: "N",
      easternmost: "E",
      southernmost: "S",
      westernmost: "W"
    }[kind];
    return (
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <text className="extreme-badge-cardinal" x="22" y="29">
          {letter}
        </text>
      </svg>
    );
  }

  if (kind === "highest") {
    return (
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <path d="M5 34 17 13l7 11 4-7 11 17" />
        <path d="M28 12V5m-4 4 4-4 4 4" />
      </svg>
    );
  }

  if (kind === "lowest") {
    return (
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <path d="M5 11c4-3 7-3 11 0s7 3 11 0 7-3 12 0" />
        <path d="M8 17h28M22 18v19m-7-7 7 7 7-7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <path d="M13 6h18M13 38h18M15 7c0 9 7 9 7 15s-7 6-7 15M29 7c0 9-7 9-7 15s7 6 7 15" />
      <path d="M18 13h8M18 32l4-5 4 5" />
    </svg>
  );
}

export function ExtremeBadge({ kind, found }: { kind: ExtremeBadgeKind; found: boolean }) {
  return (
    <span className="extreme-badge-wrap" aria-hidden="true">
      <span className={`extreme-badge extreme-badge-${kind}`}>
        <BadgeMark kind={kind} />
      </span>
      <span className="extreme-badge-ribbon">{badgeLabels[kind]}</span>
      {found ? (
        <span className="extreme-badge-earned">
          <svg viewBox="0 0 16 16">
            <path d="m3 8 3 3 7-7" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
