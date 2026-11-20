import * as React from "react";
import { quoteSpans } from "../notePassage";

/** The parts of the CSS Custom Highlight API used here; TypeScript 4.7 has no types for it. */
interface HighlightSet {
  add(range: Range): void;
  delete(range: Range): boolean;
}
interface HighlightScope {
  Highlight?: new () => HighlightSet;
  CSS?: { highlights?: Map<string, HighlightSet> };
}

/** The name the stylesheet styles with `::highlight(rwt-note)`. */
const HIGHLIGHT_NAME = "rwt-note";
/** One highlight per window: Obsidian pop-out windows have their own registry. */
const registries = new WeakMap<object, HighlightSet | null>();

function registry(element: HTMLElement): HighlightSet | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) return undefined;
  let found = registries.get(view);
  if (found === undefined) {
    const scope = view as unknown as HighlightScope;
    found = null;
    if (scope.Highlight && scope.CSS?.highlights) {
      found = new scope.Highlight();
      scope.CSS.highlights.set(HIGHLIGHT_NAME, found);
    }
    registries.set(view, found);
  }
  return found ?? undefined;
}

/** DOM ranges over the rendered text of `element` for each place the quote occurs. */
function quoteRanges(element: HTMLElement, quote: string): Range[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [],
    starts: number[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += node.nodeValue || "";
  }
  /** The text node holding character `offset`, searching from the end of the run. */
  const at = (offset: number) => {
    let index = nodes.length - 1;
    while (index > 0 && starts[index] > offset) index--;
    return index;
  };
  return quoteSpans(text, quote).map(({ start, end }) => {
    const first = at(start),
      last = at(end - 1);
    const range = element.ownerDocument.createRange();
    range.setStart(nodes[first], start - starts[first]);
    range.setEnd(nodes[last], end - starts[last]);
    return range;
  });
}

/**
 * Marks the note's quote inside a rendered text block, again after every re-render.
 * Returns whether anything was marked, so the block can fall back to highlighting as a
 * whole when the quote's words are not the ones on screen (or the browser lacks the API).
 */
export function useQuoteMarks(
  container: React.RefObject<HTMLElement>,
  quote: string | undefined,
): boolean {
  const [marked, setMarked] = React.useState(false);
  React.useEffect(() => {
    const element = container.current;
    const highlights = element && registry(element);
    if (!element || !highlights || !quote) {
      setMarked(false);
      return;
    }
    let ranges: Range[] = [];
    const clear = () => {
      for (const range of ranges) highlights.delete(range);
      ranges = [];
    };
    const apply = () => {
      clear();
      if (element.querySelector('[data-rwt-render-state="pending"]')) return;
      ranges = quoteRanges(element, quote);
      for (const range of ranges) highlights.add(range);
      setMarked(ranges.length > 0);
    };
    element.addEventListener("rwt-markdown-ready", apply);
    apply();
    return () => {
      element.removeEventListener("rwt-markdown-ready", apply);
      clear();
    };
  }, [container, quote]);
  return marked;
}
