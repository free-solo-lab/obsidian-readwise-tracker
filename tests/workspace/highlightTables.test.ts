import test from "node:test";
import assert from "node:assert/strict";
import {
  HighlightTableIndex,
  readHighlightTables,
} from "../../src/workspace/highlightTables";
import { markdownTable } from "../../src/workspace/tables";
import {
  buildLinkedHighlightNoteContent,
  parseHighlightNote,
} from "../../src/services/readwiseHighlightParsing";
import { buildReadwiseInboxNoteContent } from "../../src/services/readwiseInboxNoteTemplate";
import { DocumentSourceResolver } from "../../src/workspace/source";
import { WorkspaceRepository } from "../../src/workspace/repository";
import { MemoryVault, doc } from "./memory";

const rows = [
  ["Model", "Size (# parameters)", "Training tokens"].map((text) => ({
    text,
    header: true,
  })),
  ["LaMDA (2022)", "137 billion", "168 billion"].map((text) => ({ text })),
  ["GPT-3 (2020)", "175 billion", "300 billion"].map((text) => ({ text })),
  ["Chinchilla", "70 billion", "1.4 trillion"].map((text) => ({ text })),
];
const table = markdownTable(rows);
const flat = rows
  .flat()
  .map((cell) => cell.text)
  .join("\n");
const index = () =>
  new HighlightTableIndex(
    readHighlightTables("Caption outside the selection.\n\n" + table).tables,
  );

test("a flat table highlight gains columns without copying the caption or removing its trailing note", () => {
  const quote = flat + "\nПримечание";
  assert.equal(index().format(quote), table + "\n\nПримечание");
  const note = buildLinkedHighlightNoteContent({
    bookTitle: "Book",
    index: 2,
    total: 3,
    text: index().format(quote),
    titleText: quote,
    comment: "Q: Compare?\nA: My earlier answer.",
    date: "2026-11-12",
    sourceUrl: "https://read.readwise.io/read/book#highlight-one",
  });
  assert.equal(parseHighlightNote(note).quote, table + "\n\nПримечание");
  assert.equal(
    parseHighlightNote(note).description,
    "Q: Compare?\nA: My earlier answer.",
  );
  assert.match(note, /Book — 001/);
  assert.match(note, /Book — 003/);
  assert.match(note, /rwt_source_url:/);
  assert.doesNotMatch(note.match(/^title:.*$/m)?.[0] || "", /\|/);
});

test("complete selected body rows keep only selected values, with no invented column names", () => {
  const selected = rows
    .slice(1, 3)
    .flat()
    .map((cell) => cell.text)
    .join("\n");
  assert.equal(index().format(selected), markdownTable(rows.slice(1, 3)));
  assert.doesNotMatch(
    index().format(selected),
    /Chinchilla|Size \(# parameters\)/,
  );
});

test("an incomplete row, a changed value and a single isolated row remain verbatim", () => {
  for (const quote of [
    flat.replace("137 billion", "136 billion"),
    rows[1].map((cell) => cell.text).join("\n") + "\nMy note",
    rows
      .slice(1, 3)
      .flat()
      .slice(0, -1)
      .map((cell) => cell.text)
      .join("\n"),
  ])
    assert.equal(index().format(quote), quote);
});

test("ambiguous column layouts with the same cells are not guessed", () => {
  const alternate = Array.from({ length: 6 }, (_, i) =>
    rows
      .flat()
      .slice(i * 2, i * 2 + 2)
      .map((cell) => ({ text: cell.text })),
  );
  const ambiguous = new HighlightTableIndex([
    { text: flat, markdown: table, rows },
    { text: flat, markdown: markdownTable(alternate), rows: alternate },
  ]);
  assert.equal(ambiguous.format(flat), flat);
});

test("formatted Markdown, HTML tables and literal fenced examples are never nested in another table", () => {
  const html =
    "<table>\n<tr><td>" +
    flat.split("\n").join("</td>\n<td>") +
    "</td></tr>\n</table>";
  for (const quote of [table, html, "```text\n" + flat + "\n```"])
    assert.equal(index().format(quote), quote);
});

test("several tables preserve the surrounding question and distinct cell values", () => {
  const secondRows = rows.map((row) =>
    row.map((cell) => ({ ...cell, text: "Second " + cell.text })),
  );
  const second = markdownTable(secondRows),
    secondFlat = secondRows
      .flat()
      .map((cell) => cell.text)
      .join("\n");
  const formatter = new HighlightTableIndex(
    readHighlightTables(table + "\n\n" + second).tables,
  );
  const quote =
    "Before\n\n" + flat + "\n\nBetween\n\n" + secondFlat + "\n\nAfter";
  assert.equal(
    formatter.format(quote),
    quote.replace(flat, table).replace(secondFlat, second),
  );
});

test("the table parser handles escaped cell pipes and skips fenced table source", () => {
  const source =
    "```md\n" +
    table +
    "\n```\n\n| Name | Value |\n| --- | ---: |\n| Left \\| right | 12345 |\n| Other value | 67890 |";
  const parsed = readHighlightTables(source);
  assert.equal(parsed.tables.length, 1);
  assert.equal(parsed.tables[0].rows?.[1][0].text, "Left \\| right");
  assert.equal(parsed.tables[0].rows?.[0][1].align, "right");
});

test("an Inbox copy keeps a restored quote, reader commentary and the original note link", () => {
  const content = buildReadwiseInboxNoteContent({
    title: "Thought",
    created: "2026-11-12",
    bookLink: "[[Book]]",
    sourceLink: "[[Original highlight]]",
    quote: index().format(flat),
    description: "My own conclusion.",
  });
  assert.equal(parseHighlightNote(content).quote, table);
  assert.equal(parseHighlightNote(content).description, "My own conclusion.");
  assert.match(content, /source: "\[\[Original highlight\]\]"/);
});

test("batch import reuses offline book content and does not fetch a book for ordinary prose", async () => {
  class Tracked extends MemoryVault {
    reads = 0;
    async read(path: string) {
      if (path === "Full.md") this.reads++;
      return super.read(path);
    }
  }
  const vault = new Tracked(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("Full.md", table);
  await repo.saveSource(doc, { contentPath: "Full.md", tableFormat: 1 });
  let requests = 0;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        requests++;
        return undefined;
      },
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
  );
  assert.deepEqual(
    await resolver.formatHighlightQuotes(
      doc,
      [flat, "A normal paragraph."],
      false,
    ),
    [table, "A normal paragraph."],
  );
  assert.deepEqual(await resolver.formatHighlightQuotes(doc, [flat], false), [
    table,
  ]);
  assert.equal(vault.reads, 1);
  const missing = { ...doc, id: "other", workspacePath: "Missing/Workspace" };
  assert.deepEqual(
    await resolver.formatHighlightQuotes(missing, ["Normal prose."], true),
    ["Normal prose."],
  );
  assert.equal(requests, 0);
});
