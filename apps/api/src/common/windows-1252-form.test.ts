import assert from "node:assert/strict";
import test from "node:test";
import { parseWindows1252Form } from "./windows-1252-form";

test("parses GSAK Windows-1252 form fields without corrupting Scandinavian text", () => {
  const form = Buffer.from("kind=caches&name=R%F6se+vid+%C5n&note=%93G%F6mma%94+%80", "ascii");

  assert.deepEqual(parseWindows1252Form(form), {
    kind: "caches",
    name: "Röse vid Ån",
    note: "“Gömma” €"
  });
});

test("preserves repeated form fields", () => {
  assert.deepEqual(parseWindows1252Form(Buffer.from("value=ett&value=tv%E5", "ascii")), {
    value: ["ett", "två"]
  });
});
