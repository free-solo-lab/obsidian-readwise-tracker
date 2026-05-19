import { translate, type SupportedLocale } from "../i18n/messages";

export interface ParsedHighlightNote {
  quote: string;
  description: string;
}

export interface ParsedReadwiseHighlight {
  text: string;
  comment: string;
  date: string;
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
    if (/^##\s+/.test(line) || line.trim() === "---") {
      break;
    }
    descriptionBuffer.push(line);
    index += 1;
  }

  return {
    quote,
    description: descriptionBuffer.join("\n").trim(),
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

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.startsWith(">>")) {
        const text = line.replace(/^>>\s*/, "").trim();
        if (text) {
          commentLines.push(text);
        }
        continue;
      }

      if (line.startsWith(">") && !line.startsWith(">>")) {
        const text = line.replace(/^>\s*/, "").trimEnd();
        if (text) {
          quoteLines.push(text);
        }
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
}): string {
  const prevLink =
    params.index > 1 ? `[[${params.bookTitle} — ${String(params.index - 1).padStart(3, "0")}]]` : "";
  const nextLink =
    params.index < params.total
      ? `[[${params.bookTitle} — ${String(params.index + 1).padStart(3, "0")}]]`
      : "";
  const titleRaw = (params.comment || params.text.slice(0, 50)).trim();
  const title = titleRaw.replace(/\r?\n/g, " ").slice(0, 200);
  const quote = params.text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => `> ${line}`)
    .join("\n");

  let content =
    "---\n" +
    "type: highlight\n" +
    `book: [[${params.bookTitle}]]\n` +
    `index: ${params.index}\n` +
    `date: ${params.date}\n` +
    `title: ${title}\n` +
    "---\n\n" +
    `${quote}\n`;

  if (params.comment) {
    content += "\n\n";
    content += `${params.comment}\n\n`;
    content += `## ${translate(params.locale || "ru", "note.links")}\n`;
    if (prevLink) {
      content += `← ${prevLink}\n`;
    }
    if (nextLink) {
      content += `→ ${nextLink}\n`;
    }
    content += `[[${params.bookTitle}]]\n`;
  }

  return content.trim();
}
