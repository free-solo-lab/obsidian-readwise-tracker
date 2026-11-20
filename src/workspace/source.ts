import type { ReadwiseDocument } from "../models/readwise";
import type {
  ContentResolution,
  WorkspaceDocument,
  DocumentSource,
  WorkspaceNode,
} from "./types";
import { WorkspaceRepository } from "./repository";
import {
  htmlToMarkdownAsync,
  extractFile,
  sha256,
  prepareTableRepairs,
  prepareHighlightTableIndex,
} from "./content";
import {
  applyTableRepairs,
  TABLE_FORMAT_VERSION,
  type PreparedTable,
} from "./tables";
import { pathJoin, parseMarkdown, serializeMarkdown } from "./markdown";
import { contentPath, isManifestPath, manifestPath } from "./layout";
import { t } from "../i18n/messages";
import { yieldToEventLoop } from "../utils/timing";
import { imageIdentity, imageReferences, type ImageReference } from "./images";
import {
  mayContainFlatTable,
  type HighlightTableIndex,
} from "./highlightTables";
import {
  keepManualAnchors,
  locateQuote,
  prepareQuoteIndex,
  QUOTE_MATCHER_VERSION,
  type QuoteIndex,
} from "./anchors";
import { startTimer, stopTimer } from "../utils/timers";

