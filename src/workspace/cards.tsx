import * as React from "react";
import type { App } from "obsidian";
import type { ReadwiseTrackerViewHost } from "../plugin/contracts";
import type { BookWorkspaceService } from "./service";
import type { WorkspaceDocument, WorkspaceNode } from "./types";
import type { HighlightTableIndex } from "./highlightTables";
import type { NotePassage } from "./notePassage";
import { Icon, IconButton, Markdown, NoteEditor } from "./controls";
import { DialogBody } from "./DialogView";
import { basename, blockquote } from "./markdown";
import { highlightLabel } from "./focus";
import { manifestPath } from "./layout";
import { parseHighlightNote } from "../services/readwiseHighlightParsing";
import { t } from "../i18n";

/**
 * The reader's own comment leads in full size; the quoted text follows, smaller. When the text
 * on screen is the other one (translation vs original), the passage as that text has it takes
 * the quote's place and the note's own words follow under a label.
 */
export function HighlightBody({
  app,
  body,
  path,
  editor,
  tableIndex,
  passage,
}: {
  app: App;
  body: string;
  path: string;
  /** While set, replaces the comment with an editable field. */
  editor?: React.ReactNode;
  tableIndex?: HighlightTableIndex;
  passage?: NotePassage;
}): React.ReactElement {
  const { quote, comment } = React.useMemo(() => {
    const { quote, description } = parseHighlightNote(body);
    return { quote: tableIndex?.format(quote) || quote, comment: description };
  }, [body, tableIndex]);
  const shownQuote = passage ? blockquote(passage.text) : quote ? blockquote(quote) : undefined;
  const own = passage && quote && (
    <div className="rwt-quote rwt-quote-own">
      <span className="rwt-quote-label">
        {t(
          passage.quoteIn === "original"
            ? "workspace.highlight.quoteOriginal"
            : "workspace.highlight.quoteTranslation",
        )}
      </span>
      <Markdown app={app} text={blockquote(quote)} path={path} />
    </div>
  );
  if (!editor && (!comment || !quote))
    return (
      <>
        <Markdown
          app={app}
          text={shownQuote ?? body.replace(/\n##\s+(Links|Связи)[\s\S]*$/, "")}
          path={path}
        />
        {own}
      </>
    );
  return (
    <>
      <div className="rwt-comment">
        {editor ?? <Markdown app={app} text={comment} path={path} />}
      </div>
      <div className="rwt-quote">
        <Markdown app={app} text={shownQuote ?? blockquote(quote)} path={path} />
      </div>
      {own}
    </>
  );
}

export interface HighlightActions {
  showPassage: (node: WorkspaceNode) => void;
  openThought: (node: WorkspaceNode) => void;
  openDialog: (node: WorkspaceNode) => void;
  /** Absent when no AI adapter is available. */
  saveToReadwise?: (node: WorkspaceNode) => void;
  editComment: (node: WorkspaceNode) => void;
  openNote: (path: string) => void;
  /** Undo a note just written from a selection. */
  cancelFresh: (node: WorkspaceNode) => void;
  doneEditing: () => void;
}

/** One highlight in the notes pane: its label, action row and body. */
export function HighlightCard({
  app,
  service,
  node,
  focused,
  editing,
  fresh,
  tableIndex,
  passage,
  selected,
  onSelect,
  actions,
}: {
  app: App;
  service: BookWorkspaceService;
  node: WorkspaceNode;
  focused: boolean;
  editing: boolean;
  fresh: boolean;
  tableIndex?: HighlightTableIndex;
  /** The passage as the text on screen has it, when the note's own quote is in the other text. */
  passage?: NotePassage;
  /** Set while sources are being re-chosen for another note. */
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  actions: HighlightActions;
}): React.ReactElement {
  return (
    <article className={"rwt-highlight" + (focused ? " is-focused" : "")} data-node={node.path}>
      <div className="rwt-highlight-meta">
        {onSelect && (
          <input
            type="checkbox"
            aria-label={t("workspace.highlight.source", { title: node.title })}
            checked={!!selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
        )}
        <span>{highlightLabel(node)}</span>
        <span className="rwt-toolbar-spacer" />
        <IconButton icon="book-open" label={t("workspace.rail.toPassage")} onClick={() => actions.showPassage(node)} />
        <IconButton icon="lightbulb" label={t("workspace.highlight.idea")} onClick={() => actions.openThought(node)} />
        <IconButton icon="sparkles" label={t("workspace.highlight.ask")} onClick={() => actions.openDialog(node)} />
        {actions.saveToReadwise && (
          <IconButton
            icon="cloud-upload"
            label={t("workspace.action.saveToReadwise")}
            onClick={() => actions.saveToReadwise?.(node)}
          />
        )}
        <IconButton
          icon="pencil-line"
          label={t("workspace.highlight.editComment")}
          onClick={() => actions.editComment(node)}
        />
        <IconButton icon="external-link" label={t("workspace.highlight.open")} onClick={() => actions.openNote(node.path)} />
        {fresh && editing && (
          <IconButton
            icon="x"
            label={t("workspace.highlight.cancel")}
            keepFocus
            onClick={() => actions.cancelFresh(node)}
          />
        )}
      </div>
      <HighlightBody
        app={app}
        body={node.body}
        path={node.path}
        tableIndex={tableIndex}
        passage={passage}
        editor={
          editing ? (
            <NoteEditor
              service={service}
              node={node}
              comment
              autoFocus
              onEditing={() => undefined}
              onDone={actions.doneEditing}
            />
          ) : undefined
        }
      />
    </article>
  );
}

/** The highlights a note is written about, as jump buttons, plus "edit sources" and "open note". */
export function SourcesControl({
  node,
  nodeByPath,
  sourcePaths,
  isHighlight,
  selecting,
  onFocusHighlight,
  onOpenNote,
  onEditSources,
}: {
  node: WorkspaceNode;
  nodeByPath: ReadonlyMap<string, WorkspaceNode>;
  sourcePaths: (node: WorkspaceNode) => string[];
  isHighlight: (path: string) => boolean;
  selecting: boolean;
  onFocusHighlight: (path: string) => void;
  onOpenNote: (path: string) => void;
  onEditSources: (node: WorkspaceNode) => void;
}): React.ReactElement {
  return (
    <div className="rwt-origins">
      {node.sources.map((path) => {
        const origin = nodeByPath.get(path.split("#")[0]);
        return (
          <button
            type="button"
            key={path}
            className="rwt-origin"
            title={path}
            onClick={() => {
              const highlight = origin?.kind === "highlight" ? origin.path : origin ? sourcePaths(origin)[0] : undefined;
              if (highlight && isHighlight(highlight)) onFocusHighlight(highlight);
              else onOpenNote(path);
            }}
          >
            {(origin && highlightLabel(origin)) || "↗"}
          </button>
        );
      })}
      <IconButton
        icon="link-2"
        label={t("workspace.action.changeSources")}
        active={selecting}
        onClick={() => onEditSources(node)}
      />
      <IconButton icon="file-text" label={t("workspace.action.openNote")} onClick={() => onOpenNote(node.path)} />
    </div>
  );
}

/** A thought, dialog or relation in a right pane. */
export function NoteCard({
  plugin,
  node,
  document,
  revision,
  focused,
  autoFocus,
  sources,
  canSaveToReadwise,
  navigate,
  onFocus,
  onEditing,
  onDone,
  onThought,
  onDiscard,
  onSaveToReadwise,
  onImportant,
}: {
  plugin: ReadwiseTrackerViewHost;
  node: WorkspaceNode;
  document?: WorkspaceDocument;
  revision?: string;
  focused: boolean;
  /** The note was just created: its field takes focus. */
  autoFocus: boolean;
  sources: React.ReactNode;
  canSaveToReadwise: boolean;
  navigate: (id: string) => Promise<void>;
  onFocus: () => void;
  onEditing: (path?: string) => void;
  onDone: () => void;
  /** A dialog answer the reader wants to keep as a thought of their own. */
  onThought: (content: string, sources: string[]) => void;
  onDiscard: () => void;
  onSaveToReadwise: () => void;
  onImportant: (important: boolean) => void;
}): React.ReactElement {
  const service = plugin.workspaceService;
  return (
    <article className={"rwt-node" + (focused ? " is-focused" : "") + (node.important ? " is-important" : "")} data-node={node.path} onFocus={onFocus}>
      {node.kind !== "dialog" && sources}
      {(node.kind === "thought" || node.kind === "dialog") && (
        <div className="rwt-card-cancel">
          <IconButton
            icon="star"
            label={t(node.important ? "workspace.action.unmarkImportant" : "workspace.action.markImportant")}
            active={!!node.important}
            onClick={() => onImportant(!node.important)}
          />
          {node.kind === "thought" && canSaveToReadwise && (
            <IconButton icon="cloud-upload" label={t("workspace.action.saveToReadwise")} onClick={onSaveToReadwise} />
          )}
          <IconButton
            icon="x"
            label={t(node.kind === "thought" ? "workspace.action.deleteThought" : "workspace.action.deleteDialog")}
            onClick={onDiscard}
          />
        </div>
      )}
      {node.kind === "dialog" ? (
        <DialogBody
          plugin={plugin}
          node={node}
          document={document}
          revision={revision}
          autoFocus={autoFocus}
          sources={sources}
          onEditing={onEditing}
          onDone={onDone}
          onThought={(message) => onThought(message.content, [node.path + "#^" + message.id, ...message.sources])}
          onCancel={onDiscard}
        />
      ) : (
        <>
          {node.kind === "relation" && node.target && (
            <RelationTarget
              plugin={plugin}
              path={node.target}
              reverseDocumentId={
                document &&
                node.documentId !== document.id &&
                (node.target === document.notePath || node.target === manifestPath(document))
                  ? node.documentId
                  : undefined
              }
              navigate={navigate}
            />
          )}
          <NoteEditor service={service} node={node} autoFocus={autoFocus} onEditing={onEditing} onDone={onDone} />
        </>
      )}
    </article>
  );
}

export function RailIcon({ icon }: { icon: string }): React.ReactElement {
  return (
    <span className="rwt-rail-icon">
      <Icon icon={icon} />
    </span>
  );
}

/** The other end of a "relation" note: a button that opens that text in the workspace. */
export function RelationTarget({
  plugin,
  path,
  reverseDocumentId,
  navigate,
}: {
  plugin: ReadwiseTrackerViewHost;
  path: string;
  /** Set when the relation was created from the other document and points back at this one. */
  reverseDocumentId?: string;
  navigate: (id: string) => Promise<void>;
}): React.ReactElement {
  const service = plugin.workspaceService;
  const resolve = React.useCallback(
    () => (reverseDocumentId ? service.document(reverseDocumentId) : service.fromPath(path)),
    [service, path, reverseDocumentId],
  );
  const [target, setTarget] = React.useState<WorkspaceDocument>();
  React.useEffect(() => {
    let alive = true;
    void resolve()
      .then((document) => {
        if (alive) setTarget(document);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [resolve]);
  return (
    <button
      type="button"
      className="rwt-target"
      onClick={() => {
        void (async () => {
          const document = target || (await resolve());
          await navigate(document.id);
        })().catch((error) => service.report(error));
      }}
    >
      <span>
        {target?.title || basename(path)}
        {target?.author && <small>{target.author}</small>}
      </span>
      <span aria-hidden="true">↗</span>
    </button>
  );
}
