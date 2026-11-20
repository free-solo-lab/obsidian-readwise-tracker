import test from "node:test";
import assert from "node:assert/strict";
import { locateQuote } from "../../src/workspace/anchors";
import { DocumentSourceResolver } from "../../src/workspace/source";
import { WorkspaceRepository } from "../../src/workspace/repository";
import {
  WorkspaceFocus,
  nearestSource,
  textBlocks,
} from "../../src/workspace/focus";
import { MemoryVault, doc } from "./memory";

test("repeated transitions reuse text and anchors; changing the book or quote invalidates the cache", async () => {
  class TrackedVault extends MemoryVault {
    reads = 0;
    async read(path: string) {
      if (path === "Full.md") this.reads++;
      return super.read(path);
    }
  }
  const vault = new TrackedVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create(
    "Full.md",
    "First exact quoted passage.\n\nSecond exact quoted passage.",
  );
  const path = "Highlights/Book A/A — 001.md";
  await vault.create(path, "> First exact quoted passage.");
  await repo.saveSource(doc, { contentPath: "Full.md" });
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        throw new Error("unexpected network");
      },
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
  );
  const first = await resolver.resolve(doc, false);
  for (let i = 0; i < 20; i++)
    assert.equal(await resolver.resolve(doc, false), first);
  assert.equal(vault.reads, 1);
  await vault.process(path, () => "> Second exact quoted passage.");
  const changed = await resolver.resolve(doc, false);
  assert.equal(changed.anchors[0].start, changed.markdown.indexOf("Second"));
  assert.equal(vault.reads, 1);
  await vault.process("Full.md", (text) => "Preface.\n\n" + text);
  const readsBeforeReload = vault.reads;
  const revised = await resolver.resolve(doc, false);
  assert.equal(vault.reads, readsBeforeReload + 1);
  assert.notEqual(revised.revision, changed.revision);
  assert.equal(revised.anchors[0].start, revised.markdown.indexOf("Second"));
});
test("manual changes to an anchor invalidate the in-memory result", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  const path = "Highlights/Book A/A — 001.md";
  await vault.create("Full.md", "Repeated quote.\n\nRepeated quote.");
  await vault.create(path, "> Repeated quote.");
  await repo.saveSource(doc, { contentPath: "Full.md" });
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
  );
  const first = await resolver.resolve(doc, false),
    source = await repo.source(doc),
    anchor = first.anchors[0];
  await repo.saveSource(doc, {
    ...source,
    anchors: [{ ...anchor, ...anchor.candidates[1], status: "matched" }],
  });
  const selected = await resolver.resolve(doc, false);
  assert.notEqual(selected, first);
  assert.equal(selected.anchors[0].start, anchor.candidates[1].start);
});
test("persisted current-version anchors survive rebuilding the repository", async () => {
  const vault = new MemoryVault(),
    roots = () => ({ highlights: "Highlights", inbox: "Inbox" }),
    repo = new WorkspaceRepository(vault, roots);
  await vault.create("Full.md", "A unique quoted passage.");
  await vault.create(
    "Highlights/Book A/A — 001.md",
    "> A unique quoted passage.",
  );
  await repo.saveSource(doc, { contentPath: "Full.md" });
  const transport = {
    getDocumentContent: async () => undefined,
    download: async () => new ArrayBuffer(0),
  };
  const first = await new DocumentSourceResolver(
    repo,
    transport,
    () => "Assets",
  ).resolve(doc, false);
  const rebuilt = await new DocumentSourceResolver(
    new WorkspaceRepository(vault, roots),
    transport,
    () => "Assets",
  ).resolve(doc, false);
  assert.equal(JSON.stringify(rebuilt.anchors), JSON.stringify(first.anchors));
});
test("a stalled Reader request times out and retrying shares the pending request", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  let requests = 0;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: () => {
        requests++;
        return new Promise(() => undefined);
      },
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
    { networkTimeoutMs: 5 },
  );
  await assert.rejects(resolver.resolve(doc), /Reader did not answer/);
  await assert.rejects(resolver.resolve(doc), /Reader did not answer/);
  assert.equal(requests, 1);
});

