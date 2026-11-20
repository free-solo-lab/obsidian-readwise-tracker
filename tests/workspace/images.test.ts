import test from "node:test";
import assert from "node:assert/strict";
import { imageReferences } from "../../src/workspace/images";
import { locateQuote } from "../../src/workspace/anchors";
import { DocumentSourceResolver } from "../../src/workspace/source";
import { WorkspaceRepository } from "../../src/workspace/repository";
import { MemoryVault, doc } from "./memory";

const roots = () => ({ highlights: "Highlights", inbox: "Inbox" });
const path = "Highlights/Book A/A — 001.md";
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
async function fixture(markdown: string, quote: string) {
  const vault = new MemoryVault(),
    repo = new WorkspaceRepository(vault, roots);
  await vault.create("Full.md", markdown);
  await vault.create(path, "> " + quote);
  await repo.saveSource(doc, { contentPath: "Full.md" });
  return { vault, repo };
}

test("image selectors preserve offsets across Markdown, HTML and vault embeds, excluding code", () => {
  const markdown =
    'Text\n\n![](https://site.test/figure_(2).png "Figure")\n![[Images/One.png|300]]\n<img src="https://site.test/x?a=1&amp;b=2">\n![[Note.md]]\n`![](code.png)`\n```md\n![](fenced.png)\n```';
  const images = imageReferences(markdown);
  assert.deepEqual(
    images.map((image) => image.resource),
    [
      "https://site.test/figure_(2).png",
      "Images/One.png",
      "https://site.test/x?a=1&b=2",
    ],
  );
  for (const image of images)
    assert.match(markdown.slice(image.start, image.end), /^!\[|^<img/);
});

test("image-only quotes match identical resources and retain repeated-image ambiguity", () => {
  const image = "![](https://site.test/diagram.png)",
    markdown = "Before.\n\n" + image + "\n\nAfter.";
  const anchor = locateQuote(markdown, image, path, "v1");
  assert.equal(anchor.status, "matched");
  assert.equal(markdown.slice(anchor.start, anchor.end), image);
  assert.equal(
    locateQuote(markdown + "\n\n" + image, image, path, "v1").status,
    "ambiguous",
  );
  assert.equal(
    locateQuote(markdown, "![](https://other.test/diagram.png)", path, "v1")
      .status,
    "missing",
  );
});

test("different Reader image URLs are matched by bytes, cached in Markdown and reopened offline", async () => {
  const image = "![](https://assets.test/opaque.png)",
    { vault, repo } = await fixture(
      "Before.\n\n" + image + "\n\nAfter.",
      "![](https://reader.test/pcei/aien_0202.png)",
    );
  let downloads = 0;
  const transport = {
    getDocumentContent: async () => undefined,
    download: async () => {
      downloads++;
      return bytes("identical PNG");
    },
  };
  const resolver = new DocumentSourceResolver(repo, transport, () => "Assets");
  const initial = await resolver.resolve(doc, false);
  assert.equal(initial.anchors[0].status, "missing");
  const result = await resolver.resolveImageAnchor(
    doc,
    path,
    new AbortController().signal,
  );
  assert.equal(result?.anchors[0].status, "matched");
  assert.equal(
    result?.markdown.slice(result.anchors[0].start, result.anchors[0].end),
    image,
  );
  assert.equal(downloads, 2);
  const rebuilt = new DocumentSourceResolver(
    new WorkspaceRepository(vault, roots),
    {
      getDocumentContent: async () => {
        throw new Error("offline");
      },
      download: async () => {
        throw new Error("offline");
      },
    },
    () => "Assets",
  );
  assert.deepEqual(
    (await rebuilt.resolve(doc, false)).anchors,
    result?.anchors,
  );
  assert.equal(
    await rebuilt.resolveImageAnchor(doc, path, new AbortController().signal),
    undefined,
  );
  assert.equal(downloads, 2);
  assert.ok(
    Object.keys((await repo.source(doc)).imageHashes || {}).length === 2,
  );
});

test("figure names only prioritize candidates; a wrong chart with the same name never matches", async () => {
  const { repo } = await fixture(
    "![](https://assets.test/aien_0202.png)\n\nFigure 2-2. Different chart.",
    "![](https://reader.test/aien_0202.png)",
  );
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async (url) =>
        bytes(url.startsWith("https://reader") ? "chart A" : "chart B"),
    },
    () => "Assets",
  );
  assert.equal(
    (await resolver.resolveImageAnchor(doc, path, new AbortController().signal))
      ?.anchors[0].status,
    "missing",
  );
});

