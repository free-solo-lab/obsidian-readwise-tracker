import { normalizedText } from "./anchors";
import type { TextBlock } from "./focus";
import type { SourceAnchor } from "./types";

/**
 * What a note's card shows in place of its quote when the quote is written in the other
 * text: the passage as the current view has it. `quoteIn` names the text the quote came from.
 */
export interface NotePassage {
  text: string;
  quoteIn: "original" | "translation";
}

/** The blocks a range of the original touches, in order. */
export function coveringBlocks(blocks: TextBlock[], start: number, end: number): TextBlock[] {
  let low = 0,
    high = blocks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (blocks[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  const result: TextBlock[] = [];
  for (let index = low; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.start >= Math.max(end, start + 1)) break;
    result.push(block);
  }
  return result;
}

/** Whether a passage contains the quote, ignoring Markdown marks, case and spacing. */
export function containsQuote(passage: string, quote: string): boolean {
  const needle = normalizedText(quote).text;
  return needle.length >= 3 && normalizedText(passage).text.includes(needle);
}

/**
 * A note is anchored to a range of the original and keeps the words the reader selected,
 * which may be the translation's. Whichever text is on screen, the card shows the passage
 * from that text: the note's own quote when it occurs there, otherwise the anchored range as
 * the current view renders it (block by block for the translation).
 */
export function notePassage({
  quote,
  anchor,
  blocks,
  markdown,
  translated,
  shown,
}: {
  quote: string;
  anchor?: SourceAnchor;
  blocks: TextBlock[];
  markdown: string;
  /** Translated blocks keyed like the original's, when a translation exists for this text. */
  translated?: Record<string, string>;
  /** The translation is on screen. */
  shown: boolean;
}): NotePassage | undefined {
  if (!anchor || anchor.status !== "matched" || anchor.start === undefined || anchor.end === undefined)
    return undefined;
  if (shown) {
    if (!translated) return undefined;
    const covering = coveringBlocks(blocks, anchor.start, anchor.end);
    if (!covering.some((block) => translated[block.key])) return undefined;
    const text = covering
      .map((block) => (translated[block.key] ?? block.text).trim())
      .join("\n\n");
    return text && !containsQuote(text, quote) ? { text, quoteIn: "original" } : undefined;
  }
  // A quote matched in the original is the original's own words; only a hand-placed anchor
  // (a whole paragraph behind a passage picked in the translation) can hold other words.
  if (!anchor.manual) return undefined;
  const text = markdown.slice(anchor.start, anchor.end).trim();
  return text && !containsQuote(text, quote) ? { text, quoteIn: "translation" } : undefined;
}

/** The one translated block that contains a quote, for binding a note whose words are the translation's. */
export function translatedQuoteBlock(
  blocks: TextBlock[],
  translated: Record<string, string>,
  quote: string,
): TextBlock | undefined {
  const found = blocks.filter((block) => {
    const text = translated[block.key];
    return !!text && containsQuote(text, quote);
  });
  return found.length === 1 ? found[0] : undefined;
}

/** Lines shorter than this occur too often to be marked on their own. */
const MIN_MARK_LENGTH = 12;

/**
 * Where a note's quote occurs in a rendered passage, as offsets into `text`. The quote is
 * matched line by line, so a quote that spans paragraphs is marked in each of them; a short
 * line that occurs more than once is skipped rather than marked in the wrong place.
 */
export function quoteSpans(text: string, quote: string): Array<{ start: number; end: number }> {
  const full = normalizedText(text);
  const spans: Array<{ start: number; end: number }> = [];
  for (const line of quote.split(/\n+/)) {
    const needle = normalizedText(line).text;
    if (needle.length < 3) continue;
    const at = full.text.indexOf(needle);
    if (at < 0) continue;
    if (needle.length < MIN_MARK_LENGTH && full.text.indexOf(needle, at + 1) >= 0) continue;
    spans.push({ start: full.offsets[at], end: full.ends[at + needle.length - 1] });
  }
  return spans.sort((a, b) => a.start - b.start);
}
