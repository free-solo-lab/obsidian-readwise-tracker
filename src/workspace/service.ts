import { Component, MarkdownRenderer, Notice, Platform, TFile, requestUrl, type Plugin } from "obsidian";
import { textBlocks } from "./focus";
import type { LocalBook } from "../models/store";
import { mayContainFlatTable } from "./highlightTables";
import type { ReadwiseDocument } from "../models/readwise";
import type { DataManager } from "../services/dataManager";
import type { ReadwiseService } from "../services/readwise";
import type { ReadwiseTrackerSettings } from "../settings/types";
import {
  findBookNoteFile,
  findHighlightFilesForBook,
  getHighlightsRoot,
} from "../services/readwiseFiles";
import {
  isPluginDataRecord,
  updatePluginData,
} from "../services/pluginDataPersistence";
import { fileStem, parseMarkdown, pathJoin } from "./markdown";
import {
  ASSETS_FOLDER,
  WORKSPACE_FOLDER,
  isManifestPath,
  isNoteBodyPath,
  isWorkspacePath,
  manifestPath,
} from "./layout";
import { ObsidianWorkspaceStorage } from "./obsidianStorage";
import { WorkspaceRepository } from "./repository";
import { DocumentSourceResolver } from "./source";
import { WorkspaceImporter, importCandidates } from "./import";
import { sanitizeHtml, sha256 } from "./content";
import { CodexBridgeAdapter } from "./ai";
import {
  TranslationRunner,
  translatedMarkdown,
  translationLanguage,
} from "./translation";
import { ProgressMirror } from "./progress";
import { applyReaderLocation } from "../services/readerLocation";
import { DialogRunner } from "./dialog";
import { parseHighlightNote } from "../services/readwiseHighlightParsing";
import { t } from "../i18n";
import { errorMessage } from "../utils/errors";
import { Listeners, debounce } from "../utils/timing";
import type { ImportJob, WorkspaceDocument, WorkspaceFile, WorkspaceNode } from "./types";

const SAVED_USING = "obsidian-readwise-tracker";
const trimSlash = (path: string) => path.replace(/\/$/, "");
const sameTitle = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * One instance per plugin: owns the workspace repository, the content resolver and the
 * background runners, and tells open views when anything they show may have changed.
 */
export class BookWorkspaceService {
  readonly storage: ObsidianWorkspaceStorage;
  readonly repository: WorkspaceRepository;
  readonly sources: DocumentSourceResolver;
  readonly importer: WorkspaceImporter;
  readonly dialogs: DialogRunner;
  readonly translations: TranslationRunner;
  readonly progress: ProgressMirror;
  private readonly listeners = new Listeners();
  private readonly documents = new Map<string, WorkspaceDocument>();
  /** Ids whose cached document is known current; the object itself is kept for stable identity. */
  private readonly current = new Set<string>();
  private generation = 0;
  private readonly pendingRenames: Array<[string, string]> = [];
  private readonly edits = new Set<() => Promise<void>>();
  /** Views are told about changes once per burst of vault events. */
  readonly changed = debounce(() => this.listeners.notify(), 160);
  /** Whatever changed Reader's data is followed by one quiet sync, however many changes came together. */
  readonly afterReaderChange = debounce(() => {
    void this.sync().catch((error) => this.report(error));
  }, 2500);
  /** A folder rename fires one event per file; the links inside notes are repaired in one pass. */
  private readonly repairRenames = debounce(() => {
    void this.repository
      .repairRenames(this.pendingRenames.splice(0))
      .then(() => this.changed())
      .catch((error) => this.report(error));
  }, 150);

