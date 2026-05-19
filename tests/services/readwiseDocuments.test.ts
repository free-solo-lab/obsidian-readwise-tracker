import test from "node:test";
import assert from "node:assert/strict";
import { getDocumentTitle, isPdfDocument, isTopLevelReadingDocument } from "../../src/services/readwiseDocuments";

test("getDocumentTitle prefers explicit title", () => {
  assert.equal(
    getDocumentTitle({
      id: "1",
      title: "Deep Work",
      source_url: "https://example.com/fallback",
    }),
    "Deep Work",
  );
});

test("getDocumentTitle falls back to hostname", () => {
  assert.equal(
    getDocumentTitle({
      id: "1",
      source_url: "https://example.com/article",
    }),
    "example.com",
  );
});

test("isTopLevelReadingDocument rejects child highlights and changelog", () => {
  assert.equal(
    isTopLevelReadingDocument({
      id: "1",
      title: "Readwise & Reader Changelog",
    }),
    false,
  );
  assert.equal(
    isTopLevelReadingDocument({
      id: "2",
      title: "Child note",
      parent_id: "root",
    }),
    false,
  );
});

test("isTopLevelReadingDocument accepts regular reading documents", () => {
  assert.equal(
    isTopLevelReadingDocument({
      id: "1",
      title: "Thinking, Fast and Slow",
      category: "books",
    }),
    true,
  );
});

test("isPdfDocument detects pdf-like documents", () => {
  assert.equal(
    isPdfDocument({
      id: "pdf-1",
      title: "Paper.pdf",
    }),
    true,
  );
  assert.equal(
    isPdfDocument({
      id: "pdf-2",
      category: "pdf",
      title: "Paper",
    }),
    true,
  );
  assert.equal(
    isPdfDocument({
      id: "book-1",
      category: "books",
      title: "Deep Work",
    }),
    false,
  );
});
