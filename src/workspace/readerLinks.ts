/** Codex is asked to end an answer with one `rwt-reader: <id>` line per document it saved to Reader. */
export const READER_MARKER = "rwt-reader:";
const MARKER = /^[ \t>*_`-]*rwt-reader:[ \t]*(\S+?)[ \t`*_]*$/gim;
const FROM_URL = /read\.readwise\.io\/(?:read|new\/read)\/([A-Za-z0-9]+)/;
export function readerId(value: string): string | undefined {
  const cleaned = value.replace(/^[<([]+|[>)\].,;]+$/g, "");
  const url = FROM_URL.exec(cleaned);
  if (url) return url[1];
  return /^[A-Za-z0-9]{10,40}$/.test(cleaned) ? cleaned : undefined;
}
/** The visible answer without marker lines, and the Reader document ids they named. */
export function takeReaderIds(text: string): { text: string; ids: string[] } {
  const ids: string[] = [];
  const clean = text
    .replace(MARKER, (_line, value: string) => {
      const id = readerId(value);
      if (id && !ids.includes(id)) ids.push(id);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, ids };
}
/** Reader links in an answer, for when Codex saved a document but left out the marker line. */
export function readerLinkIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(
    /read\.readwise\.io\/(?:read|new\/read)\/([A-Za-z0-9]{10,40})/g,
  ))
    if (!ids.includes(match[1])) ids.push(match[1]);
  return ids;
}
/** Only a request to save something may turn links into notes: a search result lists many documents. */
export const SAVE_REQUEST = /загруз|сохран|добав|импорт|\b(save|upload|import|add)\b/i;
