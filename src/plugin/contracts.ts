import type { App, TFile } from "obsidian";
import type { DataManager } from "../services/dataManager";
import type { ReadwiseTrackerSettings } from "../settings/types";
import type { LocalBook } from "../models/store";
import type {
  ReadwiseSaveDocumentRequest,
  ReadwiseSaveDocumentResponse,
  ReadwiseUploadFileResponse,
} from "../models/readwise";

export interface CreateInboxNoteArgs {
  highlightFile: TFile;
  book: LocalBook;
  bookFile?: TFile | null;
}

export interface ReadwiseTrackerViewHost {
  app: App;
  settings: ReadwiseTrackerSettings;
  dataManager: DataManager;
  saveSettings(): Promise<void>;
  openBookHighlights(bookId: string): Promise<void>;
  getSelectedHighlightsBookId(): string | null;
  onSelectedHighlightsBookChange(listener: (bookId: string) => void): () => void;
  createInboxNoteFromHighlight(args: CreateInboxNoteArgs): Promise<TFile>;
  saveReaderDocument(document: ReadwiseSaveDocumentRequest): Promise<ReadwiseSaveDocumentResponse>;
  addReaderDocumentTags(documentId: string, tags: string[]): Promise<void>;
  moveReaderDocument(documentId: string, location: "new" | "later" | "archive"): Promise<void>;
  deleteReaderBook(documentId: string): Promise<void>;
  uploadReaderFile(fileName: string, contentType: string, body: ArrayBuffer, tags?: string[]): Promise<ReadwiseUploadFileResponse>;
  loginToReader(email: string, password: string): Promise<void>;
}