export interface ContentTransport {
  getDocumentContent(id: string): Promise<ReadwiseDocument | undefined>;
  download(url: string): Promise<ArrayBuffer>;
}
interface TextSnapshot {
  mtime: number;
  markdown: string;
  revision: string;
  prepared?: QuoteIndex;
}
/** A resolution without text: nothing to read yet, or why. */
export const emptyResolution = (
  status: Exclude<ContentResolution["status"], "ready">,
  extra: Pick<ContentResolution, "originalPath" | "message"> = {},
): ContentResolution => ({ status, markdown: "", revision: "", anchors: [], ...extra });
/** Frontmatter of an extracted text file; the body is the Markdown itself. */
const contentFrontmatter = (document: WorkspaceDocument) => ({
  rwt_kind: "content",
  rwt_document: document.id,
  rwt_table_format: TABLE_FORMAT_VERSION,
});
export class DocumentSourceResolver {
  private active = new Map<string, Promise<ContentResolution>>();
  private assetsInFlight = new Map<
    string,
    Promise<{ path: string; hash: string }>
  >();
  private texts = new Map<string, TextSnapshot>();
  private results = new Map<
    string,
    { signature: string; value: ContentResolution }
  >();
  private metadata = new WeakMap<WorkspaceNode, Record<string, unknown>>();
  private pendingNetwork = new Map<string, Promise<unknown>>();
  private imageHashes = new Map<string, string>();
  private tableInputs = new Map<string, Promise<PreparedTable[] | undefined>>();
  private tableRetry = new Map<string, number>();
  private highlightIndexes = new Map<string, Promise<HighlightTableIndex>>();
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly transport: ContentTransport,
    private readonly assets: () => string,
    private readonly options: { networkTimeoutMs?: number } = {},
  ) {}
  resolve(
    document: WorkspaceDocument,
    remote = true,
  ): Promise<ContentResolution> {
    const key = document.id + ":" + remote;
    const running = this.active.get(key);
    if (running) return running;
    const task = this.load(document, remote).finally(() =>
      this.active.delete(key),
    );
    this.active.set(key, task);
    return task;
  }
  async formatHighlightQuotes(
    document: WorkspaceDocument,
    quotes: string[],
    remote: boolean,
  ): Promise<string[]> {
    if (!quotes.some(mayContainFlatTable)) return quotes;
    let ready = await this.resolve(document, remote);
    if (ready.status !== "ready") return quotes;
    ready =
      (await this.repairTables(
        document,
        remote,
        new AbortController().signal,
      )) || ready;
    const key = (ready.path || document.id) + ":" + ready.revision;
    let prepared = this.highlightIndexes.get(key);
    if (!prepared) {
      prepared = prepareHighlightTableIndex(ready.markdown).catch(
        (error: unknown) => {
          this.highlightIndexes.delete(key);
          throw error;
        },
      );
      this.highlightIndexes.set(key, prepared);
      while (this.highlightIndexes.size > 2)
        this.highlightIndexes.delete(
          this.highlightIndexes.keys().next().value as string,
        );
    }
    const index = await prepared;
    return quotes.map((quote) => index.format(quote));
  }
  /** Repair only the legacy tables in generated content, without replacing user text. */
  async repairTables(
    document: WorkspaceDocument,
    remote: boolean,
    signal: AbortSignal,
  ): Promise<ContentResolution | undefined> {
    const storage = this.repository.storage,
      source = await this.repository.source(document);
    if (
      signal.aborted ||
      (source.tableFormat ?? 0) >= TABLE_FORMAT_VERSION ||
      !source.contentPath
    )
      return;
    const path = source.contentPath;
    if (
      !path.startsWith(document.workspacePath + "/Source/content") ||
      !storage.exists(path)
    )
      return;
    const existing = parseMarkdown(await storage.read(path));
    if (
      existing.metadata.rwt_kind !== "content" ||
      existing.metadata.rwt_document !== document.id
    )
      return;
    const local =
      source.originalPath &&
      /\.(epub|html?)$/i.test(source.originalPath) &&
      storage.exists(source.originalPath);
    if (!local && (!remote || !document.readerId)) return;
    const revision = await sha256(existing.body),
      key = document.id + ":" + revision;
    if ((this.tableRetry.get(key) || 0) > Date.now()) return;
    let inputs = this.tableInputs.get(key);
    if (!inputs) {
      const prepare = async (): Promise<PreparedTable[] | undefined> => {
        const tables: PreparedTable[] = [];
        if (
          source.originalPath &&
          /\.(epub|html?)$/i.test(source.originalPath) &&
          storage.exists(source.originalPath)
        ) {
          await extractFile(
            source.originalPath,
            await storage.readBinary(source.originalPath),
            storage,
            this.assets(),
            tables,
          );
          return tables;
        }
        if (!remote || !document.readerId) return;
        const content = await this.network("reader:" + document.readerId, () =>
          this.transport.getDocumentContent(document.readerId as string),
        );
        if (!content?.html_content?.trim()) return;
        return prepareTableRepairs(content.html_content);
      };
      inputs = prepare().catch(() => undefined);
      this.tableInputs.set(key, inputs);
      while (this.tableInputs.size > 2)
        this.tableInputs.delete(this.tableInputs.keys().next().value as string);
    }
    const tables = await inputs;
    if (!tables) {
      this.tableInputs.delete(key);
      this.tableRetry.set(key, Date.now() + 30_000);
      return;
    }
    if (signal.aborted) return;
    const current = await this.repository.source(document);
    if (
      current.contentPath !== path ||
      (await sha256(parseMarkdown(await storage.read(path)).body)) !==
        revision ||
      signal.aborted
    )
      return;
    const repaired = applyTableRepairs(existing.body, tables);
    if (!repaired.count) {
      await this.repository.saveSource(document, {
        tableFormat: TABLE_FORMAT_VERSION,
      });
      return;
    }
    return this.cache(document, repaired.markdown, source.originalPath, signal);
  }
  private stamp(path: string): number {
    return this.repository.storage.mtime(path) ?? -1;
  }
  private async text(path: string): Promise<TextSnapshot> {
    const mtime = this.stamp(path),
      cached = this.texts.get(path);
    if (cached?.mtime === mtime) {
      this.texts.delete(path);
      this.texts.set(path, cached);
      return cached;
    }
    const markdown = parseMarkdown(
        await this.repository.storage.read(path),
      ).body,
      revision = await sha256(markdown);
    const value: TextSnapshot = {
      mtime,
      markdown,
      revision,
      prepared: cached?.revision === revision ? cached.prepared : undefined,
    };
    this.texts.delete(path);
    this.texts.set(path, value);
    while (this.texts.size > 2) {
      const oldest = this.texts.keys().next().value as string;
      this.texts.delete(oldest);
    }
    return value;
  }
  private async network<T>(
    key: string,
    start: () => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    let task = this.pendingNetwork.get(key) as Promise<T> | undefined;
    if (!task) {
      task = start().finally(() => this.pendingNetwork.delete(key));
      this.pendingNetwork.set(key, task);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_resolve, reject) => {
          timer = startTimer(
            () => reject(new Error(t("workspace.source.readerTimeout"))),
            timeout ?? this.options.networkTimeoutMs ?? 15_000,
          );
        }),
      ]);
    } finally {
      if (timer) stopTimer(timer);
    }
  }
  /** Resolve image-only highlights on demand. URLs/filenames are hints, never proof. */
  async resolveImageAnchor(
    document: WorkspaceDocument,
    nodePath: string,
    signal: AbortSignal,
  ): Promise<ContentResolution | undefined> {
    const ready = await this.resolve(document, false);
    if (ready.status !== "ready" || !ready.path || signal.aborted) return;
    const anchor = ready.anchors.find((item) => item.nodePath === nodePath);
    if (!anchor || anchor.status !== "missing" || anchor.manual) return;
    const query = imageReferences(anchor.quote)[0],
      images = imageReferences(ready.markdown);
    if (!query || !images.length) return;
    const source = await this.repository.source(document),
      hashes = { ...source.imageHashes },
      added: Record<string, string> = {};
    const digest = async (
      resource: string,
      from: string,
    ): Promise<string | undefined> => {
      if (signal.aborted) return;
      const remote = /^https?:\/\//i.test(resource);
      const local = remote
        ? undefined
        : this.repository.storage.resolve(resource, from);
      if (!remote && !local) return;
      const identity = remote
        ? imageIdentity(resource)
        : local + ":" + this.stamp(local as string);
      const key = await sha256(identity),
        known = hashes[key] || this.imageHashes.get(key);
      if (known) return known;
      try {
        const bytes = local
          ? await this.repository.storage.readBinary(local)
          : await this.network(
              "image:" + identity,
              () => this.transport.download(resource),
              this.options.networkTimeoutMs ?? 5000,
            );
        if (!bytes.byteLength) return;
        const hash = await sha256(bytes);
        added[key] = hashes[key] = hash;
        this.imageHashes.set(key, hash);
        while (this.imageHashes.size > 512)
          this.imageHashes.delete(
            this.imageHashes.keys().next().value as string,
          );
        return hash;
      } catch {
        // An unavailable image leaves the manual binding available; no loading overlay.
        return;
      }
    };
    const hash = await digest(query.resource, nodePath);
    if (!hash || signal.aborted) return;
    const index = ready.anchors.indexOf(anchor),
      before = ready.anchors
        .slice(0, index)
        .reverse()
        .find((item) => item.status === "matched"),
      after = ready.anchors
        .slice(index + 1)
        .find((item) => item.status === "matched");
    const origin = before?.end ?? after?.start ?? 0;
    // Reader EPUB exports often retain a chapter/figure number only in the highlight URL.
    // Prioritize its caption, but still require identical bytes before binding anything.
    const name = query.resource.split("/").pop()?.split(/[?#]/)[0] || "";
    const figure = name.match(/(?:^|[_-])(\d{2})(\d{2})(?:\.[a-z]+)$/i);
    const caption = figure
      ? new RegExp(
          "^\\s*(?:#{1,6}\\s*)?[*_]{0,2}(?:рисунок|figure|fig\\.?)\\s+0?" +
            Number(figure[1]) +
            "[-–.]0?" +
            Number(figure[2]) +
            "(?:[.\\s:]|$)",
          "i",
        )
      : undefined;
    const ranked = [...images].sort((a, b) => {
      const rank = (image: ImageReference): number => {
        if (caption?.test(ready.markdown.slice(image.end, image.end + 400)))
          return -1e12;
        const outside =
          (before?.end !== undefined && image.start < before.end) ||
          (after?.start !== undefined && image.start > after.start);
        return (outside ? 1e9 : 0) + Math.abs(image.start - origin);
      };
      return rank(a) - rank(b);
    });
    const found = new Set<string>();
    const check = async (image: ImageReference) => {
      if ((await digest(image.resource, ready.path as string)) === hash)
        found.add(imageIdentity(image.resource));
    };
    try {
      let from = 0;
      if (
        caption?.test(ready.markdown.slice(ranked[0].end, ranked[0].end + 400))
      ) {
        // Do not hold a verified figure behind unrelated slow image downloads.
        await check(ranked[0]);
        from = 1;
      }
      for (
        ;
        from < ranked.length && !signal.aborted && !found.size;
        from += 3
      ) {
        await Promise.all(ranked.slice(from, from + 3).map(check));
      }
    } finally {
      const candidates = images
        .filter((image) => found.has(imageIdentity(image.resource)))
        .map(({ start, end }) => ({ start, end }));
      const matched =
        !signal.aborted && candidates.length
          ? {
              ...anchor,
              candidates,
              status:
                candidates.length === 1
                  ? ("matched" as const)
                  : ("ambiguous" as const),
              start: candidates.length === 1 ? candidates[0].start : undefined,
              end: candidates.length === 1 ? candidates[0].end : undefined,
            }
          : undefined;
      if (Object.keys(added).length || matched)
        await this.repository.saveImageMatches(
          document,
          ready.revision,
          added,
          matched,
        );
    }
    if (!signal.aborted) return this.resolve(document, false);
  }
  private async result(
    document: WorkspaceDocument,
    path: string,
    originalPath?: string,
    bound?: DocumentSource,
  ): Promise<ContentResolution> {
    const snapshot = await this.text(path),
      { markdown, revision } = snapshot;
    const source = bound || (await this.repository.source(document)),
      nodes = (await this.repository.nodesFor(document)).filter(
        (node) => node.kind === "highlight",
      );
    const hints = nodes.map((node) => {
      let fm = this.metadata.get(node);
      if (!fm) {
        fm = parseMarkdown(node.raw).metadata;
        this.metadata.set(node, fm);
      }
      return fm;
    });
    const fingerprint = JSON.stringify(
      nodes.map((node, index) => [
        node.path,
        node.quote,
        hints[index].rwt_source_url,
        hints[index].rwt_reader_highlight_id,
        hints[index].rwt_reader_offset,
      ]),
    );
    const manifest = manifestPath(document);
    const signature = (stamp: number) =>
      JSON.stringify([path, revision, fingerprint, originalPath, stamp]);
    const cached = this.results.get(document.id);
    if (cached?.signature === signature(this.stamp(manifest)))
      return cached.value;
    const previous = new Map(
        source.anchors.map((anchor) => [anchor.nodePath, anchor]),
      ),
      anchors = [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index],
        fm = hints[index],
        old = previous.get(node.path);
      const reusable =
        old &&
        old.revision === revision &&
        old.quote === node.quote &&
        (old.matcherVersion === QUOTE_MATCHER_VERSION ||
          (old.manual &&
            old.start !== undefined &&
            old.end !== undefined &&
            markdown.slice(old.start, old.end) === old.selectedText));
      if (!reusable && !snapshot.prepared)
        snapshot.prepared = await prepareQuoteIndex(markdown);
      const anchor = reusable
        ? { ...old, candidates: [...old.candidates] }
        : locateQuote(
            markdown,
            node.quote,
            node.path,
            revision,
            old,
            snapshot.prepared,
          );
      anchor.readerUrl =
        typeof fm.rwt_source_url === "string"
          ? fm.rwt_source_url
          : anchor.readerUrl;
      anchor.readerHighlightId =
        typeof fm.rwt_reader_highlight_id === "string"
          ? fm.rwt_reader_highlight_id
          : anchor.readerHighlightId;
      anchor.readerOffset =
        typeof fm.rwt_reader_offset === "number"
          ? fm.rwt_reader_offset
          : anchor.readerOffset;
      if (anchor.readerOffset !== undefined)
        anchor.candidates.sort(
          (a, b) =>
            Math.abs(a.start - (anchor.readerOffset || 0)) -
            Math.abs(b.start - (anchor.readerOffset || 0)),
        );
      anchors.push(anchor);
      if (index % 30 === 29) await yieldToEventLoop();
    }
    // The manifest may have gained hand-placed anchors while the pass ran.
    const latest = await this.repository.source(document);
    const kept = keepManualAnchors(anchors, latest.anchors, revision, (nodePath) =>
      this.repository.storage.exists(nodePath),
    );
    await this.repository.saveSource(document, {
      contentPath: path,
      contentHash: revision,
      anchors: kept,
    });
    const value: ContentResolution = {
      status: "ready",
      markdown,
      path,
      revision,
      originalPath,
      anchors: kept,
    };
    this.results.delete(document.id);
    this.results.set(document.id, {
      signature: signature(this.stamp(manifest)),
      value,
    });
    while (this.results.size > 2) {
      const oldest = this.results.keys().next().value as string;
      this.results.delete(oldest);
    }
    return value;
  }
  async attach(
    document: WorkspaceDocument,
    path: string,
  ): Promise<ContentResolution> {
    const data = await this.repository.storage.readBinary(path),
      hash = await sha256(data);
    await this.repository.saveSource(document, {
      originalPath: path,
      originalHash: hash,
    });
    if (/\.(md|txt)$/i.test(path)) return this.result(document, path, path);
    const markdown = await extractFile(
      path,
      data,
      this.repository.storage,
      this.assets(),
    );
    return this.cache(document, markdown, path);
  }
  async saveAsset(
    name: string,
    data: ArrayBuffer,
  ): Promise<{ path: string; hash: string }> {
    const hash = await sha256(data),
      pending = this.assetsInFlight.get(hash);
    if (pending) return pending;
    const save = async () => {
      const storage = this.repository.storage,
        files = storage.files(),
        extension =
          name
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "bin";
      const existing = files.find((file) =>
        file.path.startsWith(pathJoin(this.assets(), hash) + "."),
      );
      if (
        existing &&
        (await sha256(await storage.readBinary(existing.path))) === hash
      )
        return { path: existing.path, hash };
      for (const file of files.filter((file) => isManifestPath(file.path))) {
        const fm = parseMarkdown(await storage.read(file.path)).metadata;
        if (
          fm.rwt_original_hash === hash &&
          typeof fm.rwt_original === "string"
        ) {
          const path = this.repository.resolve(fm.rwt_original, file.path);
          if (
            storage.exists(path) &&
            (await sha256(await storage.readBinary(path))) === hash
          )
            return { path, hash };
        }
      }
      const path = pathJoin(this.assets(), hash + "." + extension);
      if (!storage.exists(path)) await storage.createBinary(path, data);
      else if ((await sha256(await storage.readBinary(path))) !== hash)
        throw new Error(
          "The existing asset was changed. Choose a different original file.",
        );
      return { path, hash };
    };
    const task = save().finally(() => this.assetsInFlight.delete(hash));
    this.assetsInFlight.set(hash, task);
    return task;
  }
  private async cache(
    document: WorkspaceDocument,
    markdown: string,
    originalPath?: string,
    signal?: AbortSignal,
  ): Promise<ContentResolution> {
    if (!markdown.trim()) return emptyResolution("processing", { originalPath });
    const storage = this.repository.storage,
      path = contentPath(document),
      content = serializeMarkdown(contentFrontmatter(document), markdown);
    // Never overwrite an existing source or manual edits during a refresh.
    if (!storage.exists(path)) await storage.create(path, content);
    else {
      const current = parseMarkdown(await storage.read(path)).body;
      if ((await sha256(current)) !== (await sha256(markdown))) {
        const revisionPath = pathJoin(
          document.workspacePath,
          "Source",
          `content-${(await sha256(markdown)).slice(0, 12)}.md`,
        );
        if (!storage.exists(revisionPath)) await storage.create(revisionPath, content);
        if (signal?.aborted) return this.resolve(document, false);
        await this.repository.saveSource(document, {
          contentPath: revisionPath,
          fetchedAt: new Date().toISOString(),
          tableFormat: TABLE_FORMAT_VERSION,
        });
        return this.result(document, revisionPath, originalPath);
      }
    }
    if (signal?.aborted) return this.resolve(document, false);
    await this.repository.saveSource(document, {
      contentPath: path,
      fetchedAt: new Date().toISOString(),
      tableFormat: TABLE_FORMAT_VERSION,
    });
    return this.result(document, path, originalPath);
  }
  private async load(
    document: WorkspaceDocument,
    remote: boolean,
  ): Promise<ContentResolution> {
    const storage = this.repository.storage,
      source = await this.repository.source(document);
    if (source.contentPath && storage.exists(source.contentPath))
      return this.result(
        document,
        source.contentPath,
        source.originalPath,
        source,
      );
    if (
      document.category === "markdown" &&
      document.notePath &&
      storage.exists(document.notePath)
    )
      return this.result(
        document,
        document.notePath,
        source.originalPath,
        source,
      );
    if (source.originalPath && storage.exists(source.originalPath)) {
      try {
        return await this.cache(
          document,
          await extractFile(
            source.originalPath,
            await storage.readBinary(source.originalPath),
            storage,
            this.assets(),
          ),
          source.originalPath,
        );
      } catch (error) {
        if (!remote || !document.readerId) throw error;
      }
    }
    if (document.notePath && storage.exists(document.notePath)) {
      const book = await storage.read(document.notePath);
      const section =
        book.match(
          /(?:^|\n)##\s+(?:Full Document|Полный текст|Full text)[^\n]*\n([\s\S]*?)(?=\n## |$)/i,
        )?.[1] || "";
      const link = section.match(/\[\[[^\]]+\]\]/)?.[0];
      const target = link
        ? storage.resolve(link, document.notePath)
        : undefined;
      if (target && target !== document.notePath && storage.exists(target))
        return this.result(document, target, source.originalPath, source);
    }
    if (!remote || !document.readerId)
      return emptyResolution("missing", { originalPath: source.originalPath });
    // Full books are large responses; the short default is for small lookups.
    const content = await this.network(
      "reader:" + document.readerId,
      () => this.transport.getDocumentContent(document.readerId as string),
      this.options.networkTimeoutMs ?? 60_000,
    );
    if (!content) return emptyResolution("processing");
    if (content.html_content?.trim())
      return this.cache(
        document,
        await htmlToMarkdownAsync(content.html_content),
        source.originalPath,
      );
    if (content.raw_source_url) {
      const data = await this.network(
          "download:" + document.id,
          () => this.transport.download(content.raw_source_url as string),
          this.options.networkTimeoutMs ?? 180_000,
        ),
        ext =
          content.category === "epub"
            ? "epub"
            : content.category === "pdf"
              ? "pdf"
              : "html";
      const saved = await this.saveAsset(document.title + "." + ext, data);
      await this.repository.saveSource(document, {
        originalPath: saved.path,
        originalHash: saved.hash,
      });
      return this.cache(
        document,
        await extractFile(saved.path, data, storage, this.assets()),
        saved.path,
      );
    }
    return emptyResolution("missing", { originalPath: source.originalPath });
  }
}
