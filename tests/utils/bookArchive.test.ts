import test from "node:test";
import assert from "node:assert/strict";
import { isArchivedBook, matchesArchiveFilter } from "../../src/utils/bookArchive";

test("archive location and completed status count as archived", () => {
  assert.equal(isArchivedBook({ location: "archive", status: "reading" }), true);
  assert.equal(isArchivedBook({ location: "new", status: "completed" }), true);
  assert.equal(isArchivedBook({ location: "later", status: "planned" }), false);
});

test("filter splits archived from active books", () => {
  const archived = { location: "archive" as const, status: "completed" as const };
  const active = { location: "new" as const, status: "reading" as const };
  assert.equal(matchesArchiveFilter(archived, "all"), true);
  assert.equal(matchesArchiveFilter(active, "all"), true);
  assert.equal(matchesArchiveFilter(archived, "archive"), true);
  assert.equal(matchesArchiveFilter(active, "archive"), false);
  assert.equal(matchesArchiveFilter(active, "active"), true);
  assert.equal(matchesArchiveFilter(archived, "active"), false);
});
