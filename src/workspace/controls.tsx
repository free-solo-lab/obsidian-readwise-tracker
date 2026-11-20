import * as React from "react";
import {
  Component,
  MarkdownRenderer,
  SuggestModal,
  setIcon,
  type App,
} from "obsidian";
import type { BookWorkspaceService } from "./service";
import type { WorkspaceNode } from "./types";
import { parseMarkdown } from "./markdown";
import {
  parseHighlightNote,
  withHighlightComment,
} from "../services/readwiseHighlightParsing";
import { WorkspaceConflictError } from "./repository";
import { t } from "../i18n";
import type { BookArchiveFilter } from "../utils/bookArchive";
import { startTimer, stopTimer } from "../utils/timers";

const imageDimensions = new WeakMap<
  App,
  Map<string, { width: number; height: number }>
>();

/** Obsidian's own Lucide icon, so controls match native weights. */
export function Icon({ icon }: { icon: string }): React.ReactElement {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (ref.current) setIcon(ref.current, icon);
  }, [icon]);
  return <span ref={ref} aria-hidden="true" />;
}
const clampSplit = (value: number) => Math.max(0.25, Math.min(0.75, value));
/** Draggable and keyboard-operable boundary; `side` says which pane it resizes. */
export function SplitDivider({
  side,
  label,
  split,
  stage,
  onChange,
}: {
  side: "source" | "notes";
  label: string;
  split: number;
  stage: React.RefObject<HTMLDivElement>;
  onChange: (split: number) => void;
}): React.ReactElement {
  const sign = side === "source" ? -1 : 1;
  return (
    <div
      className="rwt-divider"
      role="separator"
      aria-label={label}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft")
          onChange(clampSplit(split - sign * 0.05));
        if (event.key === "ArrowRight")
          onChange(clampSplit(split + sign * 0.05));
      }}
      onPointerDown={(event) =>
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      onPointerMove={(event) => {
        if (
          !event.currentTarget.hasPointerCapture(event.pointerId) ||
          !stage.current
        )
          return;
        const rect = stage.current.getBoundingClientRect(),
          ratio = (event.clientX - rect.left) / rect.width;
        onChange(clampSplit(side === "source" ? ratio : 1 - ratio));
      }}
      onPointerUp={(event) =>
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    />
  );
}
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  keepFocus,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Do not take focus from a field being edited (so its blur does not hide this button first). */
  keepFocus?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={"rwt-icon" + (active ? " is-active" : "")}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon icon={icon} />
    </button>
  );
}
export function Markdown({
  app,
  text,
  path,
}: {
  app: App;
  text: string;
  path: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const component = new Component();
    component.load();
    let alive = true;
    let dimensions = imageDimensions.get(app);
    if (!dimensions) {
      dimensions = new Map();
      imageDimensions.set(app, dimensions);
    }
    const sizes = dimensions;
    const remember = (image: HTMLImageElement) => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      sizes.delete(image.src);
      sizes.set(image.src, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      if (sizes.size > 512) sizes.delete(sizes.keys().next().value as string);
    };
    const loaded = (event: Event) => {
      if ((event.target as HTMLElement).tagName === "IMG")
        remember(event.target as HTMLImageElement);
    };
    element.addEventListener("load", loaded, true);
    element.dataset.rwtRenderState = "pending";
    element.replaceChildren();
    const ready = () => {
      if (!alive) return;
      for (const table of Array.from(element.querySelectorAll("table"))) {
        if (table.parentElement?.closest("table, .rwt-table-scroll")) continue;
        const scroll = createDiv({
          cls: "rwt-table-scroll",
          attr: { tabindex: "0", role: "region", "aria-label": t("workspace.table") },
        });
        table.before(scroll);
        scroll.appendChild(table);
      }
      for (const image of Array.from(element.querySelectorAll("img"))) {
        const known = sizes.get(image.src);
        if (
          known &&
          !image.hasAttribute("width") &&
          !image.hasAttribute("height")
        ) {
          image.width = known.width;
          image.height = known.height;
        }
        remember(image);
      }
      element.dataset.rwtRenderState = "ready";
      element.dispatchEvent(new Event("rwt-markdown-ready", { bubbles: true }));
    };
    void MarkdownRenderer.render(app, text, element, path, component).then(
      ready,
      () => {
        if (!alive) return;
        element.textContent = text;
        ready();
      },
    );
    return () => {
      alive = false;
      element.removeEventListener("load", loaded, true);
      component.unload();
    };
  }, [app, text, path]);
  return (
    <div
      className="rwt-markdown markdown-rendered"
      data-rwt-render-state="pending"
      ref={ref}
    />
  );
}
export interface Choice {
  id: string;
  title: string;
  detail?: string;
  /** Set for books: lets the picker split the archive from the rest. */
  archived?: boolean;
}
export class WorkspacePicker extends SuggestModal<Choice> {
  constructor(
    app: App,
    private readonly choices: Choice[],
    private readonly selected: (choice: Choice) => void,
    placeholder: string,
  ) {
    super(app);
    this.modalEl.addClass("rwt-picker");
    this.setPlaceholder(placeholder);
    if (choices.some((item) => item.archived !== undefined)) this.mountFilter();
    // A short menu needs no search: keep the field for the keyboard, but out of sight.
    if (choices.length <= 6) {
      this.modalEl.addClass("rwt-picker-plain");
      this.titleEl.setText(placeholder);
    }
  }
  private filter: BookArchiveFilter = "all";
  private mountFilter(): void {
    const bar = this.modalEl.createDiv({ cls: "rwt-picker-filter" });
    this.modalEl.insertBefore(bar, this.modalEl.querySelector(".prompt-results"));
    const labels = {
      all: "picker.filterAll",
      active: "picker.filterActive",
      archive: "picker.filterArchive",
    } as const;
    for (const filter of ["all", "active", "archive"] as const) {
      const button = bar.createEl("button", { text: t(labels[filter]), cls: "rwt-picker-filter-item" });
      button.toggleClass("is-active", filter === this.filter);
      button.addEventListener("click", () => {
        this.filter = filter;
        bar.querySelectorAll("button").forEach((item) => item.removeClass("is-active"));
        button.addClass("is-active");
        this.inputEl.dispatchEvent(new Event("input"));
        this.inputEl.focus();
      });
    }
  }
  getSuggestions(query: string): Choice[] {
    const words = query.toLocaleLowerCase().split(/\s+/);
    return this.choices
      .filter((item) => this.filter === "all" || !!item.archived === (this.filter === "archive"))
      .filter((item) =>
        words.every((word) =>
          (item.title + " " + (item.detail || ""))
            .toLocaleLowerCase()
            .includes(word),
        ),
      )
      .slice(0, 80);
  }
  renderSuggestion(item: Choice, element: HTMLElement): void {
    element.addClass("rwt-picker-item");
    element.createDiv({ text: item.title, cls: "rwt-picker-title" });
    if (item.detail)
      element.createDiv({ text: item.detail, cls: "rwt-picker-detail" });
  }
  onChooseSuggestion(item: Choice): void {
    this.selected(item);
  }
}

