import * as React from "react";

export interface TextSelection {
  text: string;
  /** Where the "add note" button goes, relative to the pane. */
  x: number;
  y: number;
  /** Index of the text block the selection starts in. */
  block: number;
}

/** The reader's selection inside a pane of virtual text blocks, for turning it into a note. */
export function useTextSelection(
  pane: React.RefObject<HTMLElement>,
  enabled: boolean,
): { selection?: TextSelection; read: () => void; clear: () => void } {
  const [selection, setSelection] = React.useState<TextSelection>();
  const clear = React.useCallback(() => setSelection(undefined), []);
  const read = React.useCallback(() => {
    const range = window.getSelection();
    const host = pane.current;
    const text = range?.toString().trim() || "";
    if (!enabled || !range || !host || !text || range.rangeCount === 0) return setSelection(undefined);
    const live = range.getRangeAt(0);
    const startNode = live.startContainer;
    const row = (startNode instanceof Element ? startNode : startNode.parentElement)?.closest<HTMLElement>(
      ".rwt-stream-item",
    );
    if (!row || !host.contains(row)) return setSelection(undefined);
    const box = live.getBoundingClientRect(),
      frame = host.getBoundingClientRect();
    setSelection({
      text,
      x: Math.min(Math.max(8, box.right - frame.left), frame.width - 40),
      y: Math.max(8, box.top - frame.top - 40),
      block: Number(row.dataset.index),
    });
  }, [pane, enabled]);
  return { selection, read, clear };
}
