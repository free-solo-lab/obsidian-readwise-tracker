import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { LocalBook } from "../models/store";
import type { ReadwiseDocument } from "../models/readwise";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { toDateKey } from "../utils/date";
import { DataManager } from "./dataManager";
import { isPdfDocument, isTopLevelReadingDocument, getDocumentTitle } from "./readwiseDocuments";
import { ReadwiseService } from "./readwise";
import { inferPdfReadingActivity } from "./readwisePdfActivity";
import { createRegularSyncPlan, type ReadwiseSyncRequest } from "./readwiseSyncPlan";
import { t } from "../i18n";

export class ReadwiseSyncService {
  constructor(
    private readonly readwiseService: ReadwiseService,
    private readonly dataManager: DataManager,
    private readonly app: App,
    private readonly getSettings: () => ReadwiseTrackerSettings,
  ) {}

  async sync(debugLogging: boolean, options?: { silent?: boolean }): Promise<void> {
    await this.readwiseService.validateToken();

    const plan = createRegularSyncPlan(
      this.dataManager.getData().lastSync,
      this.getSettings().syncLocations,
    );
    const documents = await this.fetchDocuments(plan.requests);

    if (debugLogging) {
      console.log("[Readwise] sync mode", plan.mode);
    }
    await this.applyDocuments(documents, debugLogging, options);
  }

  async syncFullHistory(debugLogging: boolean, options?: { silent?: boolean }): Promise<void> {
    await this.readwiseService.validateToken();
    const documents = await this.readwiseService.getAllDocuments();
    await this.applyDocuments(documents, debugLogging, options);
  }

  private async fetchDocuments(requests: ReadwiseSyncRequest[]): Promise<ReadwiseDocument[]> {
    const documents: ReadwiseDocument[] = [];
    const seenIds = new Set<string>();

    for (const request of requests) {
      const part = await this.readwiseService.getAllDocuments(
        request.location,
        undefined,
        request.updatedAfter,
      );
      for (const document of part) {
        if (!seenIds.has(document.id)) {
          seenIds.add(document.id);
          documents.push(document);
        }
      }
    }

    return documents;
  }

  private async applyDocuments(
    documents: ReadwiseDocument[],
    debugLogging: boolean,
    options?: { silent?: boolean },
  ): Promise<void> {
    const filteredDocuments = documents.filter(isTopLevelReadingDocument);
    if (debugLogging) {
      console.log("[Readwise] fetched documents", documents.length);
      console.log("[Readwise] filtered documents", filteredDocuments.length);
      if (documents.length > 0) {
        console.log("[Readwise] sample document", documents[0]);
      }
      if (filteredDocuments.length > 0) {
        console.log("[Readwise] sample filtered document", filteredDocuments[0]);
      }
    }

    let newCount = 0;
    let updateCount = 0;
    const data = this.dataManager.getData();

    for (const document of filteredDocuments) {
      const existingBook = data.books[document.id];
      const book = this.toLocalBook(document);
      let pdfTimelineRebuilt = false;

      if (isPdfDocument(document)) {
        const inferredActivity = await inferPdfReadingActivity(this.app, this.getSettings(), book);
        if (inferredActivity && Object.keys(inferredActivity).length > 0) {
          this.dataManager.replaceBookReadingActivity(book.id, inferredActivity);
          pdfTimelineRebuilt = true;
        }
      }

      if (!existingBook) {
        newCount += 1;
        if (!pdfTimelineRebuilt) {
          this.trackProgressDelta(book, book.reading_progress);
        }
      } else {
        updateCount += 1;
        if (!pdfTimelineRebuilt) {
          this.trackProgressDelta(book, book.reading_progress - clampProgress(existingBook.reading_progress));
        }
      }

      this.dataManager.saveBook(book);
    }

    this.dataManager.updateLastSync();
    if (!options?.silent) {
      new Notice(t("notice.syncComplete", { newCount, updateCount }));
    }
  }

  private toLocalBook(document: ReadwiseDocument): LocalBook {
    const tags =
      document.tags && typeof document.tags === "object"
        ? Object.keys(document.tags).filter((tag) => typeof tag === "string" && tag.trim().length > 0)
        : undefined;

    const readingProgress = clampProgress((document.reading_progress || 0) * 100);
    return {
      id: document.id,
      title: getDocumentTitle(document),
      author: document.author || "",
      category: document.category || "reader",
      source: "readwise",
      readwise_id: document.id,
      tags,
      created_at: document.created_at || new Date().toISOString(),
      updated_at: document.updated_at || new Date().toISOString(),
      cover_url: document.image_url,
      reading_progress: readingProgress,
      words_count: document.word_count,
      notes_count: document.num_highlights || 0,
      location: document.location as LocalBook["location"],
      status:
        document.location === "archive"
          ? "completed"
          : readingProgress > 0
            ? "reading"
            : "planned",
    };
  }

  private trackProgressDelta(book: LocalBook, progressDelta: number): void {
    const delta = clampProgress(progressDelta);
    if (delta <= 0.01) {
      return;
    }

    const dateKey = toDateKey(book.updated_at);
    const totalWords = Math.max(0, book.words_count || 0);
    if (totalWords > 0) {
      const deltaWords = (totalWords * delta) / 100;
      this.dataManager.addReadingActivity(
        dateKey,
        {
          words: deltaWords,
          minutes: deltaWords / 200,
          progressPoints: delta,
          events: 1,
        },
        book.id,
      );
      return;
    }

    this.dataManager.addReadingActivity(
      dateKey,
      {
        progressPoints: delta,
        events: 1,
      },
      book.id,
    );
  }
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, value || 0));
}
