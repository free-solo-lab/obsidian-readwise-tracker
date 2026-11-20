import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkspaceRepository,
  WorkspaceConflictError,
} from "../../src/workspace/repository";
import {
  isWorkspaceResource,
  isFullDocumentExport,
  parseMarkdown,
  serializeMarkdown,
  serializeMessages,
  parseMessages,
  fileStem,
} from "../../src/workspace/markdown";
import { withHighlightComment } from "../../src/services/readwiseHighlightParsing";
import { MemoryVault, doc, other } from "./memory";

test("concurrent readers share the same graph and cached book projection until files change", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("Highlights/Book A/A — 001.md", "> A quote");
  const [a, b] = await Promise.all([repo.graph(), repo.graph()]);
  assert.equal(a, b);
  assert.equal(await repo.graph(), a);
  const first = await repo.nodesFor(doc);
  assert.equal(await repo.nodesFor(doc), first);
  await vault.process(a[0].path, () => "> Changed quote");
  const changed = await repo.graph();
  assert.notEqual(changed, a);
  assert.equal(a[0].stub, true);
  assert.equal((await repo.nodesFor(doc))[0].quote, "Changed quote");
});
test("cached provenance traverses cycles without dropping reachable highlights", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  const a = "Highlights/Book A/A — 001.md",
    b = "Highlights/Book A/A — 002.md";
  await vault.create(a, "> A");
  await vault.create(b, "> B");
  const first = await repo.create(doc, "thought", "First", [a]);
  const second = await repo.create(doc, "thought", "Second", [first.path, b]);
  await repo.updateSources(first, [second.path, a]);
  const graph = await repo.graph();
  assert.deepEqual(
    new Set(repo.sourceHighlights(first, graph)),
    new Set([a, b]),
  );
  assert.deepEqual(
    new Set(repo.sourceHighlights(second, graph)),
    new Set([a, b]),
  );
  assert.equal(
    repo.sourceHighlights(first, graph),
    repo.sourceHighlights(first, graph),
  );
});

test("full-document links before Highlights do not hide the source book", () => {
  assert.equal(isFullDocumentExport(["Full Document", "Highlights"]), false);
  assert.equal(
    isFullDocumentExport(["Full Document"], {
      url: "https://read.readwise.io/read/book",
    }),
    false,
  );
  assert.equal(isFullDocumentExport(["Full Document", "Chapter One"]), true);
});
test("unchanged source metadata is not passed to Vault.process", async () => {
  class CountingVault extends MemoryVault {
    calls = 0;
    async process(path: string, update: (current: string) => string) {
      this.calls++;
      await super.process(path, update);
    }
  }
  const vault = new CountingVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await repo.saveSource(doc, { contentPath: "Full.md", anchors: [] });
  await repo.saveSource(doc, { contentPath: "Full.md", anchors: [] });
  assert.equal(vault.calls, 0);
});

