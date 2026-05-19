import type { App } from "obsidian";
import type { LocalBook, ReadingActivityDay } from "../models/store";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { toDateKey } from "../utils/date";
import { findBookNoteFile, findHighlightFilesForBook } from "./readwiseFiles";
import { buildPdfReadingActivity, extractHighlightDateKeysFromMarkdown } from "./readwisePdfTimeline";

export async function inferPdfReadingActivity(
  app: App,
  settings: ReadwiseTrackerSettings,
  book: LocalBook,
): Promise<Record<string, ReadingActivityDay> | null> {
  const bookFile = findBookNoteFile(app, settings, book);
  if (bookFile) {
    const markdown = await app.vault.cachedRead(bookFile);
    const dateKeys = extractHighlightDateKeysFromMarkdown(markdown);
    if (dateKeys.length > 0) {
      return buildPdfReadingActivity(book, dateKeys);
    }
  }

  const highlightFiles = findHighlightFilesForBook(app, settings, book);
  const dateKeys = highlightFiles
    .map((file) => {
      const cache = app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
      return typeof frontmatter?.date === "string" ? frontmatter.date : "";
    })
    .filter((date) => date.length > 0)
    .map((date) => toDateKey(date));

  if (dateKeys.length === 0) {
    return null;
  }

  return buildPdfReadingActivity(book, dateKeys);
}
