import assert from "node:assert/strict";
import test from "node:test";
import { clearImportStatusTracking, observeImportStatuses } from "./import-status";

test.beforeEach(() => {
  clearImportStatusTracking();
});

test("observes a completion once even when the screen remounts", () => {
  const scope = "server/account";

  assert.equal(observeImportStatuses(scope, [{ id: "one", status: "PROCESSING" }, { id: "two", status: "PROCESSING" }]), false);
  assert.equal(observeImportStatuses(scope, [{ id: "one", status: "COMPLETED" }, { id: "two", status: "PROCESSING" }]), true);
  assert.equal(observeImportStatuses(scope, [{ id: "one", status: "COMPLETED" }, { id: "two", status: "PROCESSING" }]), false);
});

test("detects a completed import while another import remains active", () => {
  const scope = "server/account";

  observeImportStatuses(scope, [{ id: "one", status: "PROCESSING" }, { id: "two", status: "PROCESSING" }]);
  assert.equal(observeImportStatuses(scope, [{ id: "one", status: "COMPLETED" }, { id: "two", status: "PROCESSING" }]), true);
});

test("a retry can complete again, while an initially completed import is observed", () => {
  const scope = "server/account";

  assert.equal(observeImportStatuses(scope, [{ id: "new", status: "COMPLETED" }]), true);
  assert.equal(observeImportStatuses(scope, [{ id: "new", status: "COMPLETED" }]), false);
  observeImportStatuses(scope, [{ id: "new", status: "QUEUED" }]);
  assert.equal(observeImportStatuses(scope, [{ id: "new", status: "COMPLETED" }]), true);
});

test("different server/account scopes do not share import status", () => {
  observeImportStatuses("server-a/account-a", [{ id: "same", status: "COMPLETED" }]);
  assert.equal(observeImportStatuses("server-b/account-b", [{ id: "same", status: "COMPLETED" }]), true);
});

