export type GeocachingNoteConflict = {
  geocaching: string;
  geostats: string;
};

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
