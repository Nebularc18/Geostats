import assert from "node:assert/strict";
import test from "node:test";
import { solvedCoordinateEditorFromPage } from "./mystery-coordinate-editor.ts";

const FIELD_SELECTOR =
  "textarea, input:not([type='hidden']):not([type='submit']):not([type='button'])";
const CONTROL_SELECTOR = "button, input[type='button'], input[type='submit']";

type FixtureElement = {
  kind: "body" | "div" | "input" | "button";
  id: string;
  name: string;
  disabled: boolean;
  readOnly: boolean;
  textContent: string;
  visible: boolean;
  parentElement: FixtureElement | null;
  children: FixtureElement[];
  attributes: Record<string, string>;
  append(...children: FixtureElement[]): FixtureElement;
  closest(selector: string): FixtureElement | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureElement | null;
  querySelectorAll(selector: string): FixtureElement[];
};

function element(
  kind: "body" | "div" | "input" | "button",
  options: {
    id?: string;
    text?: string;
    visible?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    attributes?: Record<string, string>;
  } = {},
): FixtureElement {
  const node: FixtureElement = {
    kind,
    id: options.id || "",
    name: options.attributes?.name || "",
    disabled: options.disabled || false,
    readOnly: options.readOnly || false,
    textContent: options.text || "",
    visible: options.visible !== false,
    parentElement: null as FixtureElement | null,
    children: [] as FixtureElement[],
    attributes: options.attributes || {},
    append(...children: FixtureElement[]) {
      for (const child of children) {
        child.parentElement = node;
        node.children.push(child);
      }
      return node;
    },
    closest(selector: string): FixtureElement | null {
      for (
        let current: FixtureElement | null = node;
        current;
        current = current.parentElement
      ) {
        if (
          selector === "#geostats-sync-panel" &&
          current.id === "geostats-sync-panel"
        )
          return current;
        if (
          selector === "label" &&
          current.kind === "div" &&
          current.attributes.role === "label"
        )
          return current;
      }
      return null;
    },
    getAttribute(name: string) {
      return node.attributes[name] || null;
    },
    querySelector(selector: string) {
      return node.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector: string): FixtureElement[] {
      const descendants = node.children.flatMap((child) => [
        child,
        ...child.querySelectorAll("*"),
      ]);
      if (selector === "*") return descendants;
      if (selector === FIELD_SELECTOR)
        return descendants.filter(
          (child) =>
            child.kind === "input" && child.attributes.type !== "hidden",
        );
      if (
        selector === CONTROL_SELECTOR ||
        selector === "button, input[type='submit'], .btn-cc-parse"
      ) {
        return descendants.filter((child) => child.kind === "button");
      }
      return [];
    },
  };
  return node;
}

function documentFixture(body: FixtureElement) {
  const all = () => [body, ...body.querySelectorAll("*")];
  return {
    body,
    getElementById(id: string) {
      return all().find((node) => node.id === id) || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector: string) {
      return body.querySelectorAll(selector);
    },
  };
}

const isVisible = (node: object) =>
  !("visible" in node) || node.visible !== false;

test("selects the sole visible field from the solved-coordinate popup and returns that popup", () => {
  const hiddenField = element("input", { visible: false });
  const coordinateField = element("input");
  const inner = element("div").append(hiddenField, coordinateField);
  const submit = element("button", { text: "Submit" });
  const popup = element("div", {
    text: "Enter solved coordinates Original: N 37 Change To:",
  }).append(inner, submit);
  const body = element("body").append(popup);

  const editor = solvedCoordinateEditorFromPage(
    documentFixture(body),
    isVisible,
  );

  assert.equal(editor?.field, coordinateField);
  assert.equal(editor?.container, popup);
});

test("rejects an unnamed fallback when the popup has more than one visible editable field", () => {
  const coordinateField = element("input");
  const unrelatedField = element("input");
  const submit = element("button", { text: "Submit" });
  const popup = element("div", {
    text: "Enter solved coordinates Change To:",
  }).append(coordinateField, unrelatedField, submit);
  const body = element("body").append(popup);

  assert.equal(
    solvedCoordinateEditorFromPage(documentFixture(body), isVisible),
    null,
  );
});

test("rejects a field inside the sync panel even when its surrounding text matches", () => {
  const coordinateField = element("input");
  const submit = element("button", { text: "Submit" });
  const panel = element("div", {
    id: "geostats-sync-panel",
    text: "Enter solved coordinates Change To:",
  }).append(coordinateField, submit);
  const body = element("body").append(panel);

  assert.equal(
    solvedCoordinateEditorFromPage(documentFixture(body), isVisible),
    null,
  );
});