  constructor(
    private readonly plugin: Plugin,
    private readonly settings: () => ReadwiseTrackerSettings,
    private readonly data: DataManager,
    private readonly reader: ReadwiseService,
    private readonly sync: () => Promise<void>,
  ) {
    this.storage = new ObsidianWorkspaceStorage(plugin.app);
    this.repository = new WorkspaceRepository(this.storage, () => ({
      highlights: getHighlightsRoot(settings()),
      inbox: trimSlash(settings().readwiseInboxFolder),
    }));
    this.sources = new DocumentSourceResolver(
      this.repository,
      {
        getDocumentContent: (id) => reader.getDocumentContent(id),
        download: async (url) =>
          (await requestUrl({ url, method: "GET" })).arrayBuffer,
      },
      () => pathJoin(getHighlightsRoot(settings()), ASSETS_FOLDER),
    );
    this.importer = new WorkspaceImporter(
      {
        get: async (key) => {
          const raw: unknown = await plugin.loadData();
          return isPluginDataRecord(raw) &&
            isPluginDataRecord(raw.workspaceImports)
            ? (raw.workspaceImports[key] as ImportJob | undefined)
            : undefined;
        },
        put: (job) =>
          updatePluginData(plugin, (current) => ({
            ...current,
            workspaceImports: {
              ...(isPluginDataRecord(current.workspaceImports)
                ? current.workspaceImports
                : {}),
              [job.key]: job,
            },
          })),
      },
      {
        save: async (request) => (await reader.saveDocument(request)).id,
        upload: async (name, mime, bytes) =>
          (
            await reader.uploadFile(
              name,
              mime,
              bytes,
              settings().readwiseReaderSessionCookie,
            )
          ).docs_ids,
        exists: async (ids) => {
          for (const id of ids) if (await reader.getDocument(id)) return true;
          return false;
        },
        tags: (ids, tags) => reader.addDocumentTagsWhenReady(ids, tags),
        sync,
        asset: (name, bytes) => this.sources.saveAsset(name, bytes),
        bind: async (job) => {
          for (const id of job.readerIds) {
            const document = await this.document(id, {
              title: job.title || job.name,
              category: job.category,
            });
            await this.repository.saveSource(
              document,
              job.originalPath
                ? {
                    originalPath: job.originalPath,
                    originalHash: job.key.replace(/^file:/, ""),
                  }
                : {},
            );
          }
          this.changed();
        },
        find: async (job) => {
          const since = job.startedAt
            ? new Date(new Date(job.startedAt).getTime() - 60_000).toISOString()
            : undefined;
          const candidates = importCandidates(
            job,
            await reader.getAllDocuments(undefined, undefined, since),
          );
          if (job.sourceUrl)
            return candidates.length === 1 ? [candidates[0].id] : [];
          const matches: string[] = [];
          // Each check downloads a whole file, so only a few candidates are compared.
          for (const candidate of candidates.slice(0, 3)) {
            const detail = await reader.getDocumentContent(candidate.id);
            if (!detail?.raw_source_url) continue;
            const binary = (await requestUrl({ url: detail.raw_source_url }))
              .arrayBuffer;
            if ("file:" + (await sha256(binary)) === job.key)
              matches.push(candidate.id);
          }
          return matches.length === 1 ? matches : [];
        },
      },
    );
    const ai = new CodexBridgeAdapter(
      () => plugin.app,
      () => settings().workspaceAiModel,
      () => Platform.isMobile,
      () => settings().workspaceAiFullAccess,
    );
    this.progress = new ProgressMirror(
      (id, value) => reader.updateDocumentProgress(id, value),
      (id) => this.archiveReaderDocument(id),
      (error) => this.report(error),
    );
    this.translations = new TranslationRunner(this.storage, ai, () =>
      this.changed(),
    );
    this.dialogs = new DialogRunner(
      this.repository,
      ai,
      (document, dialog) => this.notesFor(document, dialog),
      () => this.changed(),
      (document, dialog, ids) => this.linkReaderDocuments(document, dialog, ids),
      (error) => this.report(error),
    );
    this.watchVault();
    plugin.register(() => this.dispose());
  }

