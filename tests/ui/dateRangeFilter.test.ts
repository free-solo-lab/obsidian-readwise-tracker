import test from "node:test";
import assert from "node:assert/strict";
import type { LocalBook } from "../../src/models/store";
import { hasBookActivityInRange, isDateKeyInRange, resolveHeatmapDateRange } from "../../src/ui/dateRangeFilter";

const book: LocalBook = {
  id: "book",
  title: "Book",
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-03-15T00:00:00Z",
  reading_progress: 50,
  status: "reading",
};

test("isDateKeyInRange supports closed and open ranges", () => {
  assert.equal(isDateKeyInRange("2026-03-10", { from: "2026-03-01", to: "2026-03-10" }), true);
  assert.equal(isDateKeyInRange("2026-02-28", { from: "2026-03-01", to: "" }), false);
  assert.equal(isDateKeyInRange("2026-04-01", { from: "", to: "2026-03-31" }), false);
});

test("hasBookActivityInRange prefers activity history", () => {
  assert.equal(hasBookActivityInRange(book, {
    "2026-02-10": { minutes: 20, words: 0, progressPoints: 0, events: 1 },
  }, { from: "2026-02-01", to: "2026-02-28" }), true);
  assert.equal(hasBookActivityInRange(book, {
    "2026-02-10": { minutes: 20, words: 0, progressPoints: 0, events: 1 },
  }, { from: "2026-03-01", to: "2026-03-31" }), false);
});

test("hasBookActivityInRange falls back to updated date without activity", () => {
  assert.equal(hasBookActivityInRange(book, {}, { from: "2026-03-01", to: "2026-03-31" }), true);
});

test("resolveHeatmapDateRange uses the selected inclusive period", () => {
  const result = resolveHeatmapDateRange(
    { from: "2026-02-01", to: "2026-03-10" },
    new Date(2026, 6, 12),
  );
  assert.equal(result.start.getFullYear(), 2026);
  assert.equal(result.start.getMonth(), 1);
  assert.equal(result.start.getDate(), 1);
  assert.equal(result.end.getMonth(), 2);
  assert.equal(result.end.getDate(), 10);
});
