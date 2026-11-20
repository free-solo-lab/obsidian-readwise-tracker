import { translate, type SupportedLocale } from "../i18n/messages";

export interface ParsedHighlightNote {
  quote: string;
  description: string;
}

export interface ParsedReadwiseHighlight {
  text: string;
  comment: string;
  date: string;
  sourceUrl?: string;
  readerHighlightId?: string;
  readerOffset?: number;
  readerLocation?: string;
}

export function parseHighlightNote(text: string): ParsedHighlightNote {
  const lines = text.split(/\r?\n/);
  let index = 0;
  if (lines[index] === "---") {
    index += 1;
    while (index < lines.length && lines[index] !== "---") {
      index += 1;
    }
    if (index < lines.length && lines[index] === "---") {
      index += 1;
    }
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  let quote = "";
  if (index < lines.length && lines[index].trim().startsWith(">")) {
    const buffer: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith(">")) {
      buffer.push(lines[index].replace(/^\s*>\s?/, ""));
      index += 1;
    }
    quote = buffer.join("\n").trim();
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  const descriptionBuffer: string[] = [];
  while (index < lines.length) {
    const line = lines[index];
    if (/^##\s+(?:Links|Связи)\s*$/i.test(line) || line.trim() === "---") {
      break;
    }
    descriptionBuffer.push(line);
    index += 1;
  }

  let description = descriptionBuffer.join("\n").trim();
  // Older migrations classified a single-quoted AI answer as part of the quote.
  if (/^q:\s/i.test(description)) {
    const answer = quote.search(/^a:\s/im);
    if (answer >= 0) {
      description += `\n${quote.slice(answer)}`;
      quote = quote.slice(0, answer).trim();
    }
  }
  return { quote, description };
}

/** Replace only the reader's comment of a highlight body; the quote and the Links section stay as they are. */
export function withHighlightComment(body: string, comment: string): string {
  const lines = body.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  const head: string[] = [];
  while (index < lines.length && lines[index].trim().startsWith(">")) {
    head.push(lines[index]);
    index += 1;
  }
  while (index < lines.length) {
    const line = lines[index];
    if (/^##\s+(?:Links|Связи)\s*$/i.test(line) || line.trim() === "---") break;
    index += 1;
  }
  const tail = lines.slice(index).join("\n").trim();
  return (
    [head.join("\n"), comment.trim(), tail].filter(Boolean).join("\n\n") + "\n"
  );
}

/** Where the highlight lives in Reader, as far as the export block says: link, highlight id, location. */
function readerHints(block: string): Pick<
  ParsedReadwiseHighlight,
  "sourceUrl" | "readerHighlightId" | "readerOffset" | "readerLocation"
> {
  const sourceUrl = block.match(/https:\/\/(?:read\.readwise\.io|readwise\.io)\/[^\s)>]+/)?.[0];
  const readerHighlightId = sourceUrl?.match(/(?:#highlight-|highlight=|#)([\w-]+)/)?.[1];
  const readerLocation = block.match(/📍\s*(.+)/)?.[1]?.trim();
  const offset = readerLocation?.match(/(?:location|позици[яи]|offset)\s*:?\s*(\d+)/i)?.[1];
  return {
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(readerHighlightId ? { readerHighlightId } : {}),
    ...(offset ? { readerOffset: Number(offset) } : {}),
    ...(readerLocation ? { readerLocation } : {}),
  };
}

export function parseReadwiseHighlightsFromMarkdown(markdown: string): ParsedReadwiseHighlight[] {
  const split = markdown.split("## Highlights");
  if (split.length < 2) {
    throw new Error("Не найден раздел ## Highlights");
  }

  const blocks = split[1].split(/\r?\n---\r?\n/);
  const highlights: ParsedReadwiseHighlight[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const quoteLines: string[] = [];
    const commentLines: string[] = [];

    let section: "quote" | "comment" | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      // Metadata lines (date, tags, link, location) and headings end the current section.
      if (/^\s*(?:📅|🏷|🔗|📍|##\s)/u.test(line)) {
        section = null;
        continue;
      }
      if (/^\s*>>/.test(line)) {
        section = "comment";
        commentLines.push(line.replace(/^\s*>>\s?/, ""));
      } else if (/^\s*>/.test(line)) {
        if (section !== "comment") section = "quote";
        (section === "comment" ? commentLines : quoteLines).push(line.replace(/^\s*>\s?/, ""));
      } else if (section) {
        // Reader exports prefix only the first line of some multi-line highlights/notes.
        (section === "comment" ? commentLines : quoteLines).push(line);
      }
    }

    if (quoteLines.length === 0) {
      continue;
    }

    const dateMatch = block.match(/📅\s*\*?(\d{4}-\d{2}-\d{2}),\s*([0-2]\d:[0-5]\d)\*?/);
    const date = dateMatch ? `${dateMatch[1]}T${dateMatch[2]}:00` : "";

    highlights.push({
      text: quoteLines.join("\n").trim(),
      comment: commentLines.join("\n").trim(),
      date,
      ...readerHints(block),
    });
  }

  return highlights;
}

export function buildLinkedHighlightNoteContent(params: {
  bookTitle: string;
  index: number;
  total: number;
  text: string;
  comment: string;
  date: string;
  locale?: SupportedLocale;
  titleText?: string;
  sourceUrl?: string;
  readerHighlightId?: string;
  readerOffset?: number;
  readerLocation?: string;
}): string {
  const prevLink =
    params.index > 1 ? `[[${params.bookTitle} — ${String(params.index - 1).padStart(3, "0")}]]` : "";
  const nextLink =
    params.index < params.total
      ? `[[${params.bookTitle} — ${String(params.index + 1).padStart(3, "0")}]]`
      : "";
  const locale = params.locale || "ru";
  // An image-only highlight has no words for a title; say what it is instead.
  const titleRaw =
    (params.comment || params.titleText || params.text)
      .replace(/!\[[^\]]*\]\([^\n]*?\)/g, "")
      .replace(/<img\b[^>]*>/gi, "")
      .trim() || translate(locale, "note.imageHighlight");
  const title = titleRaw.replace(/\s+/g, " ").slice(0, 200);
  const quote = params.text
    .split("\n")
    .map((line) => `> ${line.trimEnd()}`)
    .join("\n");

  // String values are JSON-quoted so titles with colons or wikilinks stay valid YAML.
  const properties: Array<[string, string | number | undefined]> = [
    ["type", "highlight"],
    ["book", JSON.stringify(`[[${params.bookTitle}]]`)],
    ["index", params.index],
    ["date", JSON.stringify(params.date)],
    ["title", JSON.stringify(title)],
    ["rwt_source_url", params.sourceUrl && JSON.stringify(params.sourceUrl)],
    ["rwt_reader_highlight_id", params.readerHighlightId && JSON.stringify(params.readerHighlightId)],
    ["rwt_reader_offset", params.readerOffset],
    ["rwt_reader_location", params.readerLocation && JSON.stringify(params.readerLocation)],
  ];
  let content =
    "---\n" +
    properties
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${key}: ${value}\n`)
      .join("") +
    "---\n\n" +
    `${quote}\n`;

  if (params.comment) content += `\n\n${params.comment}\n`;
  content += `\n## ${translate(locale, "note.links")}\n`;
  if (prevLink) content += `← ${prevLink}\n`;
  if (nextLink) content += `→ ${nextLink}\n`;
  content += `[[${params.bookTitle}]]\n`;

  return content.trim();
}
