import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_SYNC_MIN_PERIOD_MS, isAutoSyncDue } from "../../src/plugin/autoSync";

test("isAutoSyncDue returns true when there is no previous sync", () => {
  assert.equal(isAutoSyncDue(null), true);
});

test("isAutoSyncDue returns false inside the 12-hour quiet period", () => {
  const now = Date.UTC(2026, 3, 5, 12, 0, 0);
  const elevenHoursAgo = new Date(now - 11 * 60 * 60 * 1000).toISOString();
  assert.equal(isAutoSyncDue(elevenHoursAgo, now), false);
});

test("isAutoSyncDue returns true after the 12-hour quiet period", () => {
  const now = Date.UTC(2026, 3, 5, 12, 0, 0);
  const dueSync = new Date(now - AUTO_SYNC_MIN_PERIOD_MS).toISOString();
  assert.equal(isAutoSyncDue(dueSync, now), true);
});
