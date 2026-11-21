import { fieldMergeDecision, mergeMysteryCaches, stableJsonStringify, type MergeableMysteryCache, type MysteryFieldConflict } from "@geostats/shared";

export type MysterySyncField = "notes" | "fieldNotes" | "image";
const fields: readonly MysterySyncField[] = ["notes", "fieldNotes", "image"];

export function mysteryFieldFingerprints(cache: MergeableMysteryCache, fingerprint: (value: string) => string) {
  return Object.fromEntries(fields.map((field) => [
    field, fingerprint(stableJsonStringify(cache[field] ?? (field === "image" ? null : "")))
  ])) as Record<MysterySyncField, string>;
}

function retainDeviceEdits<T>(
  server: T,
  ...copies: Array<MysteryFieldConflict<T> | undefined>
): MysteryFieldConflict<T> | undefined {
  const choices = [...new Set(copies.flatMap((copy) => copy ? [copy.device, ...(copy.otherDeviceEdits ?? [])] : []))]
    .filter((value) => value !== server);
  return choices.length ? { server, device: choices[0]!, ...(choices.length > 1 && { otherDeviceEdits: choices.slice(1) }) } : undefined;
}

export function mergeDeviceMystery<T extends MergeableMysteryCache>(
  server: T,
  device: T,
  fingerprint: (value: string) => string,
  baseline?: Partial<Record<MysterySyncField, string>>
): T {
  const fromDevice = mysteryFieldFingerprints(device, fingerprint);
  const fromServer = mysteryFieldFingerprints(server, fingerprint);
  const decisions = fields.map((field) => baseline?.[field]
    ? fieldMergeDecision(fromDevice[field], fromServer[field], baseline[field])
    : { preferIncoming: false, preserveConflict: fromDevice[field] !== fromServer[field] }
  );
  const [notes, fieldNotes, image] = decisions;
  const merged = mergeMysteryCaches(server, device, {
    preferIncomingNotes: notes.preferIncoming,
    preferIncomingFieldNotes: fieldNotes.preferIncoming,
    preferIncomingImage: image.preferIncoming,
    preserveNotesConflict: notes.preserveConflict,
    preserveFieldNotesConflict: fieldNotes.preserveConflict,
    preserveImageConflict: image.preserveConflict
  });
  // Older Android releases could leave multiple copies for the same code.
  // Keep each distinct device value available under the account workspace.
  const syncConflicts = {
    notes: retainDeviceEdits(merged.notes, merged.syncConflicts?.notes, device.syncConflicts?.notes, server.syncConflicts?.notes),
    fieldNotes: retainDeviceEdits(merged.fieldNotes ?? "", merged.syncConflicts?.fieldNotes, device.syncConflicts?.fieldNotes, server.syncConflicts?.fieldNotes),
    image: retainDeviceEdits(merged.image ?? null, merged.syncConflicts?.image, device.syncConflicts?.image, server.syncConflicts?.image)
  };
  return {
    ...merged, id: server.id, sharedWith: server.sharedWith,
    syncConflicts: Object.values(syncConflicts).some(Boolean) ? syncConflicts : undefined
  };
}
