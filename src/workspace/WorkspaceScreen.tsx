import * as React from "react";
import type { ReadwiseTrackerViewHost } from "../plugin/contracts";
import type { BookWorkspaceState } from "./BookWorkspaceView";
import type { ContentResolution, SourceAnchor, WorkspaceNode } from "./types";
import { WorkspaceFocus, nearestSource, relatedNode, textBlocks, type WorkspacePanel } from "./focus";
import { Icon, IconButton, SplitDivider, WorkspacePicker, type Choice } from "./controls";
import { VirtualStream, type StreamAnchor } from "./VirtualStream";
import { mirrorsProgress, readingProgress } from "./progress";
import { standaloneTableText } from "./tables";
import { ChatFeed } from "./DialogView";
import { HighlightCard, NoteCard, RailIcon, SourcesControl, type HighlightActions } from "./cards";
import { SelectionBar, type SourceSelection } from "./SelectionBar";
import { TranslationTools } from "./TranslationTools";
import { locateQuote } from "./anchors";
import { parseHighlightNote } from "../services/readwiseHighlightParsing";
import { prepareHighlightTableIndex } from "./content";
import { isWorkspacePath } from "./layout";
import type { HighlightTableIndex } from "./highlightTables";
import { RIGHT_KINDS, reducePaneLayout, type PaneLayout, type RightKind } from "./paneLayout";
import { useWorkspaceDocument } from "./hooks/useWorkspaceDocument";
import { useSourceText } from "./hooks/useSourceText";
import { useTextSelection, type TextSelection } from "./hooks/useTextSelection";
import { useTranslation } from "./hooks/useTranslation";
import {
  coveringBlocks,
  notePassage,
  translatedQuoteBlock,
  type NotePassage,
} from "./notePassage";
import { TextBlockView } from "./TextBlockView";
import { BookMap } from "./BookMap";
import {
  readTranslationViewPreferences,
  rememberTranslationView,
  type TranslationView,
} from "./translationView";
import { t } from "../i18n";
import { isArchivedBook } from "../utils/bookArchive";

interface ScreenProps {
  plugin: ReadwiseTrackerViewHost;
  initial: BookWorkspaceState;
  persist: (patch: Partial<BookWorkspaceState>) => void;
  navigate: (id: string, back?: boolean) => Promise<void>;
}
const keyOf = (node: WorkspaceNode) => node.path;
const blockKeyOf = (block: { key: string }) => block.key;
const panelIcons: Record<RightKind, string> = {
  thought: "pencil-line",
  dialog: "messages-square",
  relation: "git-fork",
};
const panelName = (kind: RightKind) => t(`workspace.panel.${kind}`);
const railLabel = (kind: RightKind) => t(`workspace.rail.${kind}`);
const FILE_ACCEPT = ".md,.txt,.html,.htm,.epub,.pdf";
/** Book map ticks sit at a fixed gap in the middle of the rail; this many fit a usual window. */

/** The anchor at the nearest matched highlight to a position in the text (binary search over sorted starts). */
function nearestAnchor<T extends { start: number }>(anchors: T[], position: number): T | undefined {
  let low = 0,
    high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].start < position) low = middle + 1;
    else high = middle;
  }
  const before = anchors[low - 1],
    after = anchors[low];
  if (!before) return after;
  if (!after) return before;
  return position - before.start <= after.start - position ? before : after;
}

/** An anchor the reader placed by hand; it survives re-matching while the text is unchanged. */
const manualAnchor = (
  text: ContentResolution,
  nodePath: string,
  quote: string,
  start: number,
  end: number,
  id = crypto.randomUUID(),
): SourceAnchor => ({
  id,
  nodePath,
  quote,
  revision: text.revision,
  status: "matched",
  start,
  end,
  candidates: [],
  manual: true,
  selectedText: text.markdown.slice(start, end),
});

