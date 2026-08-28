type NoteElement = {
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  textContent?: string | null;
  parentElement: NoteElement | null;
  closest(selector: string): NoteElement | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): NoteElement | null;
  querySelectorAll(selector: string): Iterable<NoteElement>;
};

type NoteDocument = {
  body: NoteElement;
  getElementById(id: string): NoteElement | null;
  querySelector(selector: string): NoteElement | null;
  querySelectorAll(selector: string): Iterable<NoteElement>;
};

export type PersonalCacheNote = {
  available: boolean;
  note: string;
};

export type PersonalCacheNoteEditor = {
  field: NoteElement;
  container: NoteElement | null;
  save: NoteElement | null;
};

/** Kept self-contained because the userscript route serializes this function. */
export function personalCacheNoteFromPage(document: NoteDocument): PersonalCacheNote {
  const knownIds = ["srOnlyCacheNote", "viewCacheNote", "cache_note"];
  for (const id of knownIds) {
    const element = document.getElementById(id);
    if (!element) continue;
    const text = (element.textContent || "").replace(/\r\n?/g, "\n").trim();
    return {
      available: true,
      note: /^(click|tap) to (enter|add) (a )?(personal )?(cache )?note[.!]?$/i.test(text) ? "" : text,
    };
  }
  return { available: false, note: "" };
}

/** Kept self-contained because the userscript route serializes this function. */
export function personalCacheNoteEditorFromPage(
  document: NoteDocument,
  isVisible: (element: NoteElement) => boolean,
): PersonalCacheNoteEditor | null {
  const fieldSelector = "textarea, input:not([type='hidden']):not([type='submit']):not([type='button'])";
  const fields = [...document.querySelectorAll(fieldSelector)];
  for (const field of fields) {
    if (!isVisible(field) || field.disabled || field.readOnly || field.closest("#geostats-note-sync-panel")) continue;
    const associatedLabel = field.id
      ? document.querySelector("label[for='" + CSS.escape(field.id) + "']")
      : field.closest("label");
    const description = [
      field.id,
      field.name,
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder"),
      field.getAttribute("data-testid"),
      associatedLabel?.textContent,
    ].filter(Boolean).join(" ");
    const namedAsNote = /personal[^a-z0-9]*cache[^a-z0-9]*note|personal[^a-z0-9]*note|cache[^a-z0-9]*note/i.test(description);
    let container = field.parentElement;
    for (let depth = 0; container && container !== document.body && depth < 8; depth += 1, container = container.parentElement) {
      const text = (container.textContent || "").replace(/\s+/g, " ");
      const controls = [...container.querySelectorAll("button, input[type='button'], input[type='submit']")];
      const save = controls.find((control) =>
        /^(save|update)$/i.test((control.textContent || control.getAttribute("value") || "").trim()) && isVisible(control)
      ) || null;
      const usableFields = [...container.querySelectorAll(fieldSelector)].filter((candidate) =>
        isVisible(candidate) && !candidate.disabled && !candidate.readOnly
      );
      if ((namedAsNote || /personal cache note/i.test(text)) && save && (namedAsNote || (usableFields.length === 1 && usableFields[0] === field))) {
        return { field, container, save };
      }
    }
  }
  return null;
}