const setup = () => {
  const vault = new MemoryVault();
  return {
    vault,
    repo: new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    })),
  };
};
test("existing highlights and Inbox are read in place; reserved files do not enter statistics or notes", async () => {
  const { vault, repo } = setup();
  const path = "Highlights/Book A/Book A — 007.md";
  const raw =
    '---\ntype: highlight\nbook: "[[Books/Book A]]"\n---\n\n> A quote ![](image.png)\n\nQ: why?\nA: because\n\n## Links\n[[Book A]]';
  await vault.create(path, raw);
  await vault.create(
    "Inbox/Existing.md",
    serializeMarkdown(
      { type: "inbox", source: "[[Book A — 007]]", book: "[[Books/Book A]]" },
      "Existing thought",
    ),
  );
  await vault.create(
    "Highlights/Book A/Workspace/Source/content.md",
    "full text",
  );
  await vault.create("Highlights/_Assets/file.md", "not a highlight");
  const nodes = await repo.nodesFor(doc);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].index, 7);
  assert.equal(nodes[1].kind, "thought");
  assert.match(nodes[0].quote, /image.png/);
  assert.match(nodes[0].body, /A: because/);
  assert.equal(await vault.read(path), raw);
  assert.equal(
    isWorkspaceResource("Highlights/Book A/Workspace/Thoughts/X.md"),
    true,
  );
});
test("many-to-many provenance is rebuilt from Markdown and removable in both directions", async () => {
  const { vault, repo } = setup();
  const a = "Highlights/Book A/A — 001.md",
    b = "Highlights/Book B/B — 002.md";
  await vault.create(a, "> first quote");
  await vault.create(b, "> second quote");
  const thought = await repo.create(doc, "thought", "A new thought", [a, b]);
  const child = await repo.create(doc, "thought", "Derived", [thought.path]);
  assert.equal(
    (await repo.nodesFor(other)).some((n) => n.path === child.path),
    true,
  );
  assert.deepEqual(repo.sourceHighlights(child, await repo.graph()), [a, b]);
  await repo.updateSources(thought, [a]);
  const rebuilt = new WorkspaceRepository(vault, () => ({
    highlights: "Highlights",
    inbox: "Inbox",
  }));
  assert.equal(
    (await rebuilt.nodesFor(other)).some((n) => n.path === thought.path),
    false,
  );
  assert.equal(
    parseMarkdown(await vault.read(thought.path)).metadata.source,
    "[[Highlights/Book A/A — 001]]",
  );
});
test("new notes are discoverable before MetadataCache catches up and have stable names", async () => {
  const { vault, repo } = setup();
  vault.metadataReady = false;
  const thought = await repo.create(doc, "thought", "First line", []);
  assert.equal((await repo.nodesFor(doc))[0].id, thought.id);
  await repo.saveBody(thought, "Completely different line");
  await repo.saveBody(thought, "Last edit");
  assert.equal(
    parseMarkdown(await vault.read(thought.path)).body.trim(),
    "Last edit",
  );
  assert.equal(vault.files().length, 2);
});
test("stale editor preserves external changes and saves its draft to a conflict copy", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "thought", "initial", []);
  await vault.process(node.path, (raw) => raw.replace("initial", "external"));
  await assert.rejects(repo.saveBody(node, "my draft"), WorkspaceConflictError);
  assert.match(await vault.read(node.path), /external/);
  const copy = vault.files().find((f) => f.path.includes("conflict-"));
  assert.ok(copy);
  assert.equal(
    parseMarkdown(await vault.read(copy.path)).body.trim(),
    "my draft",
  );
});
test("an editor rebased onto its conflict copy does not create further copies", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "thought", "initial", []);
  await vault.process(node.path, (raw) => raw.replace("initial", "external"));
  const error = await repo
    .saveBody(node, "draft 1")
    .catch((e: unknown) => e as WorkspaceConflictError);
  assert.ok(error instanceof WorkspaceConflictError);
  const rebased = {
    ...node,
    path: error.copyPath,
    raw: error.copyRaw,
    body: parseMarkdown(error.copyRaw).body,
  };
  await repo.saveBody(rebased, "draft 2");
  await repo.saveBody(rebased, "draft 3");
  assert.equal(vault.files().filter((f) => f.path.includes("conflict-")).length, 1);
  assert.equal(
    parseMarkdown(await vault.read(error.copyPath)).body.trim(),
    "draft 3",
  );
});
test("rename repairs managed links and source anchors without changing legacy highlights", async () => {
  const { vault, repo } = setup();
  const old = "Highlights/Book A/Old — 001.md",
    next = "Highlights/Book A/Renamed — 001.md";
  await vault.create(old, "> unchanged");
  const thought = await repo.create(doc, "thought", "Note", [old]);
  await repo.saveSource(doc, {
    anchors: [
      {
        id: "anchor",
        nodePath: old,
        quote: "quote",
        revision: "v1",
        status: "missing",
        candidates: [],
      },
    ],
  });
  await repo.repairRename(old, next);
  assert.deepEqual(
    (await repo.graph()).find((n) => n.id === thought.id)?.sources,
    [next],
  );
  assert.equal((await repo.source(doc)).anchors[0].nodePath, next);
  assert.equal(await vault.read(old), "> unchanged");
});
test("dialog messages retain IDs, time and individual context snapshots", () => {
  const messages = [
    {
      id: "message-one",
      role: "user" as const,
      created: "2026-11-11T10:00:00Z",
      content: "Question?",
      sources: ["[[A#^one]]"],
      revision: "v1",
    },
    {
      id: "message-two",
      role: "assistant" as const,
      created: "2026-11-11T10:01:00Z",
      content: "An answer.",
      sources: ["[[B]]"],
      revision: "v2",
    },
  ];
  assert.deepEqual(parseMessages(serializeMessages(messages)), messages);
});
test("malformed legacy YAML is readable and body editing leaves its properties intact", async () => {
  const { vault, repo } = setup();
  const path = "Inbox/Legacy.md",
    raw = "---\ntype: inbox\nsource: [[Missing]]\nbroken: [\n---\n\nOld";
  await vault.create(path, raw);
  const [node] = await repo.graph();
  assert.equal(node.kind, "thought");
  await repo.saveBody(node, "New");
  assert.equal(
    parseMarkdown(await vault.read(path)).header,
    parseMarkdown(raw).header,
  );
  await assert.rejects(repo.updateSources(node, []), /properties/);
});

