import { TFile, normalizePath, type App } from "obsidian";
import type { LocalBook } from "../models/store";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { currentSortLocale } from "../i18n";
export { normalizeCompactName, normalizeSearchName } from "./readwiseFileNames";
import { normalizeCompactName, normalizeSearchName } from "./readwiseFileNames";
import { isWorkspaceResource, isFullDocumentExport } from "../workspace/markdown";

export function getBooksRoot(settings: ReadwiseTrackerSettings): string {
  return normalizePath(String(settings.readwiseBooksFolder || "")).replace(/^\/+/, "").replace(/\/+$/, "");
}

export function getHighlightsRoot(settings: ReadwiseTrackerSettings): string {
  return normalizePath(String(settings.readwiseLinkedHighlightsFolder || "")).replace(/^\/+/, "").replace(/\/+$/, "");
}

function frontmatterOf(app: App, file: TFile): Record<string, unknown> | undefined {
  return app.metadataCache.getFileCache(file)?.frontmatter;
}

/** Files the book workspace writes next to the highlights; never book notes or highlights themselves. */
function isWorkspaceFile(app: App, file: TFile): boolean {
  return isWorkspaceResource(file.path, frontmatterOf(app, file));
}

export function getReadwiseBookFiles(app: App, settings: ReadwiseTrackerSettings): TFile[] {
  const booksRoot = getBooksRoot(settings);
  const booksPrefix = booksRoot ? `${booksRoot}/` : "";

  return app.vault
    .getMarkdownFiles()
    .filter((file) => (booksRoot ? file.path === booksRoot || file.path.startsWith(booksPrefix) : false))
    .filter((file) => {
      // Reader's "Full Document" exports live among the book notes but are not books.
      const cache = app.metadataCache.getFileCache(file);
      const headings = cache?.headings?.map((heading) => heading.heading) || [];
      return !isFullDocumentExport(headings, cache?.frontmatter);
    })
    .filter((file) => !isWorkspaceFile(app, file));
}

export function findBookNoteFile(
  app: App,
  settings: ReadwiseTrackerSettings,
  book: LocalBook,
): TFile | null {
  const booksFiles = getReadwiseBookFiles(app, settings);
  const readwiseId = String(book.readwise_id || book.id || "");

  // Several notes claiming the same book is ambiguity, not a match: the caller must not guess.
  const idMatches = booksFiles.filter((file) => {
    const frontmatter = frontmatterOf(app, file);
    const url = typeof frontmatter?.url === "string" ? frontmatter.url : "";
    return readwiseId && url.includes(readwiseId);
  });
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return null;

  const wanted = normalizeSearchName(book.title);
  const compactWanted = normalizeCompactName(book.title);
  const titleMatches = booksFiles.filter((file) => {
    const frontmatter = frontmatterOf(app, file);
    const title = typeof frontmatter?.title === "string" ? frontmatter.title : "";
    return (
      normalizeSearchName(title) === wanted ||
      normalizeSearchName(file.basename) === wanted ||
      normalizeCompactName(title) === compactWanted ||
      normalizeCompactName(file.basename) === compactWanted
    );
  });
  return titleMatches.length === 1 ? titleMatches[0] : null;
}

export function findHighlightFilesForBook(
  app: App,
  settings: ReadwiseTrackerSettings,
  book: LocalBook,
): TFile[] {
  const sortLocale = currentSortLocale();
  const root = getHighlightsRoot(settings);
  const bookFile = findBookNoteFile(app, settings, book);
  if (!bookFile) {
    // Two book notes with this title: a folder match could belong to either, so claim none.
    const title = normalizeCompactName(book.title);
    const possible = getReadwiseBookFiles(app, settings).filter((file) => {
      const frontmatter = frontmatterOf(app, file);
      const noteTitle = typeof frontmatter?.title === "string" ? frontmatter.title : file.basename;
      return normalizeCompactName(noteTitle) === title;
    });
    if (possible.length > 1) return [];
  }
  const preferredFolderName = bookFile?.basename || book.title;
  const folder = normalizePath(`${root}/${preferredFolderName}`);
  const prefix = `${folder}/`;
  const inPreferredFolder = app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(prefix))
    .filter((file) => !isWorkspaceFile(app, file))
    .sort((a, b) => a.basename.localeCompare(b.basename, sortLocale));

  if (inPreferredFolder.length > 0) {
    return inPreferredFolder;
  }

  const rootPrefix = root ? `${root}/` : "";
  const wanted = normalizeSearchName(book.title);
  const compactWanted = normalizeCompactName(book.title);
  return app.vault
    .getMarkdownFiles()
    .filter((file) => (root ? file.path.startsWith(rootPrefix) : false))
    .filter((file) => !isWorkspaceFile(app, file))
    .filter((file) => {
      const cache = app.metadataCache.getFileCache(file);
      const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
      const bookField = typeof frontmatter?.book === "string" ? frontmatter.book : "";
      const normalizedBook = normalizeSearchName(bookField.replace(/^\[\[|\]\]$/g, ""));
      if (normalizedBook && normalizedBook.includes(wanted)) {
        return true;
      }
      const compactBook = normalizeCompactName(bookField.replace(/^\[\[|\]\]$/g, ""));
      if (compactBook && compactBook.includes(compactWanted)) {
        return true;
      }
      return (
        normalizeSearchName(file.path).includes(wanted) ||
        normalizeCompactName(file.path).includes(compactWanted)
      );
    })
    .sort((a, b) => a.basename.localeCompare(b.basename, sortLocale));
}
