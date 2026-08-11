import type { LocalBook } from "../models/store";

export type WritableReaderLocation = "new" | "later" | "archive";

export function applyReaderLocation(
  book: LocalBook,
  location: WritableReaderLocation,
  updatedAt: string = book.updated_at,
): LocalBook {
  return {
    ...book,
    location,
    status: location === "archive" ? "completed" : location === "new" ? "reading" : "planned",
    updated_at: updatedAt,
  };
}

export function reconcilePendingReaderLocation(
  remoteBook: LocalBook,
  pendingLocation: WritableReaderLocation | undefined,
  localUpdatedAt?: string,
): { book: LocalBook; confirmed: boolean } {
  if (!pendingLocation) return { book: remoteBook, confirmed: false };
  if (remoteBook.location === pendingLocation) return { book: remoteBook, confirmed: true };
  return {
    book: applyReaderLocation(remoteBook, pendingLocation, localUpdatedAt || remoteBook.updated_at),
    confirmed: false,
  };
}