test("unquoted legacy wikilinks resolve to the original notes", async () => {
  const { vault, repo } = setup();
  const path = "Highlights/Book A/A — 001.md";
  await vault.create(path, "> original");
  await vault.create(
    "Inbox/Old.md",
    "---\ntype: inbox\nbook: [[Books/Book A]]\nsource: [[A — 001]]\n---\n\nOld thought",
  );
  assert.deepEqual(
    (await repo.nodesFor(doc)).find((n) => n.kind === "thought")?.sources,
    [path],
  );
});
test("source edits while typing merge without replacing the body or losing links", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "thought", "Initial", []);
  await repo.updateSources(node, ["Highlights/Book A/A — 001.md"]);
  await repo.saveBody(node, "Typed text");
  assert.match(await vault.read(node.path), /Typed text/);
  assert.match(await vault.read(node.path), /A — 001/);
  assert.equal(
    vault.files().some((f) => f.path.includes("conflict-")),
    false,
  );
});
test("a pending editor follows a file rename and preserves a draft after deletion", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "thought", "Initial", []),
    next = node.path.replace("Initial", "Renamed");
  await vault.create(next, await vault.read(node.path));
  vault.texts.delete(node.path);
  await repo.repairRename(node.path, next);
  await repo.saveBody(node, "After rename");
  assert.match(await vault.read(next), /After rename/);
  vault.texts.delete(next);
  await assert.rejects(
    repo.saveBody(node, "After deletion"),
    WorkspaceConflictError,
  );
  const copy = vault.files().find((f) => f.path.includes("conflict-"));
  assert.ok(copy);
  assert.match(await vault.read(copy.path), /After deletion/);
});
test("external question edits are preserved in the same way as thought conflicts", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "dialog", "", []);
  await vault.process(node.path, (raw) => {
    const p = parseMarkdown(raw);
    return serializeMarkdown(
      { ...p.metadata, rwt_draft: "external question" },
      p.body,
    );
  });
  await assert.rejects(
    repo.saveDraft(node, "my question"),
    WorkspaceConflictError,
  );
  assert.equal(
    parseMarkdown(await vault.read(node.path)).metadata.rwt_draft,
    "external question",
  );
  const copy = vault.files().find((f) => f.path.includes("conflict-"));
  assert.ok(copy);
  assert.equal(
    parseMarkdown(await vault.read(copy.path)).metadata.rwt_draft,
    "my question",
  );
});
test("dialog source changes do not rewrite older message provenance", async () => {
  const { repo } = setup();
  const node = await repo.create(doc, "dialog", "", ["A.md"]);
  await repo.appendMessage(node, {
    id: "message-id",
    role: "assistant",
    created: "2026-11-11",
    content: "An answer",
    sources: ["A.md"],
    revision: "v1",
  });
  await repo.updateSources(node, ["B.md"]);
  const messages = await repo.messages(node);
  assert.deepEqual(messages[0].sources, ["A.md"]);
});

test("highlights of other books stay light stubs until their book is opened", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("Highlights/Book A/A — 001.md", "> A quote");
  await vault.create("Highlights/Book B/B — 001.md", "> B quote");
  const reads: string[] = [];
  const read = vault.read.bind(vault);
  vault.read = async (path: string) => (reads.push(path), read(path));
  const graph = await repo.graph();
  assert.equal(reads.length, 0);
  assert.ok(graph.every((node) => node.stub));
  const [a] = await repo.nodesFor(doc);
  assert.equal(a.quote, "A quote");
  assert.deepEqual(reads, ["Highlights/Book A/A — 001.md"]);
});

