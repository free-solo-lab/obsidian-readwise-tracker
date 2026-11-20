import type { LocalBook } from "../models/store";

/** The page of a document in Readwise Reader. */
export function readerDocumentUrl(documentId: string): string {
  return `https://read.readwise.io/read/${encodeURIComponent(documentId)}`;
}

export function readerBookUrl(book: Pick<LocalBook, "id" | "readwise_id">): string | null {
  const id = book.readwise_id?.trim() || book.id.trim();
  return id ? readerDocumentUrl(id) : null;
}