/** Keep the editor mounted in a virtual stream and flush the same draft on blur/close/navigation. */
export function NoteEditor({
  service,
  node,
  draft = false,
  comment = false,
  autoFocus = false,
  onEditing,
  onDone,
  onSubmit,
  onValueChange,
  placeholder,
}: {
  service: BookWorkspaceService;
  node: WorkspaceNode;
  draft?: boolean;
  /** Edit only the reader's comment of a highlight, not the whole note. */
  comment?: boolean;
  autoFocus?: boolean;
  onEditing: (path?: string) => void;
  onDone?: () => void;
  /** Cmd/Ctrl+Enter: the draft is saved first, then this runs. */
  onSubmit?: () => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const initial = draft
    ? String(parseMarkdown(node.raw).metadata.rwt_draft || "")
    : comment
      ? parseHighlightNote(node.body).description
      : node.body.replace(/^\n+/, "");
  const [value, setValue] = React.useState(initial);
  const valueListener = React.useRef(onValueChange);
  valueListener.current = onValueChange;
  React.useEffect(() => valueListener.current?.(value), [value]);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const state = React.useRef({
    node,
    value: initial,
    dirty: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    saving: Promise.resolve(),
  });
  const flush = React.useCallback(async () => {
    const editor = state.current;
    if (editor.timer) stopTimer(editor.timer);
    if (!editor.dirty) return editor.saving;
    const text = editor.value,
      base = editor.node;
    editor.dirty = false;
    editor.saving = editor.saving
      .catch(() => undefined)
      .then(async () => {
        try {
          if (draft) await service.repository.saveDraft(base, text);
          else
            await service.repository.saveBody(
              base,
              comment ? withHighlightComment(base.body, text) : text,
            );
          service.changed();
        } catch (error) {
          // Keep editing the preserved copy; otherwise every later pause in typing
          // would fail the same comparison and create another conflict file.
          if (error instanceof WorkspaceConflictError)
            editor.node = {
              ...base,
              path: error.copyPath,
              raw: error.copyRaw,
              body: parseMarkdown(error.copyRaw).body,
            };
          service.report(error);
        }
      });
    await editor.saving;
  }, [service, draft, comment]);
  React.useEffect(() => service.editor(flush), [service, flush]);
  React.useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );
  const seen = React.useRef(initial);
  React.useEffect(() => {
    // A value changed behind the editor (e.g. the draft was sent) replaces it even while focused.
    const changed = seen.current !== initial;
    seen.current = initial;
    if (
      !state.current.dirty &&
      (changed || document.activeElement !== ref.current)
    ) {
      state.current.node = node;
      state.current.value = initial;
      setValue(initial);
    }
  }, [initial, node]);
  React.useEffect(() => {
    const input = ref.current;
    if (!autoFocus || !input) return;
    input.focus({ preventScroll: true });
    // A prepared text is continued, not overwritten: caret goes to its end.
    input.setSelectionRange(input.value.length, input.value.length);
  }, [autoFocus]);
  React.useLayoutEffect(() => {
    const input = ref.current;
    if (input) {
      // Measure at natural height (class), then publish the result as a CSS variable.
      input.addClass("is-measuring");
      const height = Math.max(
        draft ? 96 : comment ? 56 : 140,
        input.scrollHeight,
      );
      input.removeClass("is-measuring");
      input.setCssProps({
        "--rwt-editor-height": (draft ? Math.min(240, height) : height) + "px",
      });
      input.toggleClass("is-scrolling", draft && height > 240);
    }
  }, [value, draft, comment]);
  return (
    <textarea
      ref={ref}
      className={
        "rwt-editor" +
        (draft ? " rwt-question" : "") +
        (comment ? " rwt-comment-editor" : "")
      }
      value={value}
      placeholder={
        placeholder ||
        t(
          draft
            ? "workspace.editor.question"
            : comment
              ? "workspace.editor.comment"
              : "workspace.editor.thought",
        )
      }
      aria-label={t(draft ? "workspace.editor.questionLabel" : "workspace.editor.noteLabel")}
      onFocus={() => onEditing(node.path)}
      onBlur={() => {
        void flush()
          .then(async () => {
            const editor = state.current;
            if (draft || comment || editor.dirty) return;
            const renamed = await service.repository.nameThought(
              editor.node,
              editor.value,
            );
            if (renamed) {
              editor.node = { ...editor.node, path: renamed };
              service.changed();
            }
          })
          .catch((error: unknown) => service.report(error))
          .then(() => {
            onEditing(undefined);
            onDone?.();
          });
      }}
      onKeyDown={(event) => {
        if (
          onSubmit &&
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          void flush().then(onSubmit);
        }
      }}
      onChange={(event) => {
        const text = event.target.value;
        setValue(text);
        valueListener.current?.(text);
        state.current.value = text;
        state.current.dirty = true;
        if (state.current.timer) stopTimer(state.current.timer);
        state.current.timer = startTimer(() => {
          void flush();
        }, 450);
      }}
    />
  );
}
