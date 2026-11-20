export interface HighlightMetadata {
  title: string;
  index: number | undefined;
  date: string;
  dateTs: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** A YAML scalar as older templates wrote it: JSON-quoted, single-quoted or bare. */
function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* legacy unquoted title */
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function positiveInteger(value: unknown): number | undefined {
  const number =
    typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/**
 * Title, index and date of a highlight note. Obsidian's cached frontmatter is preferred;
 * when a malformed header left the cache empty, the raw header is read field by field,
 * and the index falls back to the number at the end of the file name.
 */
export function readHighlightMetadata(
  basename: string,
  frontmatter?: Record<string, unknown>,
  markdown = "",
): HighlightMetadata {
  const header = markdown.replace(/^\uFEFF/, "").match(FRONTMATTER)?.[1] ?? "";
  const field = (name: string) =>
    scalar(header.match(new RegExp(`^${name}: *(.*)$`, "m"))?.[1] ?? "");

  const index =
    positiveInteger(frontmatter?.index ?? field("index")) ??
    positiveInteger(basename.match(/(?:—|–|-)\s*(\d+)$/)?.[1]);

  const rawTitle = typeof frontmatter?.title === "string" ? frontmatter.title : field("title");
  const title = rawTitle && !/^!\[|^<img\b/i.test(rawTitle) ? rawTitle : basename;

  const date = typeof frontmatter?.date === "string" ? frontmatter.date : field("date");
  return { title, index, date, dateTs: date ? new Date(date).getTime() : NaN };
}