test("normalized quote offsets map back to Markdown; repeated quotes require an explicit choice", () => {
  const text =
    "# Chapter\n\nA **useful** thought\nacross lines.\n\nA useful thought across lines.";
  const anchor = locateQuote(
    text,
    "A useful thought across lines.",
    "note",
    "v1",
  );
  assert.equal(anchor.status, "ambiguous");
  assert.equal(anchor.candidates.length, 2);
  const selected = {
    ...anchor,
    ...anchor.candidates[1],
    status: "matched" as const,
  };
  assert.equal(
    locateQuote(text, selected.quote, "note", "v1", selected).start,
    selected.start,
  );
  assert.equal(
    locateQuote(text, selected.quote, "note", "v2", selected).status,
    "ambiguous",
  );
});
test("manual paragraph anchors survive reopening and relocate after a source revision", () => {
  const text = "Before\n\nSelected paragraph.\n\nAfter",
    start = text.indexOf("Selected");
  const anchor = {
    id: "a",
    nodePath: "note",
    quote: "different edition",
    revision: "v1",
    status: "matched" as const,
    start,
    end: start + 19,
    candidates: [],
    manual: true,
    selectedText: "Selected paragraph.",
  };
  assert.deepEqual(
    locateQuote(text, anchor.quote, "note", "v1", anchor),
    anchor,
  );
  assert.equal(
    locateQuote("New prefix\n\n" + text, anchor.quote, "note", "v2", anchor)
      .start,
    start + 12,
  );
});
test("bound vault content is read offline and source files are not overwritten", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("Original.md", "One unique quote.\n\nOther paragraph.");
  await vault.create("Highlights/Book A/A — 001.md", "> One unique quote.");
  await repo.saveSource(doc, { contentPath: "Original.md" });
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        throw new Error("network must not run");
      },
      download: async () => {
        throw new Error("network must not run");
      },
    },
    () => "Highlights/_Assets",
  );
  const result = await resolver.resolve(doc, false);
  assert.equal(result.status, "ready");
  assert.equal(result.path, "Original.md");
  assert.equal(result.anchors[0].status, "matched");
  assert.equal(
    await vault.read("Original.md"),
    "One unique quote.\n\nOther paragraph.",
  );
  await resolver.resolve(doc, false);
  assert.equal(
    vault.files().filter((f) => f.path.endsWith("source.md")).length,
    1,
  );
});
test("official full document link wins over Reader; attachments are reused by content hash", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create(
    doc.notePath || "Books/Book A.md",
    "# Book A\n\n## Full Document\n![[Full Text]]\n\n## Highlights\n",
  );
  await vault.create("Exports/Full Text.md", "The full book");
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        throw new Error("network must not run");
      },
      download: async () => new ArrayBuffer(0),
    },
    () => "Highlights/_Assets",
  );
  assert.equal((await resolver.resolve(doc)).path, "Exports/Full Text.md");
  const bytes = new TextEncoder().encode("same file").buffer;
  assert.deepEqual(
    await resolver.saveAsset("one.epub", bytes),
    await resolver.saveAsset("two.epub", bytes),
  );
  assert.equal(vault.binaries.size, 1);
});
test("only real input can transfer scroll ownership; nearest many-source context remains stable", () => {
  const focus = new WorkspaceFocus();
  focus.lead("dialog");
  assert.equal(focus.accepts("highlights"), false);
  assert.equal(focus.accepts("dialog"), true);
  assert.equal(nearestSource("b", ["a", "b"], ["a", "b", "c"]), "b");
  assert.equal(nearestSource("c", ["a", "b"], ["a", "b", "c"]), "b");
  assert.equal(nearestSource("b", ["external"], ["a", "b"]), undefined);
  const text = "# Header\n\nParagraph.\n\n```\na\n\nb\n```\n";
  const blocks = textBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].text.includes("a\n\nb"), true);
});
test("existing vault originals and concurrent saves reuse one asset", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async () => new ArrayBuffer(0),
    },
    () => "Highlights/_Assets",
  );
  const bytes = new TextEncoder().encode("original bytes").buffer;
  await vault.createBinary("Existing/File.epub", bytes);
  const { sha256 } = await import("../../src/workspace/content");
  await repo.saveSource(doc, {
    originalPath: "Existing/File.epub",
    originalHash: await sha256(bytes),
  });
  const saved = await Promise.all([
    resolver.saveAsset("copy.epub", bytes),
    resolver.saveAsset("copy2.epub", bytes),
  ]);
  assert.equal(saved[0].path, "Existing/File.epub");
  assert.deepEqual(saved[0], saved[1]);
  assert.equal(vault.binaries.size, 1);
});
test("attaching an existing Markdown source keeps its path and content unchanged", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  await vault.create("Existing.md", "---\ntitle: Manual\n---\n\nBook body");
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
  );
  const result = await resolver.attach(doc, "Existing.md");
  assert.equal(result.path, "Existing.md");
  assert.equal(
    vault.files().some((f) => f.path.endsWith("/content.md")),
    false,
  );
  assert.match(await vault.read("Existing.md"), /title: Manual/);
});
test("empty Reader responses remain retryable and offline missing content does not use the API", async () => {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, () => ({
      highlights: "Highlights",
      inbox: "Inbox",
    }));
  let calls = 0;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => {
        calls++;
        return undefined;
      },
      download: async () => new ArrayBuffer(0),
    },
    () => "Assets",
  );
  assert.equal((await resolver.resolve(doc, false)).status, "missing");
  assert.equal(calls, 0);
  assert.equal((await resolver.resolve(doc)).status, "processing");
  assert.equal(calls, 1);
});
