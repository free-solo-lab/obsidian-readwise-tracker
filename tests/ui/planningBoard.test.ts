import test from "node:test";
import assert from "node:assert/strict";
import type { LocalBook } from "../../src/models/store";
import { getPlanningStatus, getReaderLocation, groupPlanningBooksByTag } from "../../src/ui/planningBoard";

const book = (id: string, status: LocalBook["status"], progress: number, tags: string[] = []): LocalBook => ({
  id,
  title: id,
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status,
  reading_progress: progress,
  tags,
});

test("getPlanningStatus maps tracker states to board columns", () => {
  assert.equal(getPlanningStatus(book("a", "planned", 0)), "planned");
  assert.equal(getPlanningStatus(book("b", "reading", 42)), "reading");
  assert.equal(getPlanningStatus(book("c", "reading", 100)), "completed");
});

test("Reader locations take precedence and map back from board columns", () => {
  assert.equal(getPlanningStatus({ ...book("a", "planned", 0), location: "new" }), "reading");
  assert.equal(getPlanningStatus({ ...book("b", "reading", 50), location: "later" }), "planned");
  assert.equal(getPlanningStatus({ ...book("c", "reading", 20), location: "archive" }), "completed");
  assert.equal(getReaderLocation("planned"), "later");
  assert.equal(getReaderLocation("reading"), "new");
  assert.equal(getReaderLocation("completed"), "archive");
});

test("groupPlanningBooksByTag creates tag swimlanes and an untagged group", () => {
  const groups = groupPlanningBooksByTag([
    book("a", "planned", 0, ["sport", "health"]),
    book("b", "reading", 20, ["sport"]),
    book("c", "completed", 100),
  ], "en");

  assert.deepEqual(groups.map((group) => [group.tag, group.books.map((item) => item.id)]), [
    ["health", ["a"]],
    ["sport", ["a", "b"]],
    [null, ["c"]],
  ]);
});
