import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkedHighlightNoteContent,
  parseHighlightNote,
  parseReadwiseHighlightsFromMarkdown,
} from "../../src/services/readwiseHighlightParsing";

test("parseHighlightNote extracts quote and description", () => {
  const parsed = parseHighlightNote(`---
type: highlight
---

> Quote line one
> Quote line two

My description
`);

  assert.equal(parsed.quote, "Quote line one\nQuote line two");
  assert.equal(parsed.description, "My description");
});

test("parseReadwiseHighlightsFromMarkdown parses markdown export blocks", () => {
  const highlights = parseReadwiseHighlightsFromMarkdown(`# Book

## Highlights
> Highlight one
>> Comment one
📅 2026-03-24, 10:30
---
> Highlight two
`);

  assert.equal(highlights.length, 2);
  assert.equal(highlights[0].comment, "Comment one");
  assert.equal(highlights[0].date, "2026-03-24T10:30:00");
});

test("buildLinkedHighlightNoteContent adds navigation and metadata", () => {
  const content = buildLinkedHighlightNoteContent({
    bookTitle: "Deep Work",
    index: 2,
    total: 3,
    text: "A useful highlight",
    comment: "My note",
    date: "2026-03-24T10:30:00",
  });

  assert.match(content, /type: highlight/);
  assert.match(content, /\[\[Deep Work — 001\]\]/);
  assert.match(content, /\[\[Deep Work — 003\]\]/);
  assert.match(content, /My note/);
});
