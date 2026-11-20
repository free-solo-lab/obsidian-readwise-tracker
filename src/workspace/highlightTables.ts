import { normalizedText } from "./anchors";
import {
  markdownTable,
  standaloneTableText,
  type HighlightTable,
  type TableCell,
} from "./tables";

interface Span {
  start: number;
  end: number;
  kind: "html" | "markdown" | "code";
}
const delimiter = (line: string) => {
  const cells = splitRow(line);
  return (
    line.includes("|") &&
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
};
function splitRow(line: string): string[] {
  let value = line.trim().replace(/^\|/, "");
  if (value.endsWith("|")) {
    let escapes = 0;
    for (let at = value.length - 2; at >= 0 && value[at] === "\\"; at--)
      escapes++;
    if (escapes % 2 === 0) value = value.slice(0, -1);
  }
  const cells: string[] = [];
  let cell = "",
    escaped = false;
  for (const character of value) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
    escaped = character === "\\" && !escaped;
  }
  cells.push(cell.trim());
  return cells;
}
function spans(markdown: string): Span[] {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) || [],
    result: Span[] = [];
  let offset = 0,
    fence = "",
    codeStart = 0,
    depth = 0,
    htmlStart = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && !depth) {
      if (!fence) {
        fence = marker;
        codeStart = offset;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        result.push({
          start: codeStart,
          end: offset + line.length,
          kind: "code",
        });
        fence = "";
      }
    } else if (!fence) {
      for (const tag of line.matchAll(/<\/?table\b[^>]*>/gi)) {
        if (/^<\//.test(tag[0])) {
          if (depth && --depth === 0)
            result.push({
              start: htmlStart,
              end: offset + (tag.index || 0) + tag[0].length,
              kind: "html",
            });
        } else {
          if (!depth) htmlStart = offset + (tag.index || 0);
          depth++;
        }
      }
      if (!depth && line.includes("|") && delimiter(lines[index + 1] || "")) {
        const start = offset;
        offset += line.length + lines[++index].length;
        while (
          index + 1 < lines.length &&
          lines[index + 1].trim() &&
          splitRow(lines[index + 1]).length >= 2
        )
          offset += lines[++index].length;
        result.push({ start, end: offset, kind: "markdown" });
        continue;
      }
    }
    offset += line.length;
  }
  if (fence)
    result.push({ start: codeStart, end: markdown.length, kind: "code" });
  return result;
}

export function readHighlightTables(markdown: string): {
  tables: HighlightTable[];
  html: string[];
} {
  const tables: HighlightTable[] = [],
    html: string[] = [];
  for (const span of spans(markdown)) {
    const text = standaloneTableText(
      markdown.slice(span.start, span.end),
    ).trim();
    if (span.kind === "html") html.push(text);
    if (span.kind !== "markdown") continue;
    const lines = text.split("\n"),
      align = splitRow(lines[1]);
    const rows: TableCell[][] = [
      lines[0],
      ...lines.slice(2).filter((line) => line.trim()),
    ].map((line, index) =>
      splitRow(line).map((value, column) => ({
        text: value,
        header: index === 0,
        align: align[column]?.startsWith(":")
          ? align[column]?.endsWith(":")
            ? "center"
            : "left"
          : align[column]?.endsWith(":")
            ? "right"
            : undefined,
      })),
    );
    tables.push({
      text: rows
        .flat()
        .map((cell) => cell.text)
        .join("\n"),
      markdown: text,
      rows,
    });
  }
  return { tables, html };
}

const normalize = (text: string) =>
  normalizedText(text.replace(/\\\|/g, "|").replace(/<br\s*\/?\s*>/gi, " "))
    .text;
export function mayContainFlatTable(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length >= 4 && lines.filter((line) => line.length <= 100).length >= 3
  );
}

/** Compare all selected cells, never infer columns from names or numeric patterns. */
export class HighlightTableIndex {
  private tables: Array<{
    text: string;
    markdown: string;
    rows?: TableCell[][];
    rowText?: string[];
  }>;
  constructor(tables: HighlightTable[]) {
    this.tables = tables
      .filter((table) => !/!\[|<img\b/i.test(table.markdown))
      .map((table) => ({
        text: normalize(table.text),
        markdown: table.markdown,
        rows: table.rows,
        rowText: table.rows?.map((row) =>
          normalize(row.map((cell) => cell.text).join(" ")),
        ),
      }))
      .filter((table) => table.text.length >= 24);
  }
  format(quote: string): string {
    if (!mayContainFlatTable(quote) || !this.tables.length) return quote;
    const full = normalizedText(quote),
      protectedSpans = spans(quote);
    const matches: Array<{ start: number; end: number; markdown: string }> = [];
    const add = (needle: string, markdown: string, entire = false) => {
      if (needle.length < 24 || (entire && full.text !== needle)) return;
      for (let from = 0; from < full.text.length; ) {
        const at = full.text.indexOf(needle, from);
        if (at < 0) break;
        from = at + needle.length;
        if (
          /[\p{L}\p{N}]/u.test(full.text[at - 1] || "") ||
          /[\p{L}\p{N}]/u.test(full.text[from] || "")
        )
          continue;
        const start = full.offsets[at],
          end = full.ends[from - 1];
        if (protectedSpans.some((span) => start < span.end && end > span.start))
          continue;
        matches.push({ start, end, markdown });
      }
    };
    for (const table of this.tables) {
      if (
        table.rows &&
        (table.rows.length < 2 || table.rows.some((row) => row.length < 2))
      )
        continue;
      add(table.text, table.markdown);
      if (full.text.includes(table.text)) continue;
      if (!table.rows || !table.rowText || table.rows.length > 256) continue;
      for (let first = 0; first < table.rows.length - 1; first++) {
        if (!table.rowText[first] || !table.rowText[first + 1]) continue;
        const pair = table.rowText[first] + " " + table.rowText[first + 1];
        let at = full.text.indexOf(pair);
        while (at >= 0) {
          let last = first + 2,
            needle = pair;
          while (
            last < table.rows.length &&
            table.rowText[last] &&
            full.text.startsWith(needle + " " + table.rowText[last], at)
          )
            needle += " " + table.rowText[last++];
          add(needle, markdownTable(table.rows.slice(first, last)), true);
          at = full.text.indexOf(pair, at + pair.length);
        }
      }
    }
    const unique = matches.filter(
      (match, index) =>
        !matches.some(
          (other, otherIndex) =>
            otherIndex < index &&
            match.start === other.start &&
            match.end === other.end &&
            match.markdown === other.markdown,
        ),
    );
    const chosen = unique.filter(
      (match) =>
        !unique.some(
          (other) =>
            other !== match &&
            other.start <= match.start &&
            other.end >= match.end &&
            (other.start < match.start ||
              other.end > match.end ||
              other.markdown !== match.markdown),
        ),
    );
    let output = quote;
    for (const match of chosen.sort((a, b) => b.start - a.start)) {
      if (
        chosen.some(
          (other) =>
            other !== match &&
            match.start < other.end &&
            match.end > other.start,
        )
      )
        continue;
      const before = output.slice(0, match.start),
        after = output.slice(match.end);
      const prefix =
        before && !/\n\s*\n$/.test(before)
          ? before.endsWith("\n")
            ? "\n"
            : "\n\n"
          : "";
      const suffix =
        after && !/^\s*\n\s*\n/.test(after)
          ? after.startsWith("\n")
            ? "\n"
            : "\n\n"
          : "";
      output = before + prefix + match.markdown.trim() + suffix + after;
    }
    return output;
  }
}
