export const TABLE_FORMAT_VERSION = 1;
export interface TableCell {
  text: string;
  header?: boolean;
  align?: string;
}
export interface PreparedTable {
  legacy: string;
  markdown: string;
  highlight?: HighlightTable;
}
export interface HighlightTable {
  text: string;
  markdown: string;
  rows?: TableCell[][];
}
/** Virtual blocks have no surrounding list, so table indentation is presentation only. */
export function standaloneTableText(text: string): string {
  const lines = text.split("\n"),
    first = lines.findIndex((line) => !!line.trim());
  if (first < 0) return text;
  const indent = lines[first].match(/^ {4,}/)?.[0];
  if (!indent || !/^<table\b|^\|/.test(lines[first].trimStart())) return text;
  return lines
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join("\n");
}

/** GFM needs a header, including for a table whose first row contains data. */
export function markdownTable(rows: TableCell[][]): string {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (!columns) return "";
  const cell = (value = "") =>
    value.trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const line = (row: TableCell[]) =>
    "| " +
    Array.from({ length: columns }, (_, index) => cell(row[index]?.text)).join(
      " | ",
    ) +
    " |";
  const hasHeader = rows[0].every((item) => item.header);
  const alignments = Array.from({ length: columns }, (_, index) => {
    const align = rows.find((row) => row[index]?.align)?.[index]?.align;
    return align === "center"
      ? ":---:"
      : align === "right"
        ? "---:"
        : align === "left"
          ? ":---"
          : "---";
  });
  return [
    line(hasHeader ? rows[0] : []),
    "| " + alignments.join(" | ") + " |",
    ...rows.slice(hasHeader ? 1 : 0).map(line),
  ].join("\n");
}

/** Repair only exact, unique legacy table blocks. Keep edits and surrounding text. */
export function applyTableRepairs(
  markdown: string,
  tables: PreparedTable[],
): { markdown: string; count: number } {
  const patches: Array<{ start: number; end: number; text: string }> = [];
  for (const table of tables) {
    const old = table.legacy.trim();
    if (!old || old === table.markdown.trim()) continue;
    const variants = [
      { old, text: table.markdown.trim() },
      {
        old: old
          .split("\n")
          .map((line) => "    " + line)
          .join("\n"),
        text: table.markdown
          .trim()
          .split("\n")
          .map((line) => "    " + line)
          .join("\n"),
      },
    ];
    const found = variants
      .map((variant) => ({ ...variant, start: markdown.indexOf(variant.old) }))
      .filter((variant) => variant.start >= 0);
    if (found.length !== 1) continue;
    const match = found[0],
      start = match.start,
      end = start + match.old.length;
    if (markdown.indexOf(match.old, start + 1) >= 0) continue;
    if (
      start > 0 &&
      !/\n\s*\n$/.test(markdown.slice(Math.max(0, start - 256), start)) &&
      markdown.slice(0, start).trim()
    )
      continue;
    if (
      end < markdown.length &&
      !/^\s*\n\s*\n/.test(markdown.slice(end, end + 256)) &&
      markdown.slice(end).trim()
    )
      continue;
    if (patches.some((patch) => start < patch.end && end > patch.start))
      continue;
    patches.push({ start, end, text: match.text });
  }
  let result = markdown;
  for (const patch of patches.sort((a, b) => b.start - a.start))
    result =
      result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  return { markdown: result, count: patches.length };
}
