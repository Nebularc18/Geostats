export type GeocachingNoteConflict = {
  geocaching: string;
  geostats: string;
};

export type GeocachingNoteConflictChoice =
  | { notes: string; conflict: null; outcome: "geocaching" | "geostats" }
  | { notes: string; conflict: GeocachingNoteConflict; outcome: "stale" };

export function reconcileGeocachingNoteReceipt(
  currentNotes: string,
  sentNotes: string,
  geocachingNotes: string,
): { notes: string; conflict: GeocachingNoteConflict | null } {
  if (currentNotes !== sentNotes) {
    return {
      notes: currentNotes,
      conflict: { geocaching: geocachingNotes, geostats: currentNotes },
    };
  }
  return { notes: geocachingNotes, conflict: null };
}

export function chooseGeocachingNoteConflict(
  currentNotes: string,
  conflict: GeocachingNoteConflict,
  useGeocaching: boolean,
): GeocachingNoteConflictChoice {
  if (!useGeocaching) {
    return { notes: currentNotes, conflict: null, outcome: "geostats" };
  }
  if (currentNotes !== conflict.geostats) {
    return {
      notes: currentNotes,
      conflict: { ...conflict, geostats: currentNotes },
      outcome: "stale",
    };
  }
  return { notes: conflict.geocaching, conflict: null, outcome: "geocaching" };
}
