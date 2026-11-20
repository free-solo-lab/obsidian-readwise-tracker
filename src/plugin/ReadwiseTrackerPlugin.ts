import { Notice, Plugin, type TFile } from "obsidian";
import { registerCommands } from "../commands/registerCommands";
import { DataManager } from "../services/dataManager";
import { applyReaderLocation } from "../services/readerLocation";
import { ReadwiseNoteService } from "../services/readwiseNoteService";
import { ReaderAuthenticationError, ReadwiseService } from "../services/readwise";
import { ReadwiseOfficialSyncService } from "../services/ReadwiseOfficialSyncService";
import { ReadwiseSyncService } from "../services/ReadwiseSyncService";
import { ReadwiseTrackerSettingTab } from "../settings/ReadwiseTrackerSettingTab";
import { loadPluginSettings, savePluginSettings } from "../settings/persistence";
import type { ReadwiseTrackerSettings } from "../settings/types";
import type {
  ReadwiseSaveDocumentRequest,
  ReadwiseSaveDocumentResponse,
  ReadwiseUploadFileResponse,
} from "../models/readwise";
import { DashboardView } from "../ui/DashboardView";
import { StatsView } from "../ui/StatsView";
import { t } from "../i18n";
import { AUTO_SYNC_CHECK_INTERVAL_MS, isAutoSyncDue } from "./autoSync";
import { DASHBOARD_VIEW_TYPE, STATS_VIEW_TYPE, activateReadwiseView } from "./workspace";
import type { CreateInboxNoteArgs } from "./contracts";
import { BookWorkspaceService } from "../workspace/service";
import { BOOK_WORKSPACE_VIEW, BookWorkspaceView } from "../workspace/BookWorkspaceView";
import { readerDocumentUrl } from "../services/readerBookUrl";
import { errorMessage, toError } from "../utils/errors";

interface SyncOptions {
  silent?: boolean;
  fullHistory?: boolean;
  /** Reject instead of showing a notice, for callers that handle the failure themselves. */
  throwOnError?: boolean;
}

const TOKEN_MISSING = "Readwise API token is not set.";

export class ReadwiseTrackerPlugin extends Plugin {
  settings!: ReadwiseTrackerSettings;
  dataManager!: DataManager;
  readwiseService!: ReadwiseService;
  workspaceService!: BookWorkspaceService;

  private officialSyncService!: ReadwiseOfficialSyncService;
  private syncService!: ReadwiseSyncService;
  private noteService!: ReadwiseNoteService;
  private syncInFlight: Promise<void> | null = null;
  private lastSyncError: unknown;
  private selectedHighlightsBookId: string | null = null;
  private selectedHighlightsBookListeners = new Set<(bookId: string) => void>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.dataManager = new DataManager(this);
    await this.dataManager.loadData();

    this.readwiseService = new ReadwiseService(this.settings.readwiseToken);
    this.readwiseService.setDebug(this.settings.debugLogging);
    this.readwiseService.setRequestDelayMs(this.settings.requestDelayMs);
    this.readwiseService.setMaxRetries(this.settings.maxRetries);
    this.officialSyncService = new ReadwiseOfficialSyncService(this.app);
    this.syncService = new ReadwiseSyncService(this.readwiseService, this.dataManager, this.app, () => this.settings);
    this.workspaceService = new BookWorkspaceService(
      this,
      () => this.settings,
      this.dataManager,
      this.readwiseService,
      () => this.syncReadwiseData({ silent: true, throwOnError: true }),
    );
    this.noteService = new ReadwiseNoteService(this.app, (context, quotes) =>
      this.workspaceService.formatHighlightQuotes(context, quotes),
    );

    this.registerView(STATS_VIEW_TYPE, (leaf) => new StatsView(leaf, this));
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(BOOK_WORKSPACE_VIEW, (leaf) => new BookWorkspaceView(leaf, this));

