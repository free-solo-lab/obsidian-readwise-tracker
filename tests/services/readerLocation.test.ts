import test from "node:test";
import assert from "node:assert/strict";
import type { LocalBook } from "../../src/models/store";
import { applyReaderLocation, reconcilePendingReaderLocation } from "../../src/services/readerLocation";

const book: LocalBook = {
  id: "book",
  title: "Book",
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  status: "reading",
  reading_progress: 50,
  location: "new",
};

test("applyReaderLocation maps archive to completed", () => {
  assert.deepEqual(applyReaderLocation(book, "archive", "2026-08-11T00:00:00Z"), {
    ...book,
    location: "archive",
    status: "completed",
    updated_at: "2026-08-11T00:00:00Z",
  });
});

test("pending location protects a local move from a stale sync response", () => {
  const result = reconcilePendingReaderLocation(book, "archive", "2026-08-11T00:00:00Z");
  assert.equal(result.confirmed, false);
  assert.equal(result.book.location, "archive");
  assert.equal(result.book.status, "completed");
});

test("pending location is confirmed when sync returns the requested location", () => {
  const result = reconcilePendingReaderLocation({ ...book, location: "archive" }, "archive");
  assert.equal(result.confirmed, true);
  assert.equal(result.book.location, "archive");
});
