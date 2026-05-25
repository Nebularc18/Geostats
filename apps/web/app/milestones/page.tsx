"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { MilestonePanel, type MilestoneStats } from "../../components/milestone-panel";
import { apiFetch } from "../../lib/api";

export default function MilestonesPage() {
  const [stats, setStats] = useState<MilestoneStats | undefined>();

  useEffect(() => {
    void apiFetch<{ stats: { milestoneStats?: MilestoneStats } }>("/stats/summary").then((data) =>
      setStats(data.stats.milestoneStats)
    );
  }, []);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Progress markers</p>
        <h1>Milestones</h1>
      </header>
      <MilestonePanel stats={stats} />
    </AppShell>
  );
}
