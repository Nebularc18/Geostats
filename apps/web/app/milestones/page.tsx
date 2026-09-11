"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { MilestonePanel, type MilestoneStats } from "../../components/milestone-panel";
import { getStatsSummary } from "../../lib/api";

export default function MilestonesPage() {
  const [stats, setStats] = useState<MilestoneStats | undefined>();

  useEffect(() => {
    let active = true;
    void getStatsSummary<{ milestoneStats?: MilestoneStats }>()
      .then((data) => {
        if (active) {
          setStats(data.stats.milestoneStats);
        }
      })
      .catch(() => {
        if (active) {
          setStats(undefined);
        }
      });
    return () => {
      active = false;
    };
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
