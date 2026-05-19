import type { ReadwiseDocument } from "../models/readwise";

export function getDocumentTitle(doc: ReadwiseDocument): string {
  const candidates: unknown[] = [doc.title, doc.readable_title, doc.site_name];
  for (const value of candidates) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const sourceUrl = typeof doc.source_url === "string" ? doc.source_url.trim() : "";
  if (!sourceUrl) {
    return "";
  }

  try {
    const url = new URL(sourceUrl);
    return url.hostname || sourceUrl;
  } catch {
    return sourceUrl;
  }
}

export function isTopLevelReadingDocument(doc: ReadwiseDocument): boolean {
  const category = typeof doc.category === "string" ? doc.category.toLowerCase() : "";
  if (category === "highlight" || category === "note") {
    return false;
  }

  if (doc.parent_id) {
    return false;
  }

  const title = getDocumentTitle(doc);
  if (!title) {
    return false;
  }

  return title.toLowerCase() !== "readwise & reader changelog";
}

export function isPdfDocument(doc: ReadwiseDocument): boolean {
  const category = typeof doc.category === "string" ? doc.category.toLowerCase() : "";
  const source = typeof doc.source === "string" ? doc.source.toLowerCase() : "";
  const title = getDocumentTitle(doc).toLowerCase();
  const urls = [doc.url, doc.source_url]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  if (category.includes("pdf") || source.includes("pdf")) {
    return true;
  }

  if (title.endsWith(".pdf")) {
    return true;
  }

  return urls.some((value) => value.includes(".pdf"));
}