test("a numbered caption avoids downloading the whole illustrated book", async () => {
  let markdown = "";
  for (let i = 1; i <= 100; i++)
    markdown += `![](https://assets.test/opaque-${i}.png)\n\nFigure 2-${i}. Caption.\n\n`;
  const { repo } = await fixture(
    markdown,
    "![](https://reader.test/aien_0202.png)",
  );
  const requested: string[] = [];
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async (url) => {
        requested.push(url);
        return bytes(
          url.includes("opaque-2.png") || url.includes("reader.test")
            ? "target"
            : url,
        );
      },
    },
    () => "Assets",
  );
  const result = await resolver.resolveImageAnchor(
    doc,
    path,
    new AbortController().signal,
  );
  assert.equal(
    result?.anchors[0].start,
    markdown.indexOf("![](https://assets.test/opaque-2.png)"),
  );
  assert.equal(requested.length, 2);
});

test("local images with different paths match offline; repeated occurrences stay ambiguous", async () => {
  const { vault, repo } = await fixture(
    "![[Assets/One.png]]\n\nText\n\n![[Assets/One.png]]",
    "![[Clips/Two.png]]",
  );
  await vault.createBinary("Assets/One.png", bytes("same image"));
  await vault.createBinary("Clips/Two.png", bytes("same image"));
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async () => {
        throw new Error("must not download");
      },
    },
    () => "Assets",
  );
  const result = await resolver.resolveImageAnchor(
    doc,
    path,
    new AbortController().signal,
  );
  assert.equal(result?.anchors[0].status, "ambiguous");
  assert.equal(result?.anchors[0].candidates.length, 2);
});

test("a late image match cannot overwrite a newer manual binding or source revision", async () => {
  const { repo } = await fixture(
    "Paragraph.\n\n![](https://assets.test/image.png)",
    "![](https://reader.test/image.png)",
  );
  let release: (value: ArrayBuffer) => void = () => undefined;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async (url) =>
        url.includes("assets.test")
          ? new Promise<ArrayBuffer>((resolve) => {
              release = resolve;
            })
          : bytes("image"),
    },
    () => "Assets",
  );
  const first = await resolver.resolve(doc, false);
  const request = resolver.resolveImageAnchor(
    doc,
    path,
    new AbortController().signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const manual = {
    ...first.anchors[0],
    status: "matched" as const,
    start: 0,
    end: 10,
    manual: true,
    selectedText: "Paragraph.",
  };
  await repo.saveSource(doc, { anchors: [manual] });
  release(bytes("image"));
  assert.equal((await request)?.anchors[0].manual, true);
  assert.equal((await repo.source(doc)).anchors[0].start, 0);
  await repo.saveSource(doc, { contentHash: "new revision" });
  await repo.saveImageMatches(
    doc,
    first.revision,
    { outdated: "hash" },
    { ...manual, start: 12 },
  );
  assert.equal((await repo.source(doc)).imageHashes?.outdated, undefined);
});

test("changing focus cancels further image search and does not save a late binding", async () => {
  const { repo } = await fixture(
    "![](https://assets.test/first.png)\n\n![](https://assets.test/second.png)",
    "![](https://reader.test/image.png)",
  );
  const controller = new AbortController();
  let requests = 0;
  const resolver = new DocumentSourceResolver(
    repo,
    {
      getDocumentContent: async () => undefined,
      download: async () => {
        requests++;
        controller.abort();
        return bytes("image");
      },
    },
    () => "Assets",
  );
  assert.equal(
    await resolver.resolveImageAnchor(doc, path, controller.signal),
    undefined,
  );
  assert.equal(requests, 1);
  assert.equal((await repo.source(doc)).anchors[0].status, "missing");
});
