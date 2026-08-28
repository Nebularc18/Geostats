import assert from "node:assert/strict";
import test from "node:test";
import { personalCacheNoteEditorFromPage, personalCacheNoteFromPage } from "./mystery-personal-note.ts";

const FIELD_SELECTOR = "textarea, input:not([type='hidden']):not([type='submit']):not([type='button'])";
const CONTROL_SELECTOR = "button, input[type='button'], input[type='submit']";

type FixtureElement = {
  kind: "body" | "div" | "textarea" | "button";
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

function element(kind: FixtureElement["kind"], options: { id?: string; text?: string; attributes?: Record<string, string> } = {}): FixtureElement {
  const node: FixtureElement = {
    kind,
    id: options.id || "",
    name: options.attributes?.name || "",
    disabled: false,
    readOnly: false,
    textContent: options.text || "",
    visible: true,
    parentElement: null,
    children: [],
    attributes: options.attributes || {},
    append(...children) {
      for (const child of children) {
        child.parentElement = node;
        node.children.push(child);
      }
      return node;
    },
    closest(selector) {
      for (let current: FixtureElement | null = node; current; current = current.parentElement) {
        if (selector === "#geostats-note-sync-panel" && current.id === "geostats-note-sync-panel") return current;
        if (selector === "label" && current.attributes.role === "label") return current;
      }
      return null;
    },
    getAttribute(name) {
      return node.attributes[name] || null;
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const descendants = node.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      if (selector === "*") return descendants;
      if (selector === FIELD_SELECTOR) return descendants.filter((child) => child.kind === "textarea");
      if (selector === CONTROL_SELECTOR) return descendants.filter((child) => child.kind === "button");
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

test("reads the current personal cache note", () => {
  const body = element("body").append(element("div", { id: "srOnlyCacheNote", text: "A = 4\nBring a magnet" }));
  assert.deepEqual(personalCacheNoteFromPage(documentFixture(body)), { available: true, note: "A = 4\nBring a magnet" });
});

test("recognizes an empty personal cache note", () => {
  const body = element("body").append(element("div", { id: "viewCacheNote", text: "Click to enter a note" }));
  assert.deepEqual(personalCacheNoteFromPage(documentFixture(body)), { available: true, note: "" });
});

test("finds a labeled personal note editor and its save button", () => {
  const field = element("textarea", { attributes: { "aria-label": "Personal cache note" } });
  const save = element("button", { text: "Save" });
  const popup = element("div", { text: "Personal Cache Note" }).append(field, save);
  const body = element("body").append(popup);
  const editor = personalCacheNoteEditorFromPage(documentFixture(body), (node) => !("visible" in node) || node.visible !== false);
  assert.equal(editor?.field, field);
  assert.equal(editor?.save, save);
});

test("does not mistake the Geostats panel for Geocaching's note editor", () => {
  const field = element("textarea", { attributes: { "aria-label": "Personal cache note" } });
  const save = element("button", { text: "Save" });
  const panel = element("div", { id: "geostats-note-sync-panel", text: "Personal Cache Note" }).append(field, save);
  const body = element("body").append(panel);
  assert.equal(personalCacheNoteEditorFromPage(documentFixture(body), (node) => !("visible" in node) || node.visible !== false), null);
});
