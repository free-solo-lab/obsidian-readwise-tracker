import test from "node:test";
import assert from "node:assert/strict";
import type { LocalBook } from "../../src/models/store";
import { getBookInactivityDays } from "../../src/ui/dashboardHelpers";

const book: LocalBook = {
  id: "book",
  title: "Book",
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
  status: "reading",
  reading_progress: 20,
};

test("getBookInactivityDays uses the latest real reading activity", () => {
  const days = getBookInactivityDays(book, {
    book: {
      "2026-07-15": { minutes: 10, words: 0, progressPoints: 0, events: 1 },
      "2026-07-20": { minutes: 0, words: 0, progressPoints: 0, events: 0 },
    },
  }, new Date("2026-08-04T00:00:00Z"));

  assert.equal(days, 20);
});

test("getBookInactivityDays falls back to the book update date", () => {
  assert.equal(getBookInactivityDays(book, {}, new Date("2026-07-30T00:00:00Z")), 20);
});
