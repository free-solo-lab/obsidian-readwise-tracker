import * as React from "react";
import { createPortal } from "react-dom";
import type { WorkspaceNode } from "./types";
import { parseHighlightNote } from "../services/readwiseHighlightParsing";
import { t } from "../i18n";
import { markGroup } from "./bookMapMarks";

const PREVIEW_CANDIDATES = 8;
const PREVIEW_LENGTH = 220;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? flat.slice(0, PREVIEW_LENGTH).trimEnd() + "…" : flat;
}

interface Preview {
  mark: number;
  path: string;
  title: string;
  text: string;
  top: number;
  left: number;
  side: "left" | "right";
}

/**
 * A ruler of ticks along the book: hover shows the reader's comment (or the quote) of that
 * place in brief, a click takes every pane there.
 */
export function BookMap({
  highlights,
  activePath,
  furthestPath,
  hydrate,
  onJump,
}: {
  highlights: WorkspaceNode[];
  activePath: string | undefined;
  furthestPath?: string;
  hydrate: (node: WorkspaceNode) => Promise<WorkspaceNode>;
  onJump: (path: string) => void;
}): React.ReactElement {
  const group = markGroup(highlights.length);
  const marks = Math.ceil(highlights.length / group);
  const active = Math.max(
    0,
    highlights.findIndex((node) => node.path === activePath),
  );
  const hot = Math.floor(active / group);
  const furthestIndex = highlights.findIndex((node) => node.path === furthestPath);
  const far = furthestIndex < 0 ? -1 : Math.floor(furthestIndex / group);
  const [preview, setPreview] = React.useState<Preview>();
  const request = React.useRef(0);
  const root = React.useRef<HTMLSpanElement>(null);

  /** Within the stretch a mark covers, prefer the highlight the reader commented on. */
  const resolve = async (mark: number): Promise<{ node: WorkspaceNode; text: string } | undefined> => {
    const from = mark * group,
      to = Math.min(highlights.length, from + group);
    const span = highlights.slice(from, Math.min(to, from + PREVIEW_CANDIDATES));
    const full = await Promise.all(span.map((node) => hydrate(node).catch(() => node)));
    for (const node of full) {
      const comment = parseHighlightNote(node.body).description.trim();
      if (comment) return { node, text: comment };
    }
    const first = full[0];
    return first ? { node: first, text: parseHighlightNote(first.body).quote || first.quote } : undefined;
  };

  const show = (mark: number, element: HTMLElement) => {
    const id = ++request.current,
      rect = element.getBoundingClientRect(),
      view = element.ownerDocument.defaultView ?? window;
    const side = rect.right + 320 > view.innerWidth ? "left" : "right";
    void resolve(mark).then((found) => {
      if (id !== request.current || !found) return;
      setPreview({
        mark,
        path: found.node.path,
        title: found.node.title,
        text: clip(found.text),
        top: rect.top + rect.height / 2,
        left: side === "right" ? rect.right + 14 : rect.left - 14,
        side,
      });
    });
  };
  const hide = () => {
    request.current++;
    setPreview(undefined);
  };
  React.useEffect(() => hide, []);

  const body = root.current?.ownerDocument.body;
  return (
    <span
      ref={root}
      className="rwt-book-map"
      onClick={(event) => event.stopPropagation()}
      onMouseLeave={hide}
    >
      {Array.from({ length: marks }, (_, mark) => (
        <i
          key={mark}
          role="button"
          tabIndex={-1}
          aria-label={t("workspace.map.jump")}
          className={mark === hot ? "is-active" : mark === far ? "is-furthest" : ""}
          onMouseEnter={(event) => show(mark, event.currentTarget)}
          onClick={(event) => {
            event.stopPropagation();
            void resolve(mark).then((found) =>
              onJump(found?.node.path ?? highlights[mark * group].path),
            );
          }}
        />
      ))}
      {preview &&
        body &&
        createPortal(
          <div
            className={"rwt-map-tip is-" + preview.side}
            style={{ top: preview.top, left: preview.left }}
          >
            <div className="rwt-map-tip-title">{preview.title}</div>
            {preview.text && <div className="rwt-map-tip-text">{preview.text}</div>}
          </div>,
          body,
        )}
    </span>
  );
}
