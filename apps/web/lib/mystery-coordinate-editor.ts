type EditorElement = {
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  textContent?: string | null;
  parentElement: EditorElement | null;
  closest(selector: string): EditorElement | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): EditorElement | null;
  querySelectorAll(selector: string): Iterable<EditorElement>;
};

type EditorDocument = {
  body: EditorElement;
  getElementById(id: string): EditorElement | null;
  querySelector(selector: string): EditorElement | null;
  querySelectorAll(selector: string): Iterable<EditorElement>;
};

type CoordinateEditor = {
  field: EditorElement;
  container: EditorElement | null;
};

/**
 * Kept self-contained because the userscript route serializes this function.
 */
export function solvedCoordinateEditorFromPage(
  document: EditorDocument,
  isVisible: (element: EditorElement) => boolean,
): CoordinateEditor | null {
  const fieldIsUsable = (field: EditorElement | null) =>
    field &&
    isVisible(field) &&
    !field.disabled &&
    !field.readOnly &&
    !field.closest("#geostats-sync-panel");
  const knownField = document.getElementById("newCoordinates");
  if (fieldIsUsable(knownField)) {
    let knownContainer = knownField?.parentElement || null;
    while (
      knownContainer?.parentElement &&
      knownContainer !== document.body &&
      !knownContainer.querySelector(
        "button, input[type='submit'], .btn-cc-parse",
      )
    ) {
      knownContainer = knownContainer.parentElement;
    }
    return {
      field: knownField!,
      container: knownContainer || knownField?.parentElement || null,
    };
  }

  const fieldSelector =
    "textarea, input:not([type='hidden']):not([type='submit']):not([type='button'])";
  const fields = [...document.querySelectorAll(fieldSelector)];
  for (const field of fields) {
    if (!fieldIsUsable(field)) continue;
    const associatedLabel = field.id
      ? document.querySelector("label[for='" + CSS.escape(field.id) + "']")
      : field.closest("label");
    const fieldDescription = [
      field.id,
      field.name,
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder"),
      field.getAttribute("data-testid"),
      associatedLabel?.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    const fieldHasCoordinateName =
      /change\s*to|solved[^a-z0-9]*coordinate|corrected[^a-z0-9]*coordinate|newcoordinates/i.test(
        fieldDescription,
      );
    let container = field.parentElement;
    for (
      let depth = 0;
      container && container !== document.body && depth < 8;
      depth += 1, container = container.parentElement
    ) {
      const text = (container.textContent || "").replace(/\s+/g, " ");
      const hasSubmit = [
        ...container.querySelectorAll(
          "button, input[type='button'], input[type='submit']",
        ),
      ].some(
        (control) =>
          /^submit$/i.test(
            (control.textContent || control.getAttribute("value") || "").trim(),
          ) && isVisible(control),
      );
      const usableFields = [
        ...container.querySelectorAll(fieldSelector),
      ].filter(fieldIsUsable);
      if (
        /enter solved coordinates/i.test(text) &&
        /change\s*to/i.test(text) &&
        hasSubmit &&
        (fieldHasCoordinateName ||
          (usableFields.length === 1 && usableFields[0] === field))
      ) {
        return { field, container };
      }
    }
  }
  return null;
}
