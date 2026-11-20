import type { LocalBook } from "../models/store";

export type BookArchiveFilter = "all" | "active" | "archive";

/** A book lives in the archive when Reader archived it or the tracker marked it completed. */
export function isArchivedBook(book: Pick<LocalBook, "location" | "status">): boolean {
  return book.location === "archive" || book.status === "completed";
}

export function matchesArchiveFilter(
  book: Pick<LocalBook, "location" | "status">,
  filter: BookArchiveFilter,
): boolean {
  if (filter === "all") return true;
  return isArchivedBook(book) === (filter === "archive");
}
