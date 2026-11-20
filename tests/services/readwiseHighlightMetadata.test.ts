import test from "node:test";
import assert from "node:assert/strict";
import { readHighlightMetadata } from "../../src/services/readwiseHighlightMetadata";

test("legacy invalid YAML recovers index and date without the Obsidian metadata cache", () => {
  const result = readHighlightMetadata("Book — 092", undefined, `---
index: 92
date: 2026-10-23T07:55:00
title: Q: Explain this?
---
> Quote
`);
  assert.equal(result.index, 92);
  assert.equal(result.title, "Q: Explain this?");
  assert.equal(result.date, "2026-10-23T07:55:00");
  assert.ok(Number.isFinite(result.dateTs));
});
test("image titles and quoted string indices cannot remove numbering", () => {
  assert.equal(readHighlightMetadata("Book — 059", { index: "59", title: "![](truncated" }).index, 59);
  assert.equal(readHighlightMetadata("Book — 059", {}).index, 59);
  assert.equal(readHighlightMetadata("Book — 059", { title: "![](truncated" }).title, "Book — 059");
  assert.equal(readHighlightMetadata("Book 2026", {}).index, undefined);
  assert.equal(readHighlightMetadata("Book — 003", { index: NaN }).index, 3);
  assert.equal(readHighlightMetadata("Book — 003", { index: 5, title: "Edited title" }).index, 5);
});