  private watchVault(): void {
    const { plugin } = this;
    // Any event drops the cached file listing, but only files the workspace
    // reads wake the UI; editing unrelated notes must not trigger rescans.
    const touched = (file: { path: string }) => {
      this.storage.invalidate();
      if (!this.relevant(file.path)) return;
      if (!isNoteBodyPath(file.path)) this.stale();
      this.changed();
    };
    plugin.registerEvent(plugin.app.vault.on("create", touched));
    plugin.registerEvent(plugin.app.vault.on("modify", touched));
    plugin.registerEvent(plugin.app.vault.on("delete", touched));
    plugin.registerEvent(plugin.app.metadataCache.on("changed", touched));
    plugin.registerEvent(
      plugin.app.vault.on("rename", (file, oldPath) => {
        this.storage.invalidate();
        this.stale();
        this.repository.trackRename(oldPath, file.path);
        this.pendingRenames.push([oldPath, file.path]);
        this.repairRenames();
      }),
    );
  }

  private dispose(): void {
    this.dialogs.cancelAll();
    this.translations.cancelAll();
    void this.progress.flushAll();
    this.progress.dispose();
    this.changed.cancel();
    this.afterReaderChange.cancel();
    this.repairRenames.cancel();
    this.listeners.clear();
    void this.flush().catch((error) => this.report(error));
  }

