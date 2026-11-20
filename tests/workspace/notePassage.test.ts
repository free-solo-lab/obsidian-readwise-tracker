import test from "node:test";
import assert from "node:assert/strict";
import {
  containsQuote,
  coveringBlocks,
  notePassage,
  quoteSpans,
  translatedQuoteBlock,
} from "../../src/workspace/notePassage";
import { textBlocks } from "../../src/workspace/focus";
import type { SourceAnchor } from "../../src/workspace/types";

const markdown = "# Title\n\nThe cat sat on the mat.\n\nIt was a *sunny* day, and the birds sang.\n";
const blocks = textBlocks(markdown);
const translated = {
  [blocks[0].key]: "# Заголовок",
  [blocks[1].key]: "Кот сидел на коврике.",
  [blocks[2].key]: "Был солнечный день, и пели птицы.",
};
const anchor = (quote: string, start: number, end: number, manual = false): SourceAnchor => ({
  id: "a",
  nodePath: "note.md",
  quote,
  revision: "r1",
  status: "matched",
  start,
  end,
  candidates: [],
  manual,
  selectedText: manual ? markdown.slice(start, end) : undefined,
});
const original = anchor("sunny day", markdown.indexOf("sunny"), markdown.indexOf("sunny") + 9);
const fromTranslation = anchor("солнечный день", blocks[2].start, blocks[2].end, true);

test("covering blocks are found by binary search over the original's offsets", () => {
  assert.deepEqual(coveringBlocks(blocks, 0, 3).map((b) => b.key), [blocks[0].key]);
  assert.deepEqual(
    coveringBlocks(blocks, blocks[1].start + 2, blocks[2].start + 2).map((b) => b.key),
    [blocks[1].key, blocks[2].key],
  );
  assert.deepEqual(coveringBlocks(blocks, blocks[2].start, blocks[2].start).map((b) => b.key), [blocks[2].key]);
  assert.deepEqual(coveringBlocks(blocks, markdown.length + 5, markdown.length + 9), []);
});

test("a quote is found in a passage regardless of emphasis marks, case and spacing", () => {
  assert.equal(containsQuote("It was a *sunny*  day", "Sunny day"), true);
  assert.equal(containsQuote("It was a sunny day", "rainy"), false);
  assert.equal(containsQuote("abc", "ab"), false);
});

test("a note made in the original shows the translated paragraph while the translation is on screen", () => {
  const base = { blocks, markdown, translated };
  assert.equal(notePassage({ ...base, quote: original.quote, anchor: original, shown: false }), undefined);
  assert.deepEqual(notePassage({ ...base, quote: original.quote, anchor: original, shown: true }), {
    text: "Был солнечный день, и пели птицы.",
    quoteIn: "original",
  });
});

test("a note made in the translation shows the original paragraph while the original is on screen", () => {
  const base = { blocks, markdown, translated };
  assert.deepEqual(
    notePassage({ ...base, quote: fromTranslation.quote, anchor: fromTranslation, shown: false }),
    { text: "It was a *sunny* day, and the birds sang.", quoteIn: "translation" },
  );
  assert.equal(
    notePassage({ ...base, quote: fromTranslation.quote, anchor: fromTranslation, shown: true }),
    undefined,
  );
});

test("without a matched anchor, a translation or a translated block the note keeps its own quote", () => {
  const missing = { ...original, status: "missing" as const, start: undefined, end: undefined };
  assert.equal(notePassage({ quote: "x", anchor: missing, blocks, markdown, translated, shown: true }), undefined);
  assert.equal(notePassage({ quote: "x", anchor: original, blocks, markdown, shown: true }), undefined);
  const partial = { [blocks[1].key]: translated[blocks[1].key] };
  assert.equal(
    notePassage({ quote: original.quote, anchor: original, blocks, markdown, translated: partial, shown: true }),
    undefined,
  );
  // A hand-placed anchor behind the original's own words needs no substitute.
  const manual = anchor("sunny", blocks[2].start, blocks[2].end, true);
  assert.equal(notePassage({ quote: "sunny", anchor: manual, blocks, markdown, translated, shown: false }), undefined);
});

test("a note's translated words lead to the one translated block that holds them", () => {
  assert.equal(translatedQuoteBlock(blocks, translated, "пели птицы")?.key, blocks[2].key);
  assert.equal(translatedQuoteBlock(blocks, translated, "sunny day"), undefined);
  const twice = { ...translated, [blocks[0].key]: "Был солнечный день" };
  assert.equal(translatedQuoteBlock(blocks, twice, "солнечный день"), undefined);
});

test("only the quoted words of a long paragraph are marked, line by line", () => {
  const paragraph = "Intro words here. It was a sunny day, and the birds sang. More text follows.";
  const [span] = quoteSpans(paragraph, "It was a **sunny** day,\nand the birds sang.").slice(0, 1);
  assert.equal(paragraph.slice(span.start, span.end), "It was a sunny day,");
  const spans = quoteSpans(paragraph, "It was a **sunny** day,\nand the birds sang.");
  assert.deepEqual(
    spans.map((item) => paragraph.slice(item.start, item.end)),
    ["It was a sunny day,", "and the birds sang."],
  );
  assert.deepEqual(quoteSpans(paragraph, "Кот сидел"), []);
  // A short line that occurs twice is ambiguous and left unmarked.
  assert.deepEqual(quoteSpans("the cat, the cat", "the cat"), []);
});
