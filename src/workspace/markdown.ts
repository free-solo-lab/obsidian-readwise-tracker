import { parse } from "yaml";
import { MANAGED_PATH } from "./layout";
import type { DialogMessage, WorkspaceNodeKind } from "./types";

export function pathJoin(...parts: string[]): string {
  return parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
/** The file name without folders and the `.md` extension. */
export function basename(path: string): string {
  return (path.split("/").pop() || path).replace(/\.md$/i, "");
}
/** Every line prefixed as a Markdown quote. */
export function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => "> " + line)
    .join("\n");
}
export function linkPath(link: string): string {
  return link
    .trim()
    .replace(/^!?(?:\[\[)/, "")
    .split("|")[0]
    .replace(/\]\]$/, "")
    .split("#")[0]
    .replace(/\.md$/i, "");
}
export function wiki(path: string, block?: string): string {
  return `[[${path.replace(/\.md(?=#|$)/i, "")}${block ? "#^" + block : ""}]]`;
}
export function stringList(value: unknown): string[] {
  return typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
}
export function parseMarkdown(raw: string): {
  metadata: Record<string, unknown>;
  body: string;
  header: string;
  malformed: boolean;
} {
  const match =
    raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/) ||
    raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: raw, header: "", malformed: false };
  try {
    // Older templates wrote unquoted wikilinks, which YAML interprets as nested
    // arrays. Read those scalars as Obsidian links while retaining the raw header.
    const yaml = match[1].replace(
      /^(\s*(?:[\w_]+:\s*|-\s*))(!?\[\[[^\n]+\]\])\s*$/gm,
      (_line: string, prefix: string, link: string) =>
        prefix + JSON.stringify(link),
    );
    const value: unknown = parse(yaml);
    return {
      metadata:
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {},
      body: raw.slice(match[0].length),
      header: match[0],
      malformed: false,
    };
  } catch {
    const metadata: Record<string, unknown> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([\w_]+):\s*(.*)$/);
      if (!field) continue;
      try {
        metadata[field[1]] = JSON.parse(field[2]) as unknown;
      } catch {
        metadata[field[1]] = field[2].replace(/^['"]|['"]$/g, "");
      }
    }
    return {
      metadata,
      body: raw.slice(match[0].length),
      header: match[0],
      malformed: true,
    };
  }
}
export function serializeMarkdown(
  metadata: Record<string, unknown>,
  body: string,
): string {
  return (
    "---\n" +
    Object.entries(metadata)
      .filter(([, v]) => v !== undefined)
      // Keys outside [\w-] (spaces, colons, #) must be quoted to stay valid YAML.
      .map(([k, v]) => `${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join("\n") +
    "\n---\n\n" +
    body.replace(/^\n+/, "")
  );
}
export function nodeKind(
  path: string,
  metadata: Record<string, unknown>,
): WorkspaceNodeKind | undefined {
  const kind = metadata.rwt_kind;
  if (
    kind === "thought" ||
    kind === "dialog" ||
    kind === "relation" ||
    kind === "highlight"
  )
    return kind;
  if (MANAGED_PATH.test(path)) return undefined;
  if (metadata.type === "inbox") return "thought";
  if (metadata.type === "highlight" || /\s[—–-]\s\d+\.md$/.test(path))
    return "highlight";
  return undefined;
}
export function isWorkspaceResource(
  path: string,
  metadata: Record<string, unknown> = {},
): boolean {
  return (
    MANAGED_PATH.test(path) ||
    ["source", "content", "chat", "thought", "dialog", "relation"].includes(
      String(metadata.rwt_kind || ""),
    ) ||
    metadata.type === "inbox"
  );
}

export function isFullDocumentExport(
  headings: string[],
  metadata: Record<string, unknown> = {},
): boolean {
  return (
    /^(?:Full Document|Полный текст)$/i.test(headings[0] || "") &&
    !headings.some((h) =>
      /^(?:Highlights|New highlights added|Выделения|Metadata)/i.test(h),
    ) &&
    typeof metadata.url !== "string"
  );
}
export function fileStem(body: string): string {
  const line =
    body
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.replace(/[#>*[\]`^]/g, "")
      .replace(/^_+|_+$/g, "")
      .replace(/[\\/:?"<>|]/g, " ")
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[\u0000-\u001f]/g, " ")
      .trim() || "";
  // Cut by code point so an emoji is never split into a lone surrogate.
  const stem = Array.from(line).slice(0, 72).join("").trim().replace(/[. ]+$/, "");
  if (!stem) return "Note";
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? "Note " + stem : stem;
}
export function serializeMessages(messages: DialogMessage[]): string {
  return messages
    .map(
      (m) =>
        `<!-- rwt-message ${JSON.stringify({ id: m.id, role: m.role, created: m.created, sources: m.sources, revision: m.revision, origin: m.origin }).replace(/-->/g, "\\u002d\\u002d\\u003e")} -->\n## ${m.role === "user" ? "User" : "Assistant"} · ${m.created}\n\n${m.content.trim().replace(/<!--(\s*\/?rwt-message)/g, "<!--\u200b$1")}\n\n<!-- rwt-message-sources -->\n${m.sources.map((source) => (source.startsWith("[[") ? source : wiki(source))).join(" · ")}\n\n^${m.id}\n<!-- /rwt-message -->`,
    )
    .join("\n\n");
}
export function parseMessages(body: string): DialogMessage[] {
  const messages: DialogMessage[] = [];
  const pattern =
    /<!-- rwt-message (.*?) -->\r?\n## [^\n]+\r?\n([\s\S]*?)<!-- \/rwt-message -->/g;
  for (const match of body.matchAll(pattern)) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      if (
        typeof data.id !== "string" ||
        !["user", "assistant"].includes(String(data.role))
      )
        continue;
      messages.push({
        id: data.id,
        role: data.role as "user" | "assistant",
        created: String(data.created || ""),
        sources: stringList(data.sources),
        revision: typeof data.revision === "string" ? data.revision : undefined,
        ...(typeof data.origin === "string" ? { origin: data.origin } : {}),
        content: match[2]
          .split("<!-- rwt-message-sources -->")[0]
          .replace(
            new RegExp(`\n\\^${data.id.replace(/[^\w-]/g, "")}\\s*$`),
            "",
          )
          .trim(),
      });
    } catch {
      /* Unknown/manual Markdown remains available in the original note. */
    }
  }
  return messages;
}
