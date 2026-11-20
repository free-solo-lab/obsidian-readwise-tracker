import * as React from "react";
import type { App } from "obsidian";
import { Markdown } from "./controls";
import { useQuoteMarks } from "./hooks/useQuoteMarks";

/**
 * One block of the book's text. The note in focus marks only its own words; the block is
 * highlighted as a whole when those words are not on screen (a note made in the other text).
 */
export function TextBlockView({
  app,
  text,
  path,
  focused,
  quote,
  bindable,
  onBind,
}: {
  app: App;
  text: string;
  path: string;
  /** The block holds the start of the focused note's passage. */
  focused: boolean;
  /** The focused note's quote, for every block its passage covers. */
  quote?: string;
  bindable: boolean;
  onBind?: () => void;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const marked = useQuoteMarks(ref, quote);
  return (
    <div
      ref={ref}
      className={
        "rwt-text-block" +
        (focused ? " is-focused" : "") +
        (focused && marked ? " is-marked" : "") +
        (bindable ? " is-bindable" : "")
      }
      onClick={onBind}
    >
      <Markdown app={app} text={text} path={path} />
    </div>
  );
}
