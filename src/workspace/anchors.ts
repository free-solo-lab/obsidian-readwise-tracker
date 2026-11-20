import type { SourceAnchor } from "./types";
import { directImageMatches } from "./images";
import { startTimer } from "../utils/timers";

export const QUOTE_MATCHER_VERSION = 4;
interface WordIndex {
  text: string;
  starts: number[];
  sourceStarts: number[];
  sourceEnds: number[];
}
/** One 32-bit entry per normalized character; plain number[] costs 8 bytes each. */
export interface QuoteIndex {
  text: string;
  offsets: Uint32Array;
  ends: Uint32Array;
  words?: WordIndex;
}
interface IndexBuilder extends QuoteIndex {
  size: number;
}
function builder(): IndexBuilder {
  return { text: "", offsets: new Uint32Array(1024), ends: new Uint32Array(1024), size: 0 };
}
function add(index: IndexBuilder, offset: number, end: number): void {
  if (index.size === index.offsets.length) {
    const grow = (old: Uint32Array) => {
      const next = new Uint32Array(old.length * 2);
      next.set(old);
      return next;
    };
    index.offsets = grow(index.offsets);
    index.ends = grow(index.ends);
  }
  index.offsets[index.size] = offset;
  index.ends[index.size++] = end;
}
function finish(index: IndexBuilder): QuoteIndex {
  return {
    text: index.text.trimEnd(),
    offsets: index.offsets.slice(0, index.size),
    ends: index.ends.slice(0, index.size),
  };
}
const entities: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};
function maskedText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)|<!--[^]*?-->/g, (match) =>
      " ".repeat(match.length),
    )
    .replace(
      /\[([^\]]+)\]\([^)]*\)/g,
      (match: string, label: string) =>
        "[" + label + "]" + "\u200b".repeat(match.length - label.length - 2),
    )
    .replace(/^\s*```[^\n]*$/gm, (match) => " ".repeat(match.length))
    .replace(/<\/?(?:p|div|br|li|h[1-6]|section)\b[^>]*>/gi, (match) =>
      " ".repeat(match.length),
    )
    .replace(/<[^>]+>/g, (match) => "\u200b".repeat(match.length))
    .replace(/[-\u2010\u2011]\r?\n(?=\p{L})/gu, (match) =>
      "\u200b".repeat(match.length),
    );
}
function append(
  index: IndexBuilder,
  text: string,
  from: number,
  to: number,
): number {
  let i = from;
  let output = "",
    hasText = index.text.length > 0,
    space = index.text.endsWith(" ");
  for (; i < to; i++) {
    let value = text[i],
      end = i + 1;
    if (value === "&") {
      const entity = text
        .slice(i, i + 16)
        .match(/^&(#x[\da-f]+|#\d+|[a-z]+);/i);
      if (entity) {
        const key = entity[1].toLowerCase();
        const code = key.startsWith("#x")
          ? parseInt(key.slice(2), 16)
          : key.startsWith("#")
            ? Number(key.slice(1))
            : NaN;
        const decoded =
          entities[key] ||
          (Number.isInteger(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : undefined);
        if (decoded) {
          value = decoded;
          end = i + entity[0].length;
        }
      }
    }
    if (
      ">#*_`[]".includes(value) ||
      /[\u00ad\u200b-\u200d\ufeff]/.test(value)
    ) {
      i = end - 1;
      continue;
    }
    value = value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[“”„«»]/g, '"')
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[‐‑–—−]/g, "-");
    for (let j = 0; j < value.length; j++) {
      const character = value[j];
      if (/\s/.test(character)) {
        if (hasText && !space) {
          output += " ";
          space = true;
          add(index, i, end);
        }
      } else {
        output += character;
        space = false;
        hasText = true;
        add(index, i, end);
      }
    }
    i = end - 1;
  }
  index.text += output;
  return i;
}
/** Normalized characters retain offsets into the original Markdown, including entities. */
export function normalizedText(text: string): QuoteIndex {
  const index = builder(),
    masked = maskedText(text);
  append(index, masked, 0, masked.length);
  return finish(index);
}
/** Yield between chunks so the first preparation of a large book does not block input. */
export async function prepareQuoteIndex(text: string): Promise<QuoteIndex> {
  const index = builder(),
    masked = maskedText(text);
  for (let from = 0; from < masked.length; ) {
    from = append(index, masked, from, Math.min(masked.length, from + 32_768));
    if (from < masked.length)
      await new Promise<void>((resolve) => startTimer(resolve, 0));
  }
  return finish(index);
}
function words(index: QuoteIndex): WordIndex {
  if (index.words) return index.words;
  const result: WordIndex = {
    text: "",
    starts: [],
    sourceStarts: [],
    sourceEnds: [],
  };
  for (const match of index.text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index || 0,
      word = match[0].replace(/ё/g, "е");
    result.starts.push(result.text.length);
    result.sourceStarts.push(index.offsets[start]);
    result.sourceEnds.push(index.ends[start + match[0].length - 1]);
    result.text += word + " ";
  }
  result.text = result.text.trimEnd();
  index.words = result;
  return result;
}
function wordAt(starts: number[], offset: number): number {
  let low = 0,
    high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
function matches(
  full: QuoteIndex,
  needle: QuoteIndex,
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  if (needle.text.length < 3) return result;
  let from = 0;
  while (from < full.text.length) {
    const index = full.text.indexOf(needle.text, from);
    if (index < 0) break;
    result.push({
      start: full.offsets[index],
      end: full.ends[index + needle.text.length - 1],
    });
    from = index + needle.text.length;
  }
  if (result.length) return result;
  // All words must still occur contiguously and in order. Never invent a match by
  // skipping words, and retain ambiguity when the same passage occurs twice.
  const query = words(needle);
  if (query.starts.length < 4 || query.text.length < 20) return result;
  const document = words(full);
  from = 0;
  while (from < document.text.length) {
    const index = document.text.indexOf(query.text, from);
    if (index < 0) break;
    const end = index + query.text.length;
    if (
      (index === 0 || document.text[index - 1] === " ") &&
      (end === document.text.length || document.text[end] === " ")
    )
      result.push({
        start: document.sourceStarts[wordAt(document.starts, index)],
        end: document.sourceEnds[wordAt(document.starts, end - 1)],
      });
    from = index + query.text.length;
  }
  return result;
}
/**
 * Highlights often contain formulas or figures that the book text keeps as images, so the
 * quote never occurs contiguously. Match its prose lines instead: the first and last
 * substantial lines must both be found, in order and close together.
 */
function segmentMatches(
  full: QuoteIndex,
  quote: string,
): Array<{ start: number; end: number }> {
  const found: Array<Array<{ start: number; end: number }>> = [];
  let total = 0;
  for (const line of quote.split(/\n+/)) {
    const needle = normalizedText(line);
    // Short lines are formulas, labels or captions: too weak to anchor anything.
    if (words(needle).starts.length < 4 || needle.text.length < 24) continue;
    total += needle.text.length;
    found.push(matches(full, needle));
  }
  if (!found.length) return [];
  if (found.length === 1)
    return found[0].length && total >= 48 ? found[0] : [];
  const first = found[0],
    last = found[found.length - 1];
  if (!first.length || !last.length) return [];
  const limit = quote.length * 3 + 4000,
    result: Array<{ start: number; end: number }> = [];
  for (const head of first) {
    const tail = last.find(
      (item) => item.start >= head.start && item.start - head.start < limit,
    );
    if (tail) result.push({ start: head.start, end: tail.end });
  }
  return result;
}
export function locateQuote(
  markdown: string,
  quote: string,
  nodePath: string,
  revision: string,
  previous?: SourceAnchor,
  prepared?: QuoteIndex,
): SourceAnchor {
  if (
    previous?.manual &&
    previous.quote === quote &&
    previous.revision === revision &&
    previous.start !== undefined &&
    previous.end !== undefined &&
    markdown.slice(previous.start, previous.end) === previous.selectedText
  )
    return previous;
  const manual = !!previous?.manual && previous.quote === quote;
  const full = prepared || normalizedText(markdown),
    needle = normalizedText((manual && previous?.selectedText) || quote);
  const images = manual ? [] : directImageMatches(markdown, quote);
  const candidates = images.length
    ? images.map(({ start, end }) => ({ start, end }))
    : matches(full, needle);
  if (!candidates.length && !manual) candidates.push(...segmentMatches(full, quote));
  const known =
    previous?.revision === revision && previous.quote === quote
      ? candidates.find((candidate) => candidate.start === previous.start)
      : undefined;
  const matched =
    known || (candidates.length === 1 ? candidates[0] : undefined);
  const history =
    previous && (previous.revision !== revision || previous.quote !== quote)
      ? [
          ...(previous.history || []),
          {
            revision: previous.revision,
            start: previous.start,
            end: previous.end,
            status: previous.status,
            quote: previous.quote,
          },
        ]
      : previous?.history;
  return {
    ...previous,
    id: previous?.id || crypto.randomUUID(),
    nodePath,
    quote,
    revision,
    history,
    manual,
    selectedText: manual ? previous?.selectedText : undefined,
    matcherVersion: QUOTE_MATCHER_VERSION,
    start: undefined,
    end: undefined,
    status: matched ? "matched" : candidates.length ? "ambiguous" : "missing",
    candidates,
    ...matched,
  };
}

/**
 * Anchors to save after a re-match, keeping what the reader placed by hand meanwhile: a
 * resolve that started before a note was written would otherwise drop the paragraph binding
 * saved right after it (notes made from the translation have no words to match in the
 * original). Hand-placed anchors of notes the pass did not see stay as long as the note exists.
 */
export function keepManualAnchors(
  computed: SourceAnchor[],
  saved: SourceAnchor[],
  revision: string,
  exists: (nodePath: string) => boolean,
): SourceAnchor[] {
  const placed = (anchor: SourceAnchor) =>
    !!anchor.manual &&
    anchor.revision === revision &&
    anchor.start !== undefined &&
    anchor.end !== undefined;
  const known = new Set(computed.map((anchor) => anchor.nodePath));
  const result = computed.map((anchor) => {
    if (anchor.manual) return anchor;
    const fresh = saved.find(
      (item) => item.nodePath === anchor.nodePath && item.quote === anchor.quote && placed(item),
    );
    return fresh ? { ...fresh, candidates: [...fresh.candidates] } : anchor;
  });
  for (const item of saved)
    if (!known.has(item.nodePath) && placed(item) && exists(item.nodePath)) result.push(item);
  return result;
}
