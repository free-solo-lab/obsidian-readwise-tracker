import { parseHighlightNote } from "../services/readwiseHighlightParsing";
import { readHighlightMetadata } from "../services/readwiseHighlightMetadata";
import {
  basename,
  blockquote,
  fileStem,
  isWorkspaceResource,
  linkPath,
  nodeKind,
  parseMarkdown,
  parseMessages,
  pathJoin,
  serializeMarkdown,
  serializeMessages,
  stringList,
  wiki,
} from "./markdown";
import {
  MANAGED_PATH,
  NOTE_FOLDERS,
  NOTE_FOLDER_PATH,
  chatPath,
  isWorkspacePath,
  manifestPath,
} from "./layout";
import type {
  DialogMessage,
  DocumentSource,
  SourceAnchor,
  WorkspaceDocument,
  WorkspaceNode,
  WorkspaceFile,
  WorkspaceNodeKind,
  WorkspaceStorage,
} from "./types";

const conflictCopyPath = (path: string) =>
  path.replace(/\.md$/, ` — conflict-${crypto.randomUUID().slice(0, 8)}.md`);

export class WorkspaceConflictError extends Error {
  /** `copyRaw` is the exact content of the preserved copy; editors rebase onto it. */
  constructor(
    public readonly copyPath: string,
    public readonly copyRaw: string,
  ) {
    super(
      `The note changed outside this editor. Your draft was preserved: ${copyPath}`,
    );
  }
}
export class WorkspaceRepository {
  private cache = new Map<
    string,
    { mtime: number; node: WorkspaceNode | null }
  >();
  /** Full notes of recently opened books; every other highlight stays a light stub. */
  private hydrated = new Map<string, { mtime: number; node: WorkspaceNode }>();
  private fileIndex = new Map<string, WorkspaceFile>();
  private lastFiles: { files: WorkspaceFile[]; roots: string } | undefined;
  private dirty = true;
  /** Book notes and attached texts living outside the managed folders. */
  readonly watched = new Set<string>();
  private versions = new Map<string, { base: string; written: string }>();
  private writes = new Map<string, Promise<unknown>>();
  /** Open editors may still hold the old path for a short while after a rename. */
  private renames = new Map<string, { to: string; at: number }>();
  private scan: Promise<WorkspaceNode[]> | undefined;
  private snapshot: { signature: string; nodes: WorkspaceNode[] } | undefined;
  private documentNodes = new Map<
    string,
    { graph: WorkspaceNode[]; nodes: WorkspaceNode[] }
  >();
  private origins = new WeakMap<
    WorkspaceNode[],
    { byPath: Map<string, WorkspaceNode>; memo: Map<string, string[]> }
  >();
  constructor(
    public readonly storage: WorkspaceStorage,
    private readonly roots: () => { highlights: string; inbox: string },
  ) {}
  private currentPath(path: string): string {
    const now = Date.now();
    for (const [old, { to, at }] of this.renames) {
      if (now - at > 60_000) this.renames.delete(old);
      else if (path === old || path.startsWith(old + "/"))
        path = to + path.slice(old.length);
    }
    return path;
  }