    this.addSettingTab(new ReadwiseTrackerSettingTab(this.app, this));
    registerCommands(this);
    this.configureAutoSync();
  }

  async activateView(viewType: string): Promise<void> {
    await activateReadwiseView(this.app.workspace, viewType);
  }

  async openBookHighlights(bookId: string): Promise<void> {
    this.selectedHighlightsBookId = bookId;
    await this.activateView(STATS_VIEW_TYPE);
    for (const listener of this.selectedHighlightsBookListeners) {
      listener(bookId);
    }
  }

  /** One workspace leaf is reused; it opens next to the active tab when there is none yet. */
  async openBookWorkspace(bookId: string): Promise<void> {
    const { workspace } = this.app;
    const leaf =
      workspace.getLeavesOfType(BOOK_WORKSPACE_VIEW)[0] ||
      workspace.getLeaf(workspace.getMostRecentLeaf(workspace.rootSplit) ? "tab" : false);
    if (leaf.getViewState().state?.documentId !== bookId) {
      await leaf.setViewState({
        type: BOOK_WORKSPACE_VIEW,
        active: true,
        state: { documentId: bookId || undefined },
      });
    }
    await workspace.revealLeaf(leaf);
  }

  getSelectedHighlightsBookId(): string | null {
    return this.selectedHighlightsBookId;
  }

  onSelectedHighlightsBookChange(listener: (bookId: string) => void): () => void {
    this.selectedHighlightsBookListeners.add(listener);
    return () => this.selectedHighlightsBookListeners.delete(listener);
  }

  async createInboxNoteFromHighlight(args: CreateInboxNoteArgs): Promise<TFile> {
    return this.noteService.createInboxNoteFromHighlight(this.settings, args);
  }

  async saveReaderDocument(document: ReadwiseSaveDocumentRequest): Promise<ReadwiseSaveDocumentResponse> {
    if (!this.settings.readwiseToken) throw new Error(TOKEN_MISSING);
    const saved = await this.workspaceService.importer.url(document);
    this.workspaceService.afterReaderChange();
    const id = saved.readerIds[0];
    return { id, url: readerDocumentUrl(id) };
  }

  async addReaderDocumentTags(documentId: string, tags: string[]): Promise<void> {
    await this.readwiseService.addDocumentTags(documentId, tags);
    await this.syncReadwiseData({ silent: true });
  }

  async moveReaderDocument(documentId: string, location: "new" | "later" | "archive"): Promise<void> {
    await this.readwiseService.updateDocumentLocation(documentId, location);
    const current = this.dataManager.getBook(documentId);
    await this.dataManager.saveReaderLocationChange(
      documentId,
      location,
      current ? applyReaderLocation(current, location, new Date().toISOString()) : undefined,
    );
    this.workspaceService.afterReaderChange();
  }

  async deleteReaderBook(documentId: string): Promise<void> {
    try {
      await this.readwiseService.deleteReaderDocument(
        documentId,
        this.settings.readwiseReaderSessionCookie,
      );
      this.workspaceService.afterReaderChange();
    } catch (error) {
      if (error instanceof ReaderAuthenticationError && this.settings.readwiseReaderSessionCookie) {
        this.settings.readwiseReaderSessionCookie = "";
        await this.saveSettings();
      }
      throw error;
    }
  }

  /**
   * EPUB/PDF go through Reader's upload endpoint (session cookie); other files are
   * saved as articles through the API, which needs the token.
   */
  async uploadReaderFile(
    fileName: string,
    contentType: string,
    body: ArrayBuffer,
    tags: string[] = [],
    title?: string,
  ): Promise<ReadwiseUploadFileResponse> {
    if (!/\.(epub|pdf)$/i.test(fileName) && !this.settings.readwiseToken) throw new Error(TOKEN_MISSING);
    try {
      const uploaded = await this.workspaceService.importer.file(fileName, contentType, body, tags, title);
      this.workspaceService.afterReaderChange();
      return { docs_ids: uploaded.readerIds };
    } catch (error) {
      if (error instanceof ReaderAuthenticationError && this.settings.readwiseReaderSessionCookie) {
        this.settings.readwiseReaderSessionCookie = "";
        await this.saveSettings();
      }
      throw error;
    }
  }

  async loginToReader(email: string, password: string): Promise<void> {
    const result = await this.readwiseService.loginToReader(email, password);
    this.settings.readwiseReaderSessionCookie = result.sessionCookie;
    await this.saveSettings();
  }

  async migrateReadwiseBookNotesToLinkedHighlights(): Promise<void> {
    await this.noteService.migrateReadwiseBookNotesToLinkedHighlights(
      this.settings,
      this.settings.debugLogging,
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadPluginSettings(this);
  }

  async saveSettings(): Promise<void> {
    await savePluginSettings(this, this.settings);
    if (this.readwiseService) {
      this.readwiseService.updateToken(this.settings.readwiseToken);
      this.readwiseService.setDebug(this.settings.debugLogging);
      this.readwiseService.setRequestDelayMs(this.settings.requestDelayMs);
      this.readwiseService.setMaxRetries(this.settings.maxRetries);
    }
  }

  async testReadwiseToken(): Promise<void> {
    if (!this.settings.readwiseToken) {
      this.notice(t("notice.setToken"));
      return;
    }

    try {
      await this.readwiseService.validateToken();
      this.notice(t("notice.tokenValid"));
    } catch (error) {
      this.notice(t("notice.tokenTestFailed", { message: errorMessage(error) }));
      if (this.settings.debugLogging) {
        console.error(error);
      }
    }
  }

  async syncReadwiseData(options: SyncOptions = {}): Promise<void> {
    if (!this.settings.readwiseToken) {
      if (options.throwOnError) throw new Error(TOKEN_MISSING);
      if (!options.silent) {
        this.notice(t("notice.setToken"));
      }
      return;
    }

    // A second caller joins the running sync instead of starting another one.
    if (!this.syncInFlight) {
      if (!options.silent) {
        this.notice(t(options.fullHistory ? "notice.syncingFullHistory" : "notice.syncing"));
      }
      this.lastSyncError = undefined;
      this.syncInFlight = this.runSync(options).finally(() => {
        this.syncInFlight = null;
      });
      await this.syncInFlight;
      this.workspaceService.reload();
    } else {
      await this.syncInFlight;
    }

    if (options.throwOnError && this.lastSyncError) throw toError(this.lastSyncError);
  }

  private async runSync(options: SyncOptions): Promise<void> {
    try {
      if (options.fullHistory) {
        await this.syncService.syncFullHistory(this.settings.debugLogging, options);
      } else {
        await this.syncService.sync(this.settings.debugLogging, options);
      }
    } catch (error) {
      this.lastSyncError = error;
      if (this.settings.debugLogging) {
        console.error(error);
      }
      if (!options.silent) {
        this.notice(t("notice.syncFailed", { message: errorMessage(error) }));
      }
    }
  }

  async triggerReadwiseOfficialSyncAndWait(): Promise<void> {
    await this.officialSyncService.triggerAndWait(this.settings);
  }

  notice(message: string): void {
    new Notice(message);
  }

  private configureAutoSync(): void {
    this.app.workspace.onLayoutReady(() => {
      void this.runAutoSyncIfDue();
    });

    const intervalId = window.setInterval(() => {
      void this.runAutoSyncIfDue();
    }, AUTO_SYNC_CHECK_INTERVAL_MS);
    this.registerInterval(intervalId);
  }

  private async runAutoSyncIfDue(): Promise<void> {
    if (!this.settings.readwiseToken) {
      return;
    }

    if (!isAutoSyncDue(this.dataManager.getData().lastSync)) {
      return;
    }

    await this.syncReadwiseData({ silent: true });
  }

}

export default ReadwiseTrackerPlugin;
