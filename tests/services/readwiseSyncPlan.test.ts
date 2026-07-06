import assert from "node:assert/strict";
import test from "node:test";
import { createRegularSyncPlan } from "../../src/services/readwiseSyncPlan";

test("createRegularSyncPlan uses configured locations for bootstrap", () => {
  assert.deepEqual(createRegularSyncPlan(null, ["new", "later"]), {
    mode: "bootstrap",
    requests: [{ location: "new" }, { location: "later" }],
  });
});

test("createRegularSyncPlan preserves legacy all-location bootstrap", () => {
  assert.deepEqual(createRegularSyncPlan(null, []), {
    mode: "bootstrap",
    requests: [{ location: undefined }],
  });
});

test("createRegularSyncPlan uses an overlapping unscoped incremental request", () => {
  assert.deepEqual(
    createRegularSyncPlan("2026-07-06T12:00:00.000Z", ["new", "later"]),
    {
      mode: "incremental",
      requests: [{ updatedAfter: "2026-07-06T11:55:00.000Z" }],
    },
  );
});

test("createRegularSyncPlan treats malformed lastSync as bootstrap", () => {
  assert.equal(createRegularSyncPlan("not-a-date", ["shortlist"]).mode, "bootstrap");
});
