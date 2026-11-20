import test from "node:test";
import assert from "node:assert/strict";
import {
  markdownTable,
  applyTableRepairs,
  standaloneTableText,
} from "../../src/workspace/tables";
import { textBlocks } from "../../src/workspace/focus";
import { DocumentSourceResolver } from "../../src/workspace/source";
import { WorkspaceRepository } from "../../src/workspace/repository";
import { MemoryVault, doc } from "./memory";

test("the book's parameter table retains columns, header and all model values", () => {
  const result = markdownTable([
    ["Model", "Size (# parameters)", "Training tokens"].map((text) => ({
      text,
      header: true,
    })),
    ["LaMDA (Thoppilan et al., 2022)", "137 billion", "168 billion"].map(
      (text) => ({ text }),
    ),
    ["GPT-3 (Brown et al., 2020)", "175 billion", "300 billion"].map(
      (text) => ({ text }),
    ),
  ]);
  assert.equal(
    result,
    "| Model | Size (# parameters) | Training tokens |\n| --- | --- | --- |\n| LaMDA (Thoppilan et al., 2022) | 137 billion | 168 billion |\n| GPT-3 (Brown et al., 2020) | 175 billion | 300 billion |",
  );
});

test("headerless tables keep the first data row; pipes, multiline cells and alignment survive", () => {
  const result = markdownTable([
    [{ text: "a | b\nsecond line" }, { text: "**42**", align: "right" }],
    [{ text: "[Source](https://example.test)" }],
  ]);
  assert.equal(
    result,
    "|  |  |\n| --- | ---: |\n| a \\| b<br>second line | **42** |\n| [Source](https://example.test) |  |",
  );
});

test("a long Markdown table and raw HTML table remain indivisible source blocks with original offsets", () => {
  const table = markdownTable([
    [
      { text: "Model", header: true },
      { text: "Description", header: true },
    ],
    ...Array.from({ length: 150 }, (_, index) => [
      { text: String(index) },
      { text: "A long description repeated inside a table." },
    ]),
  ]);
  const html =
    '<table>\n<tr><th colspan="2">Header</th></tr>\n\n' +
    Array.from(
      { length: 150 },
      (_, index) => `<tr><td>${index}</td><td>Description of a row.</td></tr>`,
    ).join("\n") +
    "\n</table>";
  const markdown =
    "Before.\n\n" + table + "\n\nBetween.\n\n" + html + "\n\nAfter.";
  const blocks = textBlocks(markdown);
  assert.equal(blocks.length, 5);
  assert.equal(blocks[1].text.trim(), table);
  assert.equal(blocks[3].text.trim(), html);
  assert.ok(blocks[1].text.length > 5000);
  for (const block of blocks)
    assert.equal(markdown.slice(block.start, block.end), block.text);
});

test("table-like fenced code and ordinary pipe text do not absorb following paragraphs", () => {
  const blocks = textBlocks(
    "```html\n<table>\n\n| A | B |\n| --- | --- |\n```\n\nA | B\n\nAfter.",
  );
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].text, "After.");
});

test("legacy repair preserves edits around the table and refuses edited, repeated or partial table text", () => {
  const table = {
    legacy: "Model\n\nSize\n\nGPT-3\n\n175 billion",
    markdown: "| Model | Size |\n| --- | --- |\n| GPT-3 | 175 billion |",
  };
  const original =
    "My own introduction.\n\n" + table.legacy + "\n\nMy own conclusion.";
  assert.deepEqual(applyTableRepairs(original, [table]), {
    markdown: original.replace(table.legacy, table.markdown),
    count: 1,
  });
  assert.deepEqual(applyTableRepairs("\n" + table.legacy + "\n", [table]), {
    markdown: "\n" + table.markdown + "\n",
    count: 1,
  });
  for (const text of [
    original.replace("175 billion", "my correction"),
    original + "\n\n" + table.legacy,
    "Prefix " + table.legacy,
    table.legacy + " continuation",
  ])
    assert.deepEqual(applyTableRepairs(text, [table]), {
      markdown: text,
      count: 0,
    });
});

test("several legacy tables repair from the same original offsets and do not repair twice", () => {
  const tables = [
    { legacy: "A\n\nB", markdown: "| A | B |\n| --- | --- |" },
    { legacy: "C\n\nD", markdown: "| C | D |\n| --- | --- |" },
  ];
  const repaired = applyTableRepairs(
    "Before\n\nA\n\nB\n\nBetween\n\nC\n\nD\n\nAfter",
    tables,
  );
  assert.equal(repaired.count, 2);
  assert.equal(applyTableRepairs(repaired.markdown, tables).count, 0);
  assert.equal(textBlocks(repaired.markdown).length, 5);
});

test("tables inside list items retain stored indentation and render outside their virtual list context", () => {
  const table = {
    legacy: "Header\n\nData",
    markdown:
      "<table>\n<tr><th>Header</th></tr>\n<tr><td>Data</td></tr>\n</table>",
  };
  const indent = (text: string) =>
    text
      .split("\n")
      .map((line) => "    " + line)
      .join("\n");
  const old =
    "- List item\n\n" + indent(table.legacy) + "\n\nFollowing paragraph.";
  const repaired = applyTableRepairs(old, [table]);
  assert.equal(repaired.count, 1);
  assert.equal(
    repaired.markdown,
    old.replace(indent(table.legacy), indent(table.markdown)),
  );
  const blocks = textBlocks(repaired.markdown);
  assert.equal(standaloneTableText(blocks[1].text).trim(), table.markdown);
  assert.equal(standaloneTableText("    Ordinary code"), "    Ordinary code");
});

test("existing user Markdown is never regenerated or sent to Reader for table repair", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("My book.md", "My manually written text.");
  await repo.saveSource(doc, { contentPath: "My book.md" });
  let calls = 0;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        calls++;
        return undefined;
      },
      download: async () => {
        throw new Error("must not download");
      },
    },
    () => "Assets",
  );
  assert.equal(
    await resolver.repairTables(doc, true, new AbortController().signal),
    undefined,
  );
  assert.equal(await vault.read("My book.md"), "My manually written text.");
  assert.equal(calls, 0);
});
