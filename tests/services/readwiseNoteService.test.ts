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
test('exported Reader locations and original highlight links survive migration',()=>{
  const [parsed]=parseReadwiseHighlightsFromMarkdown('## Highlights\n> Quote\n🔗 [Original](https://read.readwise.io/read/book#highlight-abc)\n📍 Location: 123');
  assert.equal(parsed.sourceUrl,'https://read.readwise.io/read/book#highlight-abc');assert.equal(parsed.readerHighlightId,'abc');assert.equal(parsed.readerOffset,123);
  const note=buildLinkedHighlightNoteContent({bookTitle:'Book',index:1,total:1,...parsed});
  assert.match(note,/rwt_source_url:/);assert.match(note,/rwt_reader_offset: 123/);
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

test("image, surrounding paragraphs and a multiline LLM exchange stay in one highlight", () => {
  const parsed = parseReadwiseHighlightsFromMarkdown(`## Highlights
---
> Text before image
![](https://example.test/diagram.png)
Caption after image
> Final paragraph

>> Q: Explain this diagram?
>   A: First answer paragraph
>
>   ## Details
>   Another paragraph

📅 *2026-10-23, 07:55*
🔗 [View Highlight](https://example.test/highlight)
---
> Next highlight
`);
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].text, /Text before image\n!\[\]\(https:\/\/example.test\/diagram.png\)\nCaption after image\nFinal paragraph/);
  assert.doesNotMatch(parsed[0].text, /A:|View Highlight/);
  assert.match(parsed[0].comment, /Q: Explain this diagram\?\n {2}A: First answer paragraph/);
  const linked = buildLinkedHighlightNoteContent({ bookTitle: "Book: images", index: 1, total: 2, ...parsed[0], locale: "en" });
  const restored = parseHighlightNote(linked);
  assert.equal(restored.quote, parsed[0].text);
  assert.equal(restored.description, parsed[0].comment);
});

test("linked metadata safely quotes questions, Markdown and wiki links", () => {
  for (const title of ['Q: What is entropy?', 'A "quoted" question: why?', '[an unusual title]', '# Heading']) {
    const content = buildLinkedHighlightNoteContent({ bookTitle: "Book: [one]", index: 2, total: 3, text: "Quote", comment: title, date: "2026-10-23T07:55:00" });
    const value = (key: string): unknown => {
      const match = content.match(new RegExp(`^${key}: (.*)$`, "m"));
      assert.ok(match);
      return JSON.parse(match[1]);
    };
    assert.equal(value("title"), title);
    assert.equal(value("book"), "[[Book: [one]]]");
    assert.equal(value("date"), "2026-10-23T07:55:00");
  }
});

test("image-only notes have a readable title, sequence links and preserved image", () => {
  const content = buildLinkedHighlightNoteContent({ bookTitle: "Book", index: 2, total: 3, text: "![](https://example.test/figure.png)", comment: "", date: "", locale: "en" });
  assert.match(content, /title: "Image highlight"/);
  assert.match(content, /← \[\[Book — 001\]\]/);
  assert.match(content, /→ \[\[Book — 003\]\]/);
  assert.equal(parseHighlightNote(content).quote, "![](https://example.test/figure.png)");
  assert.equal(parseHighlightNote(content).description, "");
});

test("legacy Q/A notes recover the answer as a comment without truncating its headings", () => {
  const parsed = parseHighlightNote(`---
title: Q: Why?
index: 9
---
> Original text
> A: Answer

Q: Why?

## Details
Explanation

## Links
[[Book]]
`);
  assert.equal(parsed.quote, "Original text");
  assert.equal(parsed.description, "Q: Why?\n\n## Details\nExplanation\nA: Answer");
});
