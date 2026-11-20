import type { WorkspaceNode } from "./types";

export type WorkspacePanel =
  | "source"
  | "highlights"
  | "thought"
  | "dialog"
  | "relation";
/** Only actual input can take ownership. Scroll events from followers never feed back. */
export class WorkspaceFocus {
  owner: WorkspacePanel | null = "highlights";
  /** Counts real input; zero means the reader has not touched anything since opening. */
  touches = 0;
  lead(panel: WorkspacePanel | null): void {
    this.touches++;
    this.owner = panel;
  }
  accepts(panel: WorkspacePanel): boolean {
    return this.owner === panel;
  }
}
export function nearestSource(
  current: string | undefined,
  sources: string[],
  ordered: string[] | ReadonlyMap<string, number>,
): string | undefined {
  const index: ReadonlyMap<string, number> = Array.isArray(ordered)
    ? new Map<string, number>(ordered.map((path, i) => [path, i]))
    : ordered;
  const candidates = sources.filter((path) => index.has(path));
  if (current && candidates.includes(current)) return current;
  const position = (current && index.get(current)) || 0;
  return candidates.sort(
    (a, b) =>
      Math.abs((index.get(a) as number) - position) -
      Math.abs((index.get(b) as number) - position),
  )[0];
}
export function relatedNode(
  current: string | undefined,
  highlight: string | undefined,
  nodes: WorkspaceNode[],
  sources: (node: WorkspaceNode) => string[],
): string | undefined {
  const candidates = nodes.filter(
    (node) => !!highlight && sources(node).includes(highlight),
  );
  return (
    candidates.find((node) => node.path === current)?.path ||
    candidates[0]?.path
  );
}
export interface TextBlock {
  key: string;
  text: string;
  start: number;
  end: number;
}
export function textBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let start = 0,
    fenced = false,
    htmlTableDepth = 0,
    pipeTable = false;
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) || [];
  let offset = 0;
  const delimiter = (line = "") => {
    const value = line.trim();
    return (
      value.includes("|") &&
      value
        .replace(/^\||\|$/g, "")
        .split("|")
        .every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
    );
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced) {
      htmlTableDepth +=
        (line.match(/<table\b/gi)?.length || 0) -
        (line.match(/<\/table\s*>/gi)?.length || 0);
      htmlTableDepth = Math.max(0, htmlTableDepth);
      if (line.includes("|") && delimiter(lines[index + 1])) pipeTable = true;
      else if (pipeTable && !line.includes("|")) pipeTable = false;
    }
    offset += line.length;
    if (
      !fenced &&
      !htmlTableDepth &&
      !pipeTable &&
      (!line.trim() || offset - start > 5000)
    ) {
      if (markdown.slice(start, offset).trim())
        blocks.push({
          key: String(start),
          text: markdown.slice(start, offset),
          start,
          end: offset,
        });
      start = offset;
    }
  }
  if (markdown.slice(start).trim())
    blocks.push({
      key: String(start),
      text: markdown.slice(start),
      start,
      end: markdown.length,
    });
  return blocks;
}
/** "075" for an imported highlight, "075+" for a note inserted after it. */
export function highlightLabel(node: { order?: number; index?: number }): string {
  const order = node.order ?? node.index;
  if (!order) return "";
  const whole = String(Math.floor(order)).padStart(3, "0");
  return Number.isInteger(order) ? whole : whole + "+";
}
