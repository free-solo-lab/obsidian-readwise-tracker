import type { App, TFile } from "obsidian";
import type { DataManager } from "../services/dataManager";
import type { ReadwiseTrackerSettings } from "../settings/types";
import type { LocalBook } from "../models/store";

export interface CreateInboxNoteArgs {
  highlightFile: TFile;
  book: LocalBook;
  bookFile?: TFile | null;
}

export interface ReadwiseTrackerViewHost {
  app: App;
  settings: ReadwiseTrackerSettings;
  dataManager: DataManager;
  createInboxNoteFromHighlight(args: CreateInboxNoteArgs): Promise<TFile>;
}