export function WorkspaceScreen({ plugin, initial, persist, navigate }: ScreenProps): React.ReactElement {
  const service = plugin.workspaceService;
  const invoke = (task: Promise<unknown>) => {
    void task.catch((error) => service.report(error));
  };

  // ---- Panes -------------------------------------------------------------
  const [layout, dispatch] = React.useReducer(reducePaneLayout, undefined, (): PaneLayout => ({
    right: initial.right,
    sourceOpen: initial.sourceOpen || false,
    notesCollapsed: initial.notesCollapsed || false,
    reading: false,
  }));
  const { right, sourceOpen, notesCollapsed: collapsed, reading } = layout;
  const [split, setSplit] = React.useState(initial.split || 0.5);
  React.useEffect(() => {
    if (!reading) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "exitReading" });
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [reading]);
  const coordinator = React.useRef(new WorkspaceFocus()).current;
  const positions = React.useRef(initial.positions || {});
  const anchors = React.useRef(initial.anchors || {});
  const stage = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // ---- Document and notes ------------------------------------------------
  const { document, nodes, allNodes, error, sourceStamp } = useWorkspaceDocument(
    service,
    initial.documentId,
    (current, visible) => {
      if (current.category === "markdown" && !visible.some((node) => node.kind === "highlight"))
        dispatch({ type: "readerDefault" });
    },
  );
  const [focused, setFocused] = React.useState(initial.focused);
  const [furthest, setFurthest] = React.useState(initial.furthest);
  const [cursor, setCursor] = React.useState<Partial<Record<RightKind, string>>>({});
  const [editing, setEditing] = React.useState<string>();
  const [editingComment, setEditingComment] = React.useState<string>();
  /** A thought just started from a highlight; its field takes focus when it appears. */
  const [focusNote, setFocusNote] = React.useState<string>();
  /** The note just created from a selection; only it can be cancelled. */
  const [fresh, setFresh] = React.useState<WorkspaceNode>();
  const [selecting, setSelecting] = React.useState<SourceSelection>();
  const [binding, setBinding] = React.useState<string>();
  const [creating, setCreating] = React.useState(false);
  /** The book's single chat feed replaces the per-note dialog list while open. */
  const [chatOpen, setChatOpen] = React.useState(false);
  /** Show only the thoughts and dialogs marked important. */
  const [onlyImportant, setOnlyImportant] = React.useState(false);
  const [chat, setChat] = React.useState<WorkspaceNode>();

  const highlightNodes = React.useMemo(() => nodes.filter((node) => node.kind === "highlight"), [nodes]);
  const orderIndex = React.useMemo(
    () => new Map(highlightNodes.map((node, index) => [node.path, index])),
    [highlightNodes],
  );
  const isHighlight = (path: string) => orderIndex.has(path);
  const nodeByPath = React.useMemo(() => new Map(allNodes.map((node) => [node.path, node])), [allNodes]);
  const sourcePaths = React.useCallback(
    (node: WorkspaceNode) => service.repository.sourceHighlights(node, allNodes),
    [service, allNodes],
  );
  const activeHighlight = highlightNodes.find((node) => node.path === focused) || highlightNodes[0];
  const focusPath = activeHighlight?.path;
  /** Right-pane notes in the order of the highlights they are about. */
  const streams = React.useMemo(() => {
    const position = (node: WorkspaceNode) =>
      Math.min(
        ...sourcePaths(node)
          .map((path) => orderIndex.get(path) ?? -1)
          .filter((index) => index >= 0),
      );
    const positions = new Map(nodes.map((node) => [node.path, position(node)]));
    const list = (kind: RightKind) =>
      nodes
        .filter((n) => n.kind === kind && (!onlyImportant || n.important))
        .sort(
          (a, b) =>
            (positions.get(a.path) ?? Infinity) - (positions.get(b.path) ?? Infinity) ||
            a.path.localeCompare(b.path),
        );
    return { thought: list("thought"), dialog: list("dialog"), relation: list("relation") };
  }, [nodes, sourcePaths, orderIndex, onlyImportant]);
  /** Only forward: going back never moves the mark, so the reader can always return to it. */
  React.useEffect(() => {
    const here = focusPath ? orderIndex.get(focusPath) : undefined;
    if (here === undefined) return;
    const mark = furthest ? orderIndex.get(furthest) : undefined;
    if (mark === undefined || here > mark) setFurthest(focusPath);
  }, [focusPath, orderIndex, furthest]);
  React.useEffect(() => {
    persist({ right, sourceOpen, notesCollapsed: collapsed, split, focused: focusPath, furthest });
  }, [right, sourceOpen, collapsed, split, focusPath, furthest]);
  // The right panes follow the highlight in focus to the nearest note about it.
  React.useEffect(() => {
    if (!focusPath) return;
    setCursor((current) =>
      Object.fromEntries(
        RIGHT_KINDS.map((kind) => [kind, relatedNode(current[kind], focusPath, streams[kind], sourcePaths)]),
      ),
    );
  }, [focusPath, streams, sourcePaths]);
  React.useEffect(() => {
    if (!document || right !== "dialog" || !chatOpen) return;
    let alive = true;
    const load = () =>
      void service.repository
        .chat(document)
        .then((node) => alive && setChat(node))
        .catch((error: unknown) => service.report(error));
    load();
    const unsubscribe = service.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [document, right, chatOpen, service]);

  // ---- The book's text ---------------------------------------------------
  const sourceRef = React.useRef<ContentResolution>();
  const anchor = sourceRef.current?.anchors.find((item) => item.nodePath === focusPath);
  const text = useSourceText({
    service,
    document,
    remote: !!plugin.settings.readwiseToken,
    open: sourceOpen,
    stamp: sourceStamp,
    focusPath,
    anchor,
    coordinator,
  });
  const { source } = text;
  sourceRef.current = source;
  const blocks = React.useMemo(() => textBlocks(source?.markdown || ""), [source?.markdown]);
  /** Blocks the focused note's passage covers; its words are marked in each of them. */
  const markedBlocks = React.useMemo(
    () =>
      new Set(
        anchor?.status === "matched" && anchor.start !== undefined && anchor.end !== undefined
          ? coveringBlocks(blocks, anchor.start, anchor.end).map(blockKeyOf)
          : [],
      ),
    [blocks, anchor?.status, anchor?.start, anchor?.end],
  );
  const activeBlock = blocks.find(
    (block) => anchor?.start !== undefined && block.start <= anchor.start && block.end > anchor.start,
  )?.key;
  const matchedAnchors = React.useMemo(
    () =>
      source?.anchors
        .filter(
          (item): item is SourceAnchor & { start: number } =>
            item.status === "matched" && item.start !== undefined && orderIndex.has(item.nodePath),
        )
        .sort((a, b) => a.start - b.start) || [],
    [source?.anchors, orderIndex],
  );
  const [highlightTables, setHighlightTables] = React.useState<HighlightTableIndex>();
  React.useEffect(() => {
    let alive = true;
    if (source?.status === "ready") {
      void prepareHighlightTableIndex(source.markdown)
        .then((index) => alive && setHighlightTables(index))
        .catch((error: unknown) => alive && service.report(error));
    } else setHighlightTables(undefined);
    return () => {
      alive = false;
    };
  }, [source?.revision]);
  const viewPreferences = React.useMemo(
    () => readTranslationViewPreferences(plugin.settings.workspaceTranslationViews),
    [plugin.settings.workspaceTranslationViews],
  );
  const rememberView = (view: TranslationView) => {
    if (!document) return;
    const next = rememberTranslationView(viewPreferences, document.id, view);
    if (next === viewPreferences) return;
    plugin.settings.workspaceTranslationViews = next;
    invoke(plugin.saveSettings());
  };
  const translation = useTranslation({
    app: plugin.app,
    service,
    document,
    source,
    blocks,
    invoke,
    preferences: viewPreferences,
    remember: rememberView,
  });
  // Each card shows the passage as the text on screen has it; computed once per card per view.
  const anchorByPath = React.useMemo(
    () => new Map((source?.anchors || []).map((item) => [item.nodePath, item])),
    [source?.anchors],
  );
  const passages = React.useMemo(
    () => new Map<string, NotePassage | undefined>(),
    [source?.revision, anchorByPath, blocks, translation.blocks, translation.shown],
  );
  const passageOf = (node: WorkspaceNode): NotePassage | undefined => {
    if (source?.status !== "ready") return undefined;
    if (!passages.has(node.path))
      passages.set(
        node.path,
        notePassage({
          quote: node.quote,
          anchor: anchorByPath.get(node.path),
          blocks,
          markdown: source.markdown,
          translated: translation.blocks,
          shown: translation.shown,
        }),
      );
    return passages.get(node.path);
  };
  const sourcePane = React.useRef<HTMLElement>(null);
  const selection = useTextSelection(sourcePane, !selecting && !binding);

  // ---- Actions -----------------------------------------------------------
  const focusHighlight = (path: string) => {
    coordinator.lead(null);
    setFocused(path);
  };
  const follow = (panel: WorkspacePanel, node: WorkspaceNode) => {
    if (selecting || !coordinator.accepts(panel)) return;
    if (node.kind !== "highlight") setCursor((current) => ({ ...current, [node.kind]: node.path }));
    const next = node.kind === "highlight" ? node.path : nearestSource(focusPath, sourcePaths(node), orderIndex);
    if (next) setFocused(next);
  };
  const position = (panel: string, offset: number, anchor?: StreamAnchor) => {
    if (
      panel === "source" &&
      anchor &&
      document?.readerId &&
      source?.status === "ready" &&
      plugin.settings.workspaceMirrorProgress &&
      mirrorsProgress(document)
    )
      service.progress.note(document.readerId, readingProgress(Number(anchor.key), source.markdown.length));
    positions.current[panel] = offset;
    if (anchor) anchors.current[panel] = anchor;
    persist({ positions: positions.current, anchors: anchors.current });
  };
  /** Newest load first: the book added to the library last is the first in the list. */
  const loadedAt = (book: { created_at?: string; updated_at?: string }) =>
    Date.parse(book.created_at || book.updated_at || "") || 0;
  const bookChoices = (): Choice[] =>
    Object.values(plugin.dataManager.getData().books)
      .sort((a, b) => loadedAt(b) - loadedAt(a) || a.title.localeCompare(b.title))
      .map((book) => ({
        id: book.id,
        title: book.title,
        detail: book.author,
        archived: isArchivedBook(book),
      }));
  const showPicker = () =>
    new WorkspacePicker(plugin.app, bookChoices(), (choice) => invoke(navigate(choice.id)), t("workspace.picker.book")).open();
  const openVault = (path: string) =>
    invoke(plugin.app.workspace.openLinkText(path, document?.notePath || "", false));
  /** Save what the field holds first, so it cannot come back as a conflict copy. */
  const discardNode = (node: WorkspaceNode) =>
    invoke(
      (async () => {
        if (node.kind === "dialog") service.dialogs.cancel(node.path);
        await service.flush();
        await service.repository.discard(node);
        service.changed();
      })(),
    );
  const toggleImportant = (node: WorkspaceNode, important: boolean) =>
    invoke(
      (async () => {
        await service.flush();
        await service.repository.setImportant(node, important);
        service.changed();
      })(),
    );
  const createNode = async (
    kind: RightKind,
    body = "",
    sources = focusPath ? [focusPath] : document?.notePath ? [document.notePath] : [],
    target?: string,
    draft?: string,
  ) => {
    if (!document || creating) return;
    setCreating(true);
    try {
      const node = await service.repository.create(document, kind, body, sources, target);
      // A prepared question is stored as the dialog's unsent draft.
      if (draft) await service.repository.saveDraft(node, draft);
      dispatch({ type: "setRight", kind });
      if (kind !== "relation") setFocusNote(node.path);
      setCursor((current) => ({ ...current, [kind]: node.path }));
      service.changed();
      coordinator.lead(null);
    } finally {
      setCreating(false);
    }
  };
  const createThoughtFrom = (content: string, sources: string[]) => invoke(createNode("thought", content, sources));
  const linkText = () => {
    const choices: Choice[] = [
      ...bookChoices().filter((book) => book.id !== document?.id),
      ...service.storage
        .files()
        .filter(
          (file) => file.path.endsWith(".md") && !isWorkspacePath(file.path) && file.path !== document?.notePath,
        )
        .map((file) => ({ id: "vault:" + file.path, title: file.basename, detail: file.path })),
    ];
    new WorkspacePicker(
      plugin.app,
      choices,
      (choice) =>
        invoke(
          (async () => {
            const target = choice.id.startsWith("vault:")
              ? await service.fromPath(choice.id.slice(6))
              : await service.document(choice.id);
            await createNode("relation", "", focusPath ? [focusPath] : [], await service.target(target));
          })(),
        ),
      t("workspace.picker.linkText"),
    ).open();
  };
  const createInPane = (kind: RightKind) => {
    if (kind === "dialog") setChatOpen(false);
    if (kind === "relation") linkText();
    else invoke(createNode(kind));
  };
  const attachVault = () =>
    new WorkspacePicker(
      plugin.app,
      service.storage
        .files()
        .filter((file) => /\.(md|txt|html?|pdf|epub)$/i.test(file.path))
        .map((file) => ({ id: file.path, title: file.basename, detail: file.path })),
      (choice) => invoke(text.attach(choice.id)),
      t("workspace.picker.vaultFile"),
    ).open();
  const attachLocalFile = (file: File) =>
    invoke(
      (async () => {
        const saved = await service.sources.saveAsset(file.name, await file.arrayBuffer());
        await text.attach(saved.path);
      })(),
    );
  const setAnchor = async (start: number, end: number) => {
    if (!document || !source || !focusPath) return;
    const current = await service.repository.source(document);
    const next = [
      ...current.anchors.filter((item) => item.nodePath !== focusPath),
      manualAnchor(source, focusPath, activeHighlight?.quote || "", start, end, anchor?.id),
    ];
    await service.repository.saveSource(document, { anchors: next });
    text.setSource({ ...source, anchors: next });
    setBinding(undefined);
  };
  // A note whose words are the translation's has nothing to match in the original: once the
  // translation is known, it is bound to the paragraph its quote is found in.
  React.useEffect(() => {
    if (!document || source?.status !== "ready" || !focusPath || !translation.blocks) return;
    if (!anchor || anchor.status !== "missing" || anchor.manual || binding) return;
    const block = translatedQuoteBlock(blocks, translation.blocks, activeHighlight?.quote || "");
    if (block) invoke(setAnchor(block.start, block.end));
  }, [document, source?.status, focusPath, anchor?.status, translation.blocks, blocks]);
  /** Counts "to the passage" requests so the text scrolls back even for the note already in focus. */
  const [jump, setJump] = React.useState(0);
  /** Insert a note written from a passage; its position follows the passage in the book. */
  const addFromSelection = (picked: TextSelection) => {
    const block = blocks[picked.block];
    if (!document || !source || !block) return;
    const inBlock = locateQuote(block.text, picked.text, "", source.revision);
    // Passage of the translation: the note is tied to the whole original block.
    const translated = translation.shown && !!translation.blocks?.[block.key];
    const found = translated
      ? { start: block.start, end: block.end }
      : inBlock.status === "matched" && inBlock.start !== undefined && inBlock.end !== undefined
        ? { start: block.start + inBlock.start, end: block.start + inBlock.end }
        : undefined;
    const at = found?.start ?? block.start;
    const orderOf = (path: string) => highlightNodes.find((node) => node.path === path)?.order;
    let before: number | undefined, after: number | undefined;
    for (const item of matchedAnchors) {
      const order = orderOf(item.nodePath);
      if (order === undefined) continue;
      if (item.start <= at) before = order;
      else {
        after = order;
        break;
      }
    }
    window.getSelection()?.removeAllRanges();
    selection.clear();
    invoke(
      (async () => {
        const [quote] = await service.sources.formatHighlightQuotes(document, [picked.text], false);
        const node = await service.repository.createHighlight(document, { quote, comment: "", before, after });
        if (found) {
          const current = await service.repository.source(document);
          await service.repository.saveSource(document, {
            anchors: [...current.anchors, manualAnchor(source, node.path, node.quote, found.start, found.end)],
          });
        }
        // The note appears in the list in its place, with its comment field open.
        setFresh(node);
        setEditingComment(node.path);
        focusHighlight(node.path);
        service.changed();
      })(),
    );
  };
  /** Open a right panel at this highlight's note of that kind, starting one if it has none yet. */
  const openRelated = (kind: "thought" | "dialog", node: WorkspaceNode) => {
    focusHighlight(node.path);
    dispatch({ type: "showRight", kind });
    const existing = streams[kind].find((item) => sourcePaths(item).includes(node.path));
    if (existing) {
      setCursor((current) => ({ ...current, [kind]: existing.path }));
      setFocusNote(existing.path);
      return;
    }
    // The dialog runner already supplies the linked passage as context, so the field starts
    // from the reader's own comment rather than a copy of the quote.
    const { description: draft } = parseHighlightNote(node.body);
    invoke(createNode(kind, "", [node.path], undefined, kind === "dialog" ? draft : undefined));
  };
  /** One click: a new dialog asks the model to find the article this note refers to and save it to Reader. */
  const saveToReadwise = (node: WorkspaceNode) => {
    if (!document || creating) return;
    invoke(
      (async () => {
        setCreating(true);
        try {
          const dialog = await service.repository.create(document, "dialog", "", [node.path]);
          await service.repository.saveDraft(dialog, t("dialog.saveToReadwiseQuestion"));
          dispatch({ type: "setRight", kind: "dialog" });
          setChatOpen(false);
          setCursor((current) => ({ ...current, dialog: dialog.path }));
          service.changed();
          await service.dialogs.send(document, dialog, source?.revision);
        } finally {
          setCreating(false);
        }
      })(),
    );
  };
  const aiAvailable = !service.dialogs.unavailable();
  /** From a chat message back to the note dialog it was asked in. */
  const openOrigin = (path: string) => {
    const dialog = streams.dialog.find((item) => item.path === path);
    if (!dialog) return openVault(path);
    setChatOpen(false);
    setCursor((current) => ({ ...current, dialog: dialog.path }));
    const next = nearestSource(focusPath, sourcePaths(dialog), orderIndex);
    if (next) focusHighlight(next);
  };
  const highlightActions: HighlightActions = {
    showPassage: (node) => {
      focusHighlight(node.path);
      setJump((count) => count + 1);
      dispatch({ type: "showSource" });
    },
    openThought: (node) => openRelated("thought", node),
    openDialog: (node) => openRelated("dialog", node),
    saveToReadwise: aiAvailable ? saveToReadwise : undefined,
    editComment: (node) => setEditingComment(node.path),
    openNote: openVault,
    cancelFresh: (node) => {
      setEditingComment(undefined);
      setFresh(undefined);
      if (document) invoke(service.repository.discardHighlight(document, node).then(() => service.changed()));
    },
    doneEditing: () => {
      setEditingComment(undefined);
      setFresh(undefined);
    },
  };
  const sourcesControl = (node: WorkspaceNode) => (
    <SourcesControl
      node={node}
      nodeByPath={nodeByPath}
      sourcePaths={sourcePaths}
      isHighlight={isHighlight}
      selecting={selecting?.node.path === node.path}
      onFocusHighlight={focusHighlight}
      onOpenNote={openVault}
      onEditSources={(target) => setSelecting({ node: target, paths: new Set(target.sources) })}
    />
  );

  // ---- Render ------------------------------------------------------------
  if (!initial.documentId)
    return (
      <div className="rwt-workspace rwt-empty">
        <IconButton icon="book-open" label={t("workspace.action.openBook")} onClick={showPicker} />
      </div>
    );
  const sourceReady = source?.status === "ready";
  return (
    <div className={"rwt-workspace" + (reading ? " is-reading" : "")}>
      <header className="rwt-toolbar">
        {initial.history?.length ? (
          <IconButton
            icon="arrow-left"
            label={t("workspace.action.back")}
            onClick={() => invoke(navigate(initial.history?.[initial.history.length - 1] || "", true))}
          />
        ) : null}
        <button type="button" className="rwt-book-title" onClick={showPicker}>
          {document?.title || "…"}
          <small>{document?.author}</small>
        </button>
        {initial.history?.length ? (
          <span className="rwt-provenance" title={t("workspace.action.provenance")}>
            <span aria-hidden="true">↳</span>
          </span>
        ) : null}
        <div className="rwt-toolbar-spacer" />
        <IconButton
          icon="book-open"
          label={t("workspace.action.bookText")}
          active={sourceOpen}
          onClick={() => dispatch({ type: "toggleSource" })}
        />
        <IconButton
          icon="panel-left-close"
          label={t("workspace.action.collapseNotes")}
          active={collapsed}
          disabled={!sourceOpen && !right}
          onClick={() => dispatch({ type: "toggleNotes" })}
        />
        {document?.notePath && (
          <IconButton
            icon="file-text"
            label={t("workspace.action.openBookFile")}
            onClick={() => openVault(document.notePath as string)}
          />
        )}
      </header>
      {error && (
        <div className="rwt-status" role="alert">
          {error}
          <IconButton icon="refresh-cw" label={t("workspace.action.retry")} onClick={() => service.changed()} />
        </div>
      )}
      {selecting && (
        <SelectionBar
          app={plugin.app}
          selection={selecting}
          isHighlight={isHighlight}
          files={() => service.storage.files()}
          onChange={setSelecting}
          onCancel={() => setSelecting(undefined)}
          onSave={() =>
            invoke(
              (async () => {
                await service.repository.updateSources(selecting.node, [...selecting.paths]);
                setSelecting(undefined);
                service.changed();
              })(),
            )
          }
        />
      )}
      <div
        className="rwt-stage"
        ref={stage}
        onClickCapture={(event) => {
          // In full screen the rails only lead back to the usual layout.
          if (reading && (event.target as HTMLElement).closest(".rwt-rail")) {
            event.stopPropagation();
            dispatch({ type: "exitReading" });
          }
        }}
      >
        {sourceOpen && (
          <section
            className="rwt-pane rwt-source-pane"
            ref={sourcePane}
            onMouseUp={selection.read}
            onKeyUp={selection.read}
            onWheel={selection.clear}
            style={{ flexGrow: right ? 1 - split : collapsed ? 1 : split }}
          >
            <div className="rwt-pane-tools">
              <IconButton
                icon={reading ? "minimize-2" : "maximize-2"}
                label={t(reading ? "workspace.action.exitFullscreen" : "workspace.action.fullscreen")}
                active={reading}
                onClick={() => dispatch({ type: "toggleReading" })}
              />
              <IconButton icon="paperclip" label={t("workspace.action.pickVaultFile")} onClick={attachVault} />
              <IconButton
                icon="upload"
                label={t("workspace.action.attachLocalFile")}
                onClick={() => fileInput.current?.click()}
              />
              <IconButton
                icon="refresh-cw"
                label={t("workspace.action.refreshText")}
                disabled={text.busy}
                onClick={() => {
                  coordinator.lead(null);
                  void text.reload(true);
                }}
              />
              {sourceReady && (
                <TranslationTools
                  state={translation}
                  canPublish={!!document?.readerId}
                  onDismissError={() => document && service.translations.dismiss(document.id)}
                />
              )}
              {source?.originalPath && (
                <IconButton
                  icon="external-link"
                  label={t("workspace.action.openOriginal")}
                  onClick={() => openVault(source.originalPath as string)}
                />
              )}
              <span className="rwt-toolbar-spacer" />
              <IconButton
                icon="x"
                label={t(reading ? "workspace.action.exitFullscreenShort" : "workspace.action.collapseText")}
                onClick={() => dispatch({ type: reading ? "exitReading" : "closeSource" })}
              />
            </div>
            <input
              className="rwt-hidden"
              type="file"
              ref={fileInput}
              accept={FILE_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) attachLocalFile(file);
                event.target.value = "";
              }}
            />
            {text.busy && (
              <div className="rwt-status" role="status">
                {t("workspace.status.loading")}
              </div>
            )}
            {!sourceReady && !text.busy && (
              <div className="rwt-source-empty">
                <span>
                  {source?.message ||
                    t(source?.status === "processing" ? "workspace.status.processing" : "workspace.status.attachText")}
                </span>
                <div>
                  <IconButton icon="folder-open" label={t("workspace.action.pickVaultFile")} onClick={attachVault} />
                  <IconButton
                    icon="upload"
                    label={t("workspace.action.attachLocalFile")}
                    onClick={() => fileInput.current?.click()}
                  />
                </div>
              </div>
            )}
            {sourceReady && (
              <>
                {anchor?.status !== "matched" && focusPath && (
                  <div className="rwt-anchor-bar">
                    <IconButton
                      icon="crosshair"
                      label={t("workspace.anchor.bind")}
                      active={binding === focusPath}
                      onClick={() => setBinding(binding ? undefined : focusPath)}
                    />
                    {binding && <span>{t("workspace.anchor.pick")}</span>}
                    {anchor?.candidates.map((candidate, index) => (
                      <button
                        type="button"
                        key={candidate.start}
                        title={source.markdown.slice(candidate.start, candidate.end + 80)}
                        onClick={() => invoke(setAnchor(candidate.start, candidate.end))}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                )}
                <VirtualStream
                  panel="source"
                  coordinator={coordinator}
                  items={blocks}
                  itemKey={blockKeyOf}
                  active={activeBlock}
                  navigationKey={focusPath + ":" + jump}
                  onLead={text.abortRepair}
                  initialOffset={positions.current.source}
                  initialAnchor={anchors.current.source}
                  onPosition={(offset, anchor) => position("source", offset, anchor)}
                  onFocus={(block) => {
                    if (selecting || binding) return;
                    const nearest = nearestAnchor(matchedAnchors, (block.start + block.end) / 2);
                    if (nearest) setFocused(nearest.nodePath);
                  }}
                >
                  {(block) => (
                    <TextBlockView
                      app={plugin.app}
                      text={standaloneTableText(
                        (translation.shown && translation.blocks?.[block.key]) || block.text,
                      )}
                      path={source.path || ""}
                      focused={block.key === activeBlock}
                      quote={markedBlocks.has(block.key) ? activeHighlight?.quote : undefined}
                      bindable={!!binding}
                      onBind={binding ? () => invoke(setAnchor(block.start, block.end)) : undefined}
                    />
                  )}
                </VirtualStream>
              </>
            )}
            {selection.selection && (
              <button
                type="button"
                className="rwt-selection-add"
                style={{ left: selection.selection.x, top: selection.selection.y }}
                title={t("workspace.selection.add")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selection.selection && addFromSelection(selection.selection)}
              >
                <Icon icon="message-square-plus" />
              </button>
            )}
          </section>
        )}
        <button
          type="button"
          className={"rwt-rail rwt-source-rail" + (sourceOpen ? " is-active" : "")}
          title={t(sourceOpen ? "workspace.rail.collapseText" : "workspace.rail.toPassage")}
          aria-label={t(sourceOpen ? "workspace.rail.collapseText" : "workspace.rail.toPassage")}
          aria-expanded={sourceOpen}
          onClick={() => dispatch({ type: "toggleSourceRail" })}
        >
          <RailIcon icon="book-open" />
          <span className="rwt-rail-label">{t("workspace.rail.text")}</span>
          <BookMap
            highlights={highlightNodes}
            activePath={focusPath}
            furthestPath={furthest}
            hydrate={(node) => service.repository.hydrate(node)}
            onJump={(path) => {
              focusHighlight(path);
              setJump((count) => count + 1);
            }}
          />
        </button>
        {sourceOpen && !collapsed && (
          <SplitDivider side="source" label={t("workspace.divider.text")} split={split} stage={stage} onChange={setSplit} />
        )}
        {collapsed ? (
          <button
            type="button"
            className="rwt-rail"
            title={t("workspace.action.expandNotes")}
            aria-label={t("workspace.action.expandNotes")}
            onClick={() => dispatch({ type: "expandNotes" })}
          >
            <RailIcon icon="notebook-pen" />
            <span className="rwt-rail-label">{t("workspace.rail.notes")}</span>
          </button>
        ) : (
          <section className="rwt-pane rwt-notes-pane" style={{ flexGrow: sourceOpen || right ? 1 - split : 1 }}>
            <div className="rwt-pane-tools">
              <span className="rwt-pane-title">
                {t("workspace.notes.title")}
                {highlightNodes.length > 0 && <small>{highlightNodes.length}</small>}
              </span>
              <span className="rwt-toolbar-spacer" />
              {(sourceOpen || right) && (
                <IconButton
                  icon="panel-right-close"
                  label={t("workspace.action.collapseNotes")}
                  onClick={() => dispatch({ type: "collapseNotes" })}
                />
              )}
            </div>
            {highlightNodes.length === 0 && <p className="rwt-pane-empty">{t("workspace.notes.empty")}</p>}
            <VirtualStream
              panel="highlights"
              coordinator={coordinator}
              items={highlightNodes}
              itemKey={keyOf}
              active={focusPath}
              editing={editingComment}
              initialOffset={positions.current.highlights}
              initialAnchor={anchors.current.highlights}
              onPosition={(offset, anchor) => position("highlights", offset, anchor)}
              onFocus={(node) => follow("highlights", node)}
            >
              {(node) => (
                <HighlightCard
                  app={plugin.app}
                  service={service}
                  node={node}
                  focused={node.path === focusPath}
                  editing={editingComment === node.path}
                  fresh={fresh?.path === node.path}
                  tableIndex={highlightTables}
                  passage={passageOf(node)}
                  selected={selecting?.paths.has(node.path)}
                  onSelect={
                    selecting
                      ? (checked) => {
                          const paths = new Set(selecting.paths);
                          if (checked) paths.add(node.path);
                          else paths.delete(node.path);
                          setSelecting({ ...selecting, paths });
                        }
                      : undefined
                  }
                  actions={highlightActions}
                />
              )}
            </VirtualStream>
          </section>
        )}
        {RIGHT_KINDS.map((kind) => (
          <React.Fragment key={kind}>
            {right === kind && (!collapsed || sourceOpen) && (
              <SplitDivider side="notes" label={t("workspace.divider.right")} split={split} stage={stage} onChange={setSplit} />
            )}
            <button
              type="button"
              className={"rwt-rail" + (right === kind ? " is-active" : "")}
              title={panelName(kind)}
              aria-label={panelName(kind)}
              aria-expanded={right === kind}
              onClick={() => dispatch({ type: "toggleRight", kind })}
            >
              <RailIcon icon={panelIcons[kind]} />
              <span className="rwt-rail-label">{railLabel(kind)}</span>
              <span className="rwt-rail-count">{streams[kind].length || ""}</span>
            </button>
            {right === kind && (
              <section className="rwt-pane rwt-right-pane" style={{ flexGrow: split }}>
                <div className="rwt-pane-tools">
                  <IconButton
                    icon="plus"
                    label={t("workspace.panel.create", { panel: panelName(kind) })}
                    disabled={creating}
                    onClick={() => createInPane(kind)}
                  />
                  {kind === "dialog" && (
                    <IconButton
                      icon="messages-square"
                      label={t("workspace.panel.chat")}
                      active={chatOpen}
                      onClick={() => setChatOpen(!chatOpen)}
                    />
                  )}
                  <IconButton
                    icon="star"
                    label={t("workspace.panel.onlyImportant")}
                    active={onlyImportant}
                    onClick={() => setOnlyImportant(!onlyImportant)}
                  />
                  <span className="rwt-toolbar-spacer" />
                  <IconButton
                    icon="maximize-2"
                    label={t("workspace.action.collapseNotes")}
                    active={collapsed}
                    disabled={!sourceOpen && !right}
                    onClick={() => dispatch({ type: "toggleNotes" })}
                  />
                  <IconButton
                    icon="columns-2"
                    label={t("workspace.panel.sideBySide")}
                    active={sourceOpen}
                    onClick={() => dispatch({ type: "toggleSourceBesideRight" })}
                  />
                  <IconButton icon="x" label={t("workspace.panel.close")} onClick={() => dispatch({ type: "closeRight" })} />
                </div>
                {kind === "dialog" && chatOpen ? (
                  chat ? (
                    <ChatFeed
                      plugin={plugin}
                      node={chat}
                      document={document}
                      revision={source?.revision}
                      onOrigin={openOrigin}
                      onThought={(message) =>
                        createThoughtFrom(message.content, [chat.path + "#^" + message.id, ...message.sources])
                      }
                    />
                  ) : null
                ) : (
                  <>
                    <VirtualStream
                      panel={kind}
                      coordinator={coordinator}
                      items={streams[kind]}
                      itemKey={keyOf}
                      active={cursor[kind]}
                      editing={editing}
                      initialOffset={positions.current[kind]}
                      initialAnchor={anchors.current[kind]}
                      onPosition={(offset, anchor) => position(kind, offset, anchor)}
                      onFocus={(node) => follow(kind, node)}
                    >
                      {(node) => (
                        <NoteCard
                          plugin={plugin}
                          node={node}
                          document={document}
                          revision={source?.revision}
                          focused={cursor[kind] === node.path}
                          autoFocus={focusNote === node.path}
                          sources={sourcesControl(node)}
                          canSaveToReadwise={aiAvailable}
                          navigate={navigate}
                          onFocus={() => follow(kind, node)}
                          onEditing={setEditing}
                          onDone={() => setFocusNote(undefined)}
                          onThought={createThoughtFrom}
                          onDiscard={() => discardNode(node)}
                          onSaveToReadwise={() => saveToReadwise(node)}
                          onImportant={(important) => toggleImportant(node, important)}
                        />
                      )}
                    </VirtualStream>
                    {!streams[kind].length && onlyImportant && (
                      <p className="rwt-pane-empty">{t("workspace.panel.noImportant")}</p>
                    )}
                    {!streams[kind].length && !onlyImportant && (
                      <div className="rwt-create-empty">
                        <IconButton
                          icon="plus"
                          label={t("workspace.panel.create", { panel: panelName(kind) })}
                          onClick={() => createInPane(kind)}
                        />
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