test("message content cannot close its own block; keys and names stay valid", () => {
  const evil = "text <!-- /rwt-message --> more";
  const parsed = parseMessages(
    serializeMessages([
      { id: "m1", role: "assistant", created: "t", content: evil, sources: [] },
      { id: "m2", role: "user", created: "t", content: "next", sources: [] },
    ]),
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].content, "next");
  assert.match(
    serializeMarkdown({ "my key": 1, ok_key: 2 }, "x"),
    /^---\n"my key": 1\nok_key: 2\n---/,
  );
  assert.equal(fileStem("# 😀".repeat(80)).length > 0, true);
  assert.equal(fileStem("con"), "Note con");
  assert.equal(fileStem("Chapter 1. ^ref."), "Chapter 1. ref");
});

test("an empty thought is named after its first line once, and later edits keep the name", async () => {
  const { vault, repo } = setup();
  const node = await repo.create(doc, "thought", "", []);
  assert.match(node.path, /\/Thoughts\/Note — /);
  await repo.saveBody(node, "Hello world\nmore");
  const path = await repo.nameThought(node, "Hello world\nmore");
  assert.match(path || "", /\/Thoughts\/Hello world — /);
  assert.equal(vault.exists(node.path), false);
  assert.match(await vault.read(path as string), /more/);
  await repo.saveBody({ ...node, path: path as string }, "Changed first line");
  assert.equal(await repo.nameThought({ ...node, path: path as string }, "Changed first line"), undefined);
});

test("a highlight written from a selection is ordered between its neighbours and listed with the book", async () => {
  const { vault, repo } = setup();
  await vault.create("Highlights/Book A/A — 001.md", "> one");
  await vault.create("Highlights/Book A/A — 002.md", "> two");
  const between = await repo.createHighlight(doc, {
    quote: "line a\nline b",
    comment: "mine",
    before: 1,
    after: 2,
  });
  const last = await repo.createHighlight(doc, { quote: "tail", comment: "", before: 2 });
  const nodes = (await repo.nodesFor(doc)).filter((n) => n.kind === "highlight");
  assert.deepEqual(
    nodes.map((n) => n.order),
    [1, 1.5, 2, 3],
  );
  assert.equal(nodes[1].path, between.path);
  assert.equal(nodes[1].quote, "line a\nline b");
  assert.equal(nodes[3].path, last.path);
  assert.match(await vault.read(between.path), /^> line a\n> line b\n\nmine/m);
});

test("editing a highlight comment keeps its quote and Links section", () => {
  const body = "> quote a\n> quote b\n\nold comment\n\n## Links\n← [[x]]\n";
  assert.equal(
    withHighlightComment(body, "new"),
    "> quote a\n> quote b\n\nnew\n\n## Links\n← [[x]]\n",
  );
  assert.equal(withHighlightComment("> only quote\n", "added"), "> only quote\n\nadded\n");
  assert.equal(withHighlightComment(body, ""), "> quote a\n> quote b\n\n## Links\n← [[x]]\n");
});

test("a highlight created from a selection can be discarded with its anchor", async () => {
  const { vault, repo } = setup();
  const node = await repo.createHighlight(doc, { quote: "q", comment: "" });
  await repo.saveSource(doc, {
    anchors: [
      { id: "a", nodePath: node.path, quote: "q", revision: "r", status: "matched", start: 0, end: 1, candidates: [] },
    ],
  });
  await repo.discardHighlight(doc, node);
  assert.equal(vault.exists(node.path), false);
  assert.deepEqual((await repo.source(doc)).anchors, []);
});

test("an unsent dialog can be discarded and disappears from the book", async () => {
  const { vault, repo } = setup();
  const dialog = await repo.create(doc, "dialog", "", []);
  await repo.saveDraft(dialog, "never sent");
  await repo.discard(dialog);
  assert.equal(vault.exists(dialog.path), false);
  assert.equal((await repo.nodesFor(doc)).some((n) => n.path === dialog.path), false);
});
test("importance mark is stored as a property, read back and cleared", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  const a = "Highlights/Book A/A — 001.md";
  await vault.create(a, "> A");
  const thought = await repo.create(doc, "thought", "Idea", [a]);
  assert.equal(thought.important, undefined);
  await repo.setImportant(thought, true);
  const marked = (await repo.nodesFor(doc)).find((n) => n.path === thought.path);
  assert.equal(marked?.important, true);
  assert.equal(marked?.body.trim(), "Idea");
  await repo.setImportant(marked!, false);
  const cleared = (await repo.nodesFor(doc)).find((n) => n.path === thought.path);
  assert.equal(cleared?.important, undefined);
  assert.ok(!/rwt_important/.test(await vault.read(thought.path)));
});
