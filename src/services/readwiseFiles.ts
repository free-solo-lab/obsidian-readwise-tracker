import { TFile, normalizePath, type App } from "obsidian";
import type { LocalBook } from "../models/store";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { currentSortLocale } from "../i18n";

export function normalizeSearchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getBooksRoot(settings: ReadwiseTrackerSettings): string {
  return normalizePath(String(settings.readwiseBooksFolder || "")).replace(/^\/+/, "").replace(/\/+$/, "");
}

export function getHighlightsRoot(settings: ReadwiseTrackerSettings): string {
  return normalizePath(String(settings.readwiseLinkedHighlightsFolder || "")).replace(/^\/+/, "").replace(/\/+$/, "");
}

export function getReadwiseBookFiles(app: App, settings: ReadwiseTrackerSettings): TFile[] {
  const booksRoot = getBooksRoot(settings);
  const booksPrefix = booksRoot ? `${booksRoot}/` : "";

  return app.vault
    .getMarkdownFiles()
    .filter((file) => (booksRoot ? file.path === booksRoot || file.path.startsWith(booksPrefix) : false));
}

export function findBookNoteFile(
  app: App,
  settings: ReadwiseTrackerSettings,
  book: LocalBook,
): TFile | null {
  const booksFiles = getReadwiseBookFiles(app, settings);
  const readwiseId = String(book.readwise_id || book.id || "");

  for (const file of booksFiles) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const url = typeof frontmatter?.url === "string" ? frontmatter.url : "";
    if (readwiseId && url.includes(readwiseId)) {
      return file;
    }
  }

  const wanted = normalizeSearchName(book.title);
  for (const file of booksFiles) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const title = typeof frontmatter?.title === "string" ? frontmatter.title : "";
    if (normalizeSearchName(title) === wanted || normalizeSearchName(file.basename) === wanted) {
      return file;
    }
  }

  return null;
}

export function findHighlightFilesForBook(
  app: App,
  settings: ReadwiseTrackerSettings,
  book: LocalBook,
): TFile[] {
  const sortLocale = currentSortLocale();
  const root = getHighlightsRoot(settings);
  const bookFile = findBookNoteFile(app, settings, book);
  const preferredFolderName = bookFile?.basename || book.title;
  const folder = normalizePath(`${root}/${preferredFolderName}`);
  const prefix = `${folder}/`;
  const inPreferredFolder = app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(prefix))
    .sort((a, b) => a.basename.localeCompare(b.basename, sortLocale));

  if (inPreferredFolder.length > 0) {
    return inPreferredFolder;
  }

  const rootPrefix = root ? `${root}/` : "";
  const wanted = normalizeSearchName(book.title);
  return app.vault
    .getMarkdownFiles()
    .filter((file) => (root ? file.path.startsWith(rootPrefix) : false))
    .filter((file) => {
      const cache = app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
      const bookField = typeof frontmatter?.book === "string" ? frontmatter.book : "";
      const normalizedBook = normalizeSearchName(bookField.replace(/^\[\[|\]\]$/g, ""));
      if (normalizedBook && normalizedBook.includes(wanted)) {
        return true;
      }
      return normalizeSearchName(file.path).includes(wanted);
    })
    .sort((a, b) => a.basename.localeCompare(b.basename, sortLocale));
}