  /** The reader's own notes behind a dialog: quote and comment of every highlight it refers to. */
  private async notesFor(
    document: WorkspaceDocument,
    dialog: { sources: string[]; path: string },
  ) {
    const graph = await this.repository.graph(),
      byPath = new Map(graph.map((node) => [node.path, node]));
    const paths = new Set<string>();
    for (const source of dialog.sources) {
      const node = byPath.get(source.split("#")[0]);
      if (node)
        for (const path of this.repository.sourceHighlights(node, graph))
          paths.add(path);
    }
    const notes: Array<{ label: string; quote: string; comment: string }> = [];
    for (const path of [...paths].slice(0, 12)) {
      const node = byPath.get(path);
      if (!node) continue;
      const full = await this.repository.hydrate(node),
        parsed = parseHighlightNote(full.raw || full.body);
      notes.push({
        label: `${document.title} · ${full.title}`,
        quote: parsed.quote,
        comment: parsed.description,
      });
    }
    return notes;
  }
  private stale(): void {
    this.generation++;
    this.current.clear();
  }
  private relevant(path: string): boolean {
    const highlights = getHighlightsRoot(this.settings()),
      inbox = trimSlash(this.settings().readwiseInboxFolder);
    return (
      (!!highlights && path.startsWith(highlights + "/")) ||
      (!!inbox && path.startsWith(inbox + "/")) ||
      isWorkspacePath(path) ||
      this.repository.watched.has(path)
    );
  }
  report(error: unknown): void {
    new Notice(errorMessage(error), 9000);
  }
  /** After a sync: books, titles and note locations may all have changed. */
  reload(): void {
    this.stale();
    this.changed();
  }
  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }
  /** Open editors register how to save their unsaved text; `flush` runs all of them. */
  editor(flush: () => Promise<void>): () => void {
    this.edits.add(flush);
    return () => this.edits.delete(flush);
  }
  async flush(): Promise<void> {
    await Promise.all([...this.edits].map((flush) => flush()));
    await this.repository.flush();
  }
  /** Every workspace manifest with its frontmatter, read directly when the metadata cache lags behind. */
  private async manifests(): Promise<Array<{ file: WorkspaceFile; metadata: Record<string, unknown> }>> {
    const result = [];
    for (const file of this.storage.files().filter((f) => isManifestPath(f.path)))
      result.push({
        file,
        metadata: parseMarkdown(await this.storage.read(file.path)).metadata,
      });
    return result;
  }
  private async manifestOf(id: string): Promise<WorkspaceFile | undefined> {
    const cached = this.storage
      .files()
      .find((f) => isManifestPath(f.path) && f.metadata?.rwt_document === id);
    if (cached) return cached;
    // MetadataCache may not yet have parsed newly imported manifests.
    return (await this.manifests()).find((entry) => entry.metadata.rwt_document === id)?.file;
  }
  async document(
    id: string,
    fallback?: { title: string; category: string },
  ): Promise<WorkspaceDocument> {
    const cached = this.documents.get(id);
    // Cleared by relevant vault events and by syncs, so a hit is always current.
    if (cached && this.current.has(id)) return cached;
    const generation = this.generation;
    const manifest = await this.manifestOf(id);
    const book: LocalBook | undefined = this.data.getBook(id);
    let remote: ReadwiseDocument | undefined;
    if (!book && !fallback && !manifest && !id.startsWith("vault:"))
      remote = await this.reader.getDocument(id);
    if (remote)
      fallback = {
        title: remote.title || remote.readable_title || id,
        category: remote.category || "article",
      };
    const manifestMeta = manifest
      ? parseMarkdown(await this.storage.read(manifest.path)).metadata
      : {};
    const localPath = id.startsWith("vault:")
      ? typeof manifestMeta.book === "string"
        ? this.repository.resolve(manifestMeta.book, manifest?.path || "")
        : id.slice(6)
      : undefined;
    const localFile = localPath
      ? this.plugin.app.vault.getAbstractFileByPath(localPath)
      : null;
    if (localPath && !(localFile instanceof TFile))
      throw new Error("The linked Markdown file no longer exists.");
    const title =
      book?.title ||
      (localFile instanceof TFile ? localFile.basename : fallback?.title) ||
      String(manifestMeta.rwt_title || id);
    const bookFile = book
      ? findBookNoteFile(this.plugin.app, this.settings(), book)
      : null;
    const ambiguous =
      !bookFile &&
      Object.values(this.data.getData().books).filter((b) => sameTitle(b.title, title)).length > 1;
    const highlights =
      book && !ambiguous
        ? findHighlightFilesForBook(this.plugin.app, this.settings(), book)
        : [];
    const suffix =
      !book || ambiguous ? " — " + (await sha256(id)).slice(0, 8) : "";
    const workspacePath =
      manifest?.path.replace(/\/Source\/source\.md$/, "") ||
      cached?.workspacePath ||
      pathJoin(
        highlights[0]?.parent?.path ||
          pathJoin(
            getHighlightsRoot(this.settings()),
            (bookFile?.basename || fileStem(title)) + suffix,
          ),
        WORKSPACE_FOLDER,
      );
    const localAuthor =
      localFile instanceof TFile
        ? (this.plugin.app.metadataCache.getFileCache(localFile)?.frontmatter
            ?.author as unknown)
        : undefined;
    const document: WorkspaceDocument = {
      id,
      title,
      author:
        book?.author ||
        remote?.author ||
        (typeof localAuthor === "string"
          ? localAuthor
          : Array.isArray(localAuthor)
            ? localAuthor.filter((a) => typeof a === "string").join(", ")
            : "") ||
        String(manifestMeta.rwt_author || ""),
      category: localPath
        ? "markdown"
        : book?.category || fallback?.category || "article",
      readerId: localPath ? undefined : book?.readwise_id || id,
      notePath: localPath || bookFile?.path,
      highlightsFolder:
        highlights[0]?.parent?.path ||
        workspacePath.replace(new RegExp(`/${WORKSPACE_FOLDER}$`), ""),
      workspacePath,
    };
    if (generation === this.generation) this.current.add(id);
    if (cached && JSON.stringify(cached) === JSON.stringify(document))
      return cached;
    this.documents.set(id, document);
    return document;
  }
  /** The document behind a vault file: its workspace manifest, its own manifest's `book` link, or a tracked book note. */
  async fromPath(path: string): Promise<WorkspaceDocument> {
    const file = this.storage.files().find((f) => f.path === path);
    if (typeof file?.metadata?.rwt_document === "string")
      return this.document(file.metadata.rwt_document);
    for (const { file: manifest, metadata } of await this.manifests()) {
      if (
        typeof metadata.book === "string" &&
        this.repository.resolve(metadata.book, manifest.path) === path &&
        typeof metadata.rwt_document === "string"
      )
        return this.document(metadata.rwt_document);
    }
    const book = Object.values(this.data.getData().books).find(
      (b) =>
        findBookNoteFile(this.plugin.app, this.settings(), b)?.path === path,
    );
    return this.document(book?.id || "vault:" + path);
  }
  async formatHighlightQuotes(
    context: { book?: LocalBook; bookPath?: string },
    quotes: string[],
  ): Promise<string[]> {
    if (!quotes.some(mayContainFlatTable)) return quotes;
    try {
      const document = context.book
        ? await this.document(context.book.id)
        : context.bookPath
          ? await this.fromPath(context.bookPath)
          : undefined;
      if (document)
        return await this.sources.formatHighlightQuotes(
          document,
          quotes,
          !!this.settings().readwiseToken,
        );
    } catch (error) {
      if (this.settings().debugLogging)
        console.warn(
          "Readwise: table structure was unavailable; the original highlight is preserved.",
          error,
        );
    }
    return quotes;
  }
  async archiveReaderDocument(id: string): Promise<void> {
    await this.reader.updateDocumentLocation(id, "archive");
    const current = this.data.getBook(id);
    await this.data.saveReaderLocationChange(
      id,
      "archive",
      current
        ? applyReaderLocation(current, "archive", new Date().toISOString())
        : undefined,
    );
    this.reload();
    this.afterReaderChange();
  }
  private async renderHtml(markdown: string, path: string): Promise<string> {
    const host = window.document.createElement("div"),
      owner = new Component();
    owner.load();
    try {
      await MarkdownRenderer.render(this.plugin.app, markdown, host, path, owner);
      // Pictures stored in the vault are not reachable from Reader.
      for (const image of Array.from(host.querySelectorAll("img")))
        if (!/^https?:\/\//i.test(image.getAttribute("src") || ""))
          image.remove();
      return sanitizeHtml(host.innerHTML);
    } finally {
      owner.unload();
    }
  }
  /**
   * The translation becomes its own Reader article (Reader cannot swap the text of an existing one) and
   * a link in the book; the original stays here and in Reader unless it is archived on request.
   */
  async publishTranslation(
    document: WorkspaceDocument,
    sourceMarkdown: string,
    original: "keep" | "archive",
    language = "ru",
  ): Promise<void> {
    const mark = translationLanguage(language).mark;
    const translation = await this.translations.load(document, language);
    if (!translation?.complete) throw new Error(t("workspace.publish.incomplete"));
    const html = await this.renderHtml(
      translatedMarkdown(textBlocks(sourceMarkdown), translation),
      document.notePath || document.workspacePath,
    );
    const title = `${document.title} (${mark})`;
    const job = await this.importer.url({
      url: `https://obsidian.local/translation/${language}/${encodeURIComponent(document.id)}`,
      html,
      should_clean_html: true,
      title,
      author: document.author || undefined,
      category: "article",
      location: "new",
      tags: [t("workspace.publish.tag")],
      saved_using: SAVED_USING,
    });
    const id = job.readerIds[0];
    if (id) {
      const saved = await this.document(id, { title, category: "article" });
      await this.linkOnce(document, saved, []);
    }
    this.reload();
    if (original === "archive" && document.readerId)
      await this.archiveReaderDocument(document.readerId);
    this.afterReaderChange();
  }
  /** Documents Codex saved to Reader: load them with a sync and link each one to the dialog's notes. */
  async linkReaderDocuments(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    ids: string[],
  ): Promise<void> {
    await this.sync();
    for (const id of ids) {
      const saved = await this.document(id, { title: id, category: "article" });
      await this.linkOnce(document, saved, dialog.sources);
    }
    this.reload();
  }
  /** A "relation" note from `document` to `target`, unless one exists already. */
  private async linkOnce(
    document: WorkspaceDocument,
    target: WorkspaceDocument,
    sources: string[],
  ): Promise<void> {
    const path = await this.target(target);
    const linked = (await this.repository.nodesFor(document)).some(
      (node) => node.kind === "relation" && node.target === path,
    );
    if (!linked) await this.repository.create(document, "relation", "", sources, path);
  }
  /** The vault path a relation points at: the book note, or the manifest of a document without one. */
  async target(document: WorkspaceDocument): Promise<string> {
    await this.repository.saveSource(document, {});
    return document.notePath || manifestPath(document);
  }
}