  resolve(link: string, from: string): string {
    const path = linkPath(link),
      block = link.match(/#(\^[\w-]+)/)?.[1];
    const resolved =
      this.storage.resolve(link, from) ||
      (this.storage.exists(path) ? path : path + ".md");
    return resolved + (block ? "#" + block : "");
  }
  private forget(path: string): void {
    this.cache.delete(path);
    this.hydrated.delete(path);
    this.dirty = true;
  }
  /**
   * The link graph: editable notes are complete, highlights are light stubs
   * (path, index, links) so opening one book never reads the whole vault.
   */
  async graph(): Promise<WorkspaceNode[]> {
    if (this.scan) return this.scan;
    const task = this.scanNodes().finally(() => {
      if (this.scan === task) this.scan = undefined;
    });
    this.scan = task;
    return task;
  }
  private isStub(file: WorkspaceFile, roots: { highlights: string; inbox: string }): boolean {
    return (
      file.path.startsWith(roots.highlights + "/") &&
      !file.path.startsWith(roots.inbox + "/") &&
      !MANAGED_PATH.test(file.path) &&
      !file.metadata?.rwt_kind &&
      file.metadata?.type !== "inbox"
    );
  }
  private build(
    file: WorkspaceFile,
    roots: { highlights: string },
    raw: string | undefined,
  ): WorkspaceNode | null {
    const parsed = raw === undefined ? undefined : parseMarkdown(raw),
      fm = parsed?.metadata ?? file.metadata ?? {};
    let kind = nodeKind(file.path, fm);
    if (
      !kind &&
      file.path.startsWith(roots.highlights + "/") &&
      !isWorkspaceResource(file.path, fm)
    )
      kind = "highlight";
    if (!kind) return null;
    const meta = readHighlightMetadata(file.basename, fm, raw),
      highlight = kind === "highlight" && raw ? parseHighlightNote(raw) : null;
    const sources = stringList(fm.rwt_sources ?? fm.source).map((link) =>
      this.resolve(link, file.path),
    );
    return {
      id: typeof fm.rwt_id === "string" ? fm.rwt_id : "legacy:" + file.path,
      kind,
      path: file.path,
      documentId:
        typeof fm.rwt_document === "string" ? fm.rwt_document : undefined,
      book:
        typeof fm.book === "string"
          ? this.resolve(fm.book, file.path)
          : undefined,
      body: parsed?.body ?? "",
      quote: highlight?.quote || "",
      title: kind === "highlight" ? meta.title : fileStem(parsed?.body ?? ""),
      index: meta.index,
      order:
        typeof fm.rwt_order === "number" && Number.isFinite(fm.rwt_order)
          ? fm.rwt_order
          : meta.index,
      sources,
      important: fm.rwt_important === true || undefined,
      target:
        typeof fm.rwt_target === "string"
          ? this.resolve(fm.rwt_target, file.path)
          : undefined,
      raw: raw ?? "",
      mtime: file.mtime,
      stub: raw === undefined || undefined,
    };
  }
  /** Read the complete note behind a stub; recent ones are kept, bounded. */
  async hydrate(node: WorkspaceNode): Promise<WorkspaceNode> {
    if (!node.stub) return node;
    const file = this.fileIndex.get(node.path);
    if (!file) return node;
    const known = this.hydrated.get(node.path);
    if (known?.mtime === file.mtime) return known.node;
    const full = this.build(file, this.roots(), await this.storage.read(file.path));
    if (!full) return node;
    this.hydrated.delete(node.path);
    this.hydrated.set(node.path, { mtime: file.mtime, node: full });
    while (this.hydrated.size > 6000)
      this.hydrated.delete(this.hydrated.keys().next().value as string);
    return full;
  }
  private async scanNodes(): Promise<WorkspaceNode[]> {
    const roots = this.roots(),
      files = this.storage.files(),
      rootKey = JSON.stringify(roots);
    if (
      !this.dirty &&
      this.snapshot &&
      this.lastFiles?.files === files &&
      this.lastFiles.roots === rootKey
    )
      return this.snapshot.nodes;
    this.fileIndex = new Map(files.map((f) => [f.path, f]));
    for (const path of this.cache.keys())
      if (!this.fileIndex.has(path)) this.cache.delete(path);
    for (const path of this.hydrated.keys())
      if (!this.fileIndex.has(path)) this.hydrated.delete(path);
    const candidates = files
      .filter(
        (f) =>
          f.path.endsWith(".md") &&
          (!isWorkspaceResource(f.path, f.metadata) ||
            f.metadata?.type === "inbox" ||
            f.path.startsWith(roots.inbox + "/") ||
            NOTE_FOLDER_PATH.test(f.path) ||
            ["thought", "dialog", "relation"].includes(
              String(f.metadata?.rwt_kind),
            )),
      )
      .filter(
        (f) =>
          f.path.startsWith(roots.highlights + "/") ||
          f.path.startsWith(roots.inbox + "/") ||
          !!f.metadata?.rwt_kind ||
          f.metadata?.type === "inbox",
      );
    const signature = JSON.stringify([
      roots,
      candidates.map((file) => [
        file.path,
        file.mtime,
        file.metadata?.type,
        file.metadata?.rwt_kind,
      ]),
    ]);
    if (
      this.snapshot?.signature === signature &&
      candidates.every((file) => this.cache.has(file.path))
    ) {
      this.lastFiles = { files, roots: rootKey };
      this.dirty = false;
      return this.snapshot.nodes;
    }
    const result: WorkspaceNode[] = [];
    for (let offset = 0; offset < candidates.length; offset += 24) {
      const batch = await Promise.all(
        candidates.slice(offset, offset + 24).map(async (file) => {
          const stub = this.isStub(file, roots),
            cached = this.cache.get(file.path);
          if (cached?.mtime === file.mtime && (stub || !cached.node?.stub))
            return cached.node;
          const node = this.build(
            file,
            roots,
            stub ? undefined : await this.storage.read(file.path),
          );
          this.cache.set(file.path, { mtime: file.mtime, node });
          return node;
        }),
      );
      result.push(
        ...batch.filter((node): node is WorkspaceNode => node !== null),
      );
    }
    this.snapshot = { signature, nodes: result };
    this.lastFiles = { files, roots: rootKey };
    this.dirty = false;
    this.documentNodes.clear();
    return result;
  }
  async nodesFor(document: WorkspaceDocument): Promise<WorkspaceNode[]> {
    const nodes = await this.graph();
    const key = JSON.stringify([
      document.id,
      document.notePath,
      document.highlightsFolder,
      document.workspacePath,
    ]);
    const cached = this.documentNodes.get(key);
    if (cached?.graph === nodes) return cached.nodes;
    const reached = new Set<string>([
      manifestPath(document),
      ...(document.notePath ? [document.notePath] : []),
    ]);
    const selected = new Map<string, WorkspaceNode>();
    for (const node of nodes)
      if (
        node.documentId === document.id ||
        (!!document.notePath && node.book === document.notePath) ||
        (node.kind === "highlight" &&
          node.path.startsWith(document.highlightsFolder + "/")) ||
        (!!node.target && reached.has(node.target))
      ) {
        selected.set(node.path, node);
        reached.add(node.path);
      }
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes)
        if (
          !selected.has(node.path) &&
          node.sources.some((path) => reached.has(path.split("#")[0]))
        ) {
          selected.set(node.path, node);
          reached.add(node.path);
          changed = true;
        }
    }
    const picked = [...selected.values()],
      full: WorkspaceNode[] = [];
    for (let offset = 0; offset < picked.length; offset += 24)
      full.push(
        ...(await Promise.all(
          picked.slice(offset, offset + 24).map((node) => this.hydrate(node)),
        )),
      );
    const result = full.sort(
      (a, b) =>
        (a.order ?? Infinity) - (b.order ?? Infinity) ||
        a.path.localeCompare(b.path),
    );
    this.documentNodes.set(key, { graph: nodes, nodes: result });
    return result;
  }
  sourceHighlights(node: WorkspaceNode, nodes: WorkspaceNode[]): string[] {
    let index = this.origins.get(nodes);
    if (!index) {
      index = {
        byPath: new Map(nodes.map((n) => [n.path, n])),
        memo: new Map(),
      };
      this.origins.set(nodes, index);
    }
    const memo = index.memo.get(node.path);
    if (memo) return memo;
    const byPath = index.byPath,
      seen = new Set<string>(),
      result = new Set<string>();
    const visit = (reference: string) => {
      const path = reference.split("#")[0];
      if (seen.has(path)) return;
      seen.add(path);
      const n = byPath.get(path);
      if (n?.kind === "highlight") result.add(path);
      else for (const source of n?.sources || []) visit(source);
    };
    visit(node.path);
    const paths = [...result];
    index.memo.set(node.path, paths);
    return paths;
  }
  private serialized<T>(path: string, task: () => Promise<T>): Promise<T> {
    const result = (this.writes.get(path) || Promise.resolve())
      .catch(() => undefined)
      .then(task);
    this.writes.set(path, result);
    return result;
  }
  async flush(): Promise<void> {
    await Promise.all(
      [...this.writes.values()].map((p) => p.catch(() => undefined)),
    );
  }
  async create(
    document: WorkspaceDocument,
    kind: Exclude<WorkspaceNodeKind, "highlight">,
    body: string,
    sources: string[],
    target?: string,
  ): Promise<WorkspaceNode> {
    await this.saveSource(document, {});
    const id = crypto.randomUUID();
    const path = this.currentPath(
      pathJoin(
        document.workspacePath,
        NOTE_FOLDERS[kind],
        `${fileStem(body)} — ${id.slice(0, 8)}.md`,
      ),
    );
    const links = [...new Set(sources)].map((p) => wiki(this.currentPath(p)));
    const fm: Record<string, unknown> = {
      type: kind === "thought" ? "inbox" : kind,
      rwt_id: id,
      rwt_kind: kind,
      rwt_document: document.id,
      book: document.notePath
        ? wiki(this.currentPath(document.notePath))
        : undefined,
      source: links[0],
      rwt_sources: links,
      rwt_target: target ? wiki(this.currentPath(target)) : undefined,
      created: new Date().toISOString(),
    };
    await this.storage.create(path, serializeMarkdown(fm, body));
    return {
      id,
      kind,
      path,
      documentId: document.id,
      book: document.notePath,
      body,
      quote: "",
      title: fileStem(body),
      sources: [...new Set(sources)],
      target,
      raw: await this.storage.read(path),
      mtime: Date.now(),
    };
  }
  /**
   * A new highlight written by the reader. `before`/`after` are the orders of the
   * neighbours in the book; the new note takes a position strictly between them.
   */
  async createHighlight(
    document: WorkspaceDocument,
    input: {
      quote: string;
      comment: string;
      before?: number;
      after?: number;
    },
  ): Promise<WorkspaceNode> {
    const { before, after } = input;
    const order =
      before !== undefined && after !== undefined && after > before
        ? (before + after) / 2
        : before !== undefined
          ? Math.floor(before) + 1
          : after !== undefined
            ? after / 2
            : 1;
    const id = crypto.randomUUID(),
      base = fileStem(document.notePath ? basename(document.notePath) : document.title);
    const path = this.currentPath(
      pathJoin(
        document.highlightsFolder,
        `${base} — ${String(Math.floor(order)).padStart(3, "0")}+${id.slice(0, 8)}.md`,
      ),
    );
    const quote = blockquote(input.quote.trim()),
      comment = input.comment.trim();
    const body = quote + (comment ? "\n\n" + comment : "") + "\n";
    const raw = serializeMarkdown(
      {
        type: "highlight",
        rwt_kind: "highlight",
        rwt_id: id,
        rwt_document: document.id,
        book: document.notePath
          ? wiki(this.currentPath(document.notePath))
          : undefined,
        index: Math.floor(order),
        rwt_order: order,
        date: new Date().toISOString().slice(0, 19),
        title: (comment || input.quote).replace(/\s+/g, " ").trim().slice(0, 100),
      },
      body,
    );
    await this.storage.create(path, raw);
    this.forget(path);
    const node = this.build(
      { path, basename: basename(path), mtime: Date.now() },
      this.roots(),
      raw,
    );
    if (!node) throw new Error("The highlight could not be created.");
    return node;
  }
  /** Undo a highlight that was just written from a selection, including its binding to the book. */
  async discardHighlight(
    document: WorkspaceDocument,
    node: WorkspaceNode,
  ): Promise<void> {
    const path = this.currentPath(node.path);
    await this.serialized(path, async () => {
      if (this.storage.exists(path)) await this.storage.remove(path);
      this.forget(path);
    });
    const source = await this.source(document);
    if (source.anchors.some((anchor) => anchor.nodePath === node.path))
      await this.saveSource(document, {
        anchors: source.anchors.filter((anchor) => anchor.nodePath !== node.path),
      });
  }
  /** Remove a note the reader created but never used (e.g. a dialog whose question was not sent). */
  async discard(node: WorkspaceNode): Promise<void> {
    const path = this.currentPath(node.path);
    await this.serialized(path, async () => {
      if (this.storage.exists(path)) await this.storage.remove(path);
      this.forget(path);
    });
  }
  saveBody(node: WorkspaceNode, body: string): Promise<void> {
    const path = this.currentPath(node.path);
    return this.serialized(path, async () => {
      let conflict = false;
      if (!this.storage.exists(path)) conflict = true;
      else
        await this.storage.process(path, (current) => {
          if (parseMarkdown(current).body === body) return current;
          const version = this.versions.get(node.path);
          if (
            parseMarkdown(current).body !== parseMarkdown(node.raw).body &&
            !(
              version?.base === node.raw &&
              parseMarkdown(version.written).body ===
                parseMarkdown(current).body
            )
          ) {
            conflict = true;
            return current;
          }
          const header = parseMarkdown(current).header;
          const next = (header ? header + "\n" : "") + body.replace(/^\n/, "");
          this.versions.set(node.path, { base: node.raw, written: next });
          return next;
        });
      this.forget(path);
      if (conflict) await this.preserveConflict(path, node, {}, body);
    });
  }
  /**
   * The note changed under the editor: the reader's text is written to a sibling copy
   * (linked back to the original) and the caller receives it to continue editing there.
   */
  private async preserveConflict(
    path: string,
    node: WorkspaceNode,
    metadata: Record<string, unknown>,
    body: string,
  ): Promise<never> {
    const copy = conflictCopyPath(path);
    const copyRaw = serializeMarkdown(
      {
        ...parseMarkdown(node.raw).metadata,
        rwt_id: crypto.randomUUID(),
        rwt_conflict: wiki(path),
        ...metadata,
      },
      body,
    );
    await this.storage.create(copy, copyRaw);
    throw new WorkspaceConflictError(copy, copyRaw);
  }
  /**
   * A thought is created empty as "Note — id"; name it after its first line once.
   * Called when editing ends, because a renamed file gets a new list key and would
   * remount (and unfocus) the editor mid-typing.
   */
  nameThought(node: WorkspaceNode, body: string): Promise<string | undefined> {
    const path = this.currentPath(node.path);
    return this.serialized(path, () => this.nameFromBody(node, path, body));
  }
  private async nameFromBody(
    node: WorkspaceNode,
    path: string,
    body: string,
  ): Promise<string | undefined> {
    const match = path.match(/^(.*\/Thoughts\/)Note( — [^/]+\.md)$/);
    const stem = fileStem(body);
    if (!match || node.kind !== "thought" || stem === "Note") return;
    const next = match[1] + stem + match[2];
    if (this.storage.exists(next)) return;
    try {
      await this.storage.rename(path, next);
    } catch {
      return;
    }
    this.trackRename(path, next);
    const version = this.versions.get(node.path);
    if (version) this.versions.set(next, version);
    return next;
  }
  updateSources(node: WorkspaceNode, sources: string[]): Promise<void> {
    const path = this.currentPath(node.path);
    return this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const parsed = parseMarkdown(current);
        if (parsed.malformed)
          throw new Error(
            "Fix the note properties in Obsidian before editing its sources.",
          );
        const links = [...new Set(sources)].map((p) =>
          wiki(this.currentPath(p)),
        );
        return serializeMarkdown(
          { ...parsed.metadata, rwt_sources: links, source: links[0] },
          parsed.body,
        );
      });
      this.forget(node.path);
    });
  }
  /** Flags a thought or dialog as important; clearing the flag removes the property. */
  setImportant(node: WorkspaceNode, important: boolean): Promise<void> {
    const path = this.currentPath(node.path);
    return this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const parsed = parseMarkdown(current);
        if (parsed.malformed)
          throw new Error(
            "Fix the note properties in Obsidian before marking it important.",
          );
        const metadata = { ...parsed.metadata };
        if (important) metadata.rwt_important = true;
        else delete metadata.rwt_important;
        return serializeMarkdown(metadata, parsed.body);
      });
      this.forget(node.path);
    });
  }
  async saveDraft(node: WorkspaceNode, text: string): Promise<void> {
    const path = this.currentPath(node.path);
    await this.serialized(path, async () => {
      const key = node.path + "#draft",
        base = String(parseMarkdown(node.raw).metadata.rwt_draft || "");
      let conflict = false;
      if (!this.storage.exists(path)) conflict = true;
      else
        await this.storage.process(path, (current) => {
          const p = parseMarkdown(current);
          if (p.malformed) throw new Error("Invalid dialog properties.");
          const value = String(p.metadata.rwt_draft || ""),
            version = this.versions.get(key);
          if (
            value !== text &&
            value !== base &&
            !(version?.base === base && version.written === value)
          ) {
            conflict = true;
            return current;
          }
          this.versions.set(key, { base, written: text });
          return serializeMarkdown({ ...p.metadata, rwt_draft: text }, p.body);
        });
      this.forget(node.path);
      if (conflict)
        await this.preserveConflict(path, node, { rwt_draft: text }, node.body);
    });
  }
  chatPath(document: WorkspaceDocument): string {
    return this.currentPath(chatPath(document));
  }
  private manifestPath(document: WorkspaceDocument): string {
    return this.currentPath(manifestPath(document));
  }
  /**
   * The book's single chat: one Markdown file holding the whole feed (questions asked in
   * any note dialog are mirrored here) and the id of the Codex thread that remembers it.
   * It looks like a dialog to the editor and message code, but is not part of the note lists.
   */
  async chat(document: WorkspaceDocument): Promise<WorkspaceNode> {
    const path = this.chatPath(document);
    await this.serialized(path, async () => {
      if (this.storage.exists(path)) return;
      await this.storage.create(
        path,
        serializeMarkdown(
          {
            rwt_kind: "chat",
            rwt_id: crypto.randomUUID(),
            rwt_document: document.id,
            book: document.notePath
              ? wiki(this.currentPath(document.notePath))
              : undefined,
            created: new Date().toISOString(),
          },
          "",
        ),
      );
    });
    const raw = await this.storage.read(path),
      parsed = parseMarkdown(raw);
    return {
      id:
        typeof parsed.metadata.rwt_id === "string"
          ? parsed.metadata.rwt_id
          : "chat:" + path,
      kind: "dialog",
      path,
      documentId: document.id,
      body: parsed.body,
      quote: "",
      title: "Chat",
      sources: [],
      raw,
      mtime: this.storage.mtime(path) ?? Date.now(),
    };
  }
  async chatThread(document: WorkspaceDocument): Promise<string | undefined> {
    const path = this.chatPath(document);
    if (!this.storage.exists(path)) return undefined;
    const id = parseMarkdown(await this.storage.read(path)).metadata.rwt_thread;
    return typeof id === "string" && id ? id : undefined;
  }
  async setChatThread(
    document: WorkspaceDocument,
    threadId: string | undefined,
  ): Promise<void> {
    await this.chat(document);
    const path = this.chatPath(document);
    await this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const p = parseMarkdown(current);
        if (p.malformed) throw new Error("Invalid chat properties.");
        if ((p.metadata.rwt_thread || undefined) === threadId) return current;
        return serializeMarkdown({ ...p.metadata, rwt_thread: threadId }, p.body);
      });
      this.forget(path);
    });
  }
  async messages(node: WorkspaceNode): Promise<DialogMessage[]> {
    return parseMessages(
      parseMarkdown(await this.storage.read(this.currentPath(node.path))).body,
    );
  }
  /** A property of a dialog's own file (its Codex thread, its context scope). */
  async dialogProperty(node: WorkspaceNode, key: string): Promise<string | undefined> {
    const path = this.currentPath(node.path);
    if (!this.storage.exists(path)) return undefined;
    const value = parseMarkdown(await this.storage.read(path)).metadata[key];
    return typeof value === "string" && value ? value : undefined;
  }
  async setDialogProperty(node: WorkspaceNode, key: string, value: string | undefined): Promise<void> {
    const path = this.currentPath(node.path);
    await this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const p = parseMarkdown(current);
        if (p.malformed) throw new Error("Invalid dialog properties.");
        if ((p.metadata[key] || undefined) === value) return current;
        return serializeMarkdown({ ...p.metadata, [key]: value ?? "" }, p.body);
      });
      this.forget(path);
    });
  }
  /** Take the unsent question out of the dialog, so it is sent exactly once. */
  async takeDraft(node: WorkspaceNode): Promise<string> {
    const path = this.currentPath(node.path);
    let draft = "";
    await this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const p = parseMarkdown(current);
        if (p.malformed) throw new Error("Invalid dialog properties.");
        draft = String(p.metadata.rwt_draft || "");
        if (!draft) return current;
        return serializeMarkdown({ ...p.metadata, rwt_draft: "" }, p.body);
      });
      this.versions.delete(node.path + "#draft");
      this.forget(path);
    });
    return draft;
  }
  async appendMessage(
    node: WorkspaceNode,
    message: DialogMessage,
  ): Promise<void> {
    const path = this.currentPath(node.path);
    await this.serialized(path, async () => {
      await this.storage.process(path, (current) => {
        const p = parseMarkdown(current);
        if (p.malformed) throw new Error("Invalid dialog properties.");
        const sources = [
          ...new Set([
            ...stringList(p.metadata.rwt_sources),
            ...message.sources.map((s) => (s.startsWith("[[") ? s : wiki(s))),
          ]),
        ];
        return serializeMarkdown(
          { ...p.metadata, rwt_sources: sources, source: sources[0] },
          p.body.trimEnd() + "\n\n" + serializeMessages([message]) + "\n",
        );
      });
      this.forget(path);
    });
  }
  async source(document: WorkspaceDocument): Promise<DocumentSource> {
    const path = this.manifestPath(document);
    if (document.notePath) this.watched.add(document.notePath);
    if (!this.storage.exists(path))
      return {
        documentId: document.id,
        readerId: document.readerId,
        anchors: [],
      };
    const fm = parseMarkdown(await this.storage.read(path)).metadata;
    const bound = (key: string) => {
      if (typeof fm[key] !== "string") return undefined;
      const resolved = this.resolve(fm[key] as string, path);
      this.watched.add(resolved);
      return resolved;
    };
    return {
      documentId: document.id,
      readerId: document.readerId,
      originalPath: bound("rwt_original"),
      contentPath: bound("rwt_content"),
      contentHash:
        typeof fm.rwt_content_hash === "string"
          ? fm.rwt_content_hash
          : undefined,
      originalHash:
        typeof fm.rwt_original_hash === "string"
          ? fm.rwt_original_hash
          : undefined,
      fetchedAt:
        typeof fm.rwt_fetched === "string" ? fm.rwt_fetched : undefined,
      imageHashes:
        fm.rwt_image_hashes && typeof fm.rwt_image_hashes === "object"
          ? (fm.rwt_image_hashes as Record<string, string>)
          : undefined,
      tableFormat:
        typeof fm.rwt_table_format === "number"
          ? fm.rwt_table_format
          : undefined,
      anchors: Array.isArray(fm.rwt_anchors)
        ? (fm.rwt_anchors as DocumentSource["anchors"])
        : [],
    };
  }
  async saveSource(
    document: WorkspaceDocument,
    update: Partial<DocumentSource>,
  ): Promise<void> {
    const path = this.manifestPath(document);
    await this.serialized(path, async () => {
      const apply = (current: string) => {
        const p = parseMarkdown(current);
        if (p.malformed) throw new Error("Invalid source properties.");
        const fm = {
          ...p.metadata,
          rwt_kind: "source",
          rwt_document: document.id,
          rwt_reader_id: document.readerId,
          book: document.notePath
            ? wiki(this.currentPath(document.notePath))
            : undefined,
          rwt_title: document.title,
          rwt_author: document.author,
        };
        const fields: Record<string, unknown> = {};
        if (update.originalPath !== undefined)
          fields.rwt_original = wiki(this.currentPath(update.originalPath));
        if (update.contentPath !== undefined)
          fields.rwt_content = wiki(this.currentPath(update.contentPath));
        if (update.contentHash !== undefined)
          fields.rwt_content_hash = update.contentHash;
        if (update.originalHash !== undefined)
          fields.rwt_original_hash = update.originalHash;
        if (update.fetchedAt !== undefined)
          fields.rwt_fetched = update.fetchedAt;
        if (update.imageHashes !== undefined)
          fields.rwt_image_hashes = update.imageHashes;
        if (update.tableFormat !== undefined)
          fields.rwt_table_format = update.tableFormat;
        if (update.anchors !== undefined) fields.rwt_anchors = update.anchors;
        const metadata = { ...fm, ...fields };
        return JSON.stringify(metadata) === JSON.stringify(p.metadata)
          ? current
          : serializeMarkdown(metadata, p.body);
      };
      if (this.storage.exists(path)) {
        const before = await this.storage.read(path);
        if (apply(before) !== before) await this.storage.process(path, apply);
      } else await this.storage.create(path, apply(""));
    });
  }
  /** Merge only verified media results, without overwriting a newer/manual binding. */
  async saveImageMatches(
    document: WorkspaceDocument,
    revision: string,
    hashes: Record<string, string>,
    anchor?: SourceAnchor,
  ): Promise<void> {
    const path = this.manifestPath(document);
    await this.serialized(path, async () => {
      if (!this.storage.exists(path)) return;
      await this.storage.process(path, (raw) => {
        const parsed = parseMarkdown(raw),
          fm = parsed.metadata;
        if (parsed.malformed || fm.rwt_content_hash !== revision) return raw;
        const anchors = Array.isArray(fm.rwt_anchors)
          ? (fm.rwt_anchors as SourceAnchor[])
          : [];
        const updated = anchors.map((current) =>
          anchor &&
          current.id === anchor.id &&
          current.quote === anchor.quote &&
          current.revision === revision &&
          current.status === "missing" &&
          !current.manual
            ? anchor
            : current,
        );
        const metadata = {
          ...fm,
          rwt_image_hashes: {
            ...(fm.rwt_image_hashes as Record<string, string> | undefined),
            ...hashes,
          },
          rwt_anchors: updated,
        };
        return JSON.stringify(metadata) === JSON.stringify(fm)
          ? raw
          : serializeMarkdown(metadata, parsed.body);
      });
    });
  }
  async repairRename(oldPath: string, newPath: string): Promise<void> {
    await this.repairRenames([[oldPath, newPath]]);
  }
  /** Synchronous, so editors saving right after a rename already find the new path. */
  trackRename(oldPath: string, newPath: string): void {
    const now = Date.now();
    for (const [key, entry] of this.renames)
      if (entry.to === oldPath) this.renames.set(key, { to: newPath, at: now });
    this.renames.delete(newPath);
    this.renames.set(oldPath, { to: newPath, at: now });
    this.forget(oldPath);
    this.forget(newPath);
  }
  /** One pass over managed notes for any number of renames (a folder rename fires one per file). */
  async repairRenames(pairs: Array<[string, string]>): Promise<void> {
    for (const [oldPath, newPath] of pairs) this.trackRename(oldPath, newPath);
    const stems = pairs.map(([oldPath, newPath]) => ({
      old: linkPath(oldPath),
      from: oldPath.replace(/\.md$/, ""),
      to: newPath.replace(/\.md$/, ""),
    }));
    const replace = (value: unknown): unknown => {
      if (typeof value === "string") {
        const path = linkPath(value);
        for (const stem of stems)
          if (path === stem.old || path.startsWith(stem.old + "/"))
            return value.replace(stem.from, stem.to);
        return value;
      }
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, v]) => [key, replace(v)]),
        );
      return value;
    };
    for (const file of this.storage
      .files()
      .filter(
        (f) =>
          f.path.endsWith(".md") &&
          (isWorkspacePath(f.path) || !!f.metadata?.rwt_kind),
      )) {
      await this.serialized(file.path, async () => {
        // Only touch notes that actually mention a renamed path.
        const raw = await this.storage.read(file.path).catch(() => "");
        if (!stems.some((stem) => raw.includes(stem.from))) return;
        await this.storage.process(file.path, (current) => {
          const p = parseMarkdown(current);
          if (p.malformed) return current;
          const updated = replace(p.metadata) as Record<string, unknown>;
          return JSON.stringify(updated) === JSON.stringify(p.metadata)
            ? current
            : serializeMarkdown(updated, p.body);
        });
      });
    }
  }
}
