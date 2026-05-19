import { Notice, Plugin, type TFile } from "obsidian";
import { registerCommands } from "../commands/registerCommands";
import { DataManager } from "../services/dataManager";
import { ReadwiseNoteService } from "../services/readwiseNoteService";
import { ReadwiseService } from "../services/readwise";
import { ReadwiseOfficialSyncService } from "../services/ReadwiseOfficialSyncService";
import { ReadwiseSyncService } from "../services/ReadwiseSyncService";
import { ReadwiseTrackerSettingTab } from "../settings/ReadwiseTrackerSettingTab";
import { loadPluginSettings, savePluginSettings } from "../settings/persistence";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { DashboardView } from "../ui/DashboardView";
import { StatsView } from "../ui/StatsView";
import { t } from "../i18n";
import { AUTO_SYNC_CHECK_INTERVAL_MS, isAutoSyncDue } from "./autoSync";
import { DASHBOARD_VIEW_TYPE, STATS_VIEW_TYPE, activateReadwiseView } from "./workspace";
import type { CreateInboxNoteArgs } from "./contracts";

export class ReadwiseTrackerPlugin extends Plugin {
  settings!: ReadwiseTrackerSettings;
  dataManager!: DataManager;
  readwiseService!: ReadwiseService;

  private officialSyncService!: ReadwiseOfficialSyncService;
  private syncService!: ReadwiseSyncService;
  private noteService!: ReadwiseNoteService;
  private syncInFlight: Promise<void> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.dataManager = new DataManager(this);
    await this.dataManager.loadData();

    this.readwiseService = new ReadwiseService(this.settings.readwiseToken);
    this.readwiseService.setDebug(this.settings.debugLogging);
    this.officialSyncService = new ReadwiseOfficialSyncService(this.app);
    this.syncService = new ReadwiseSyncService(this.readwiseService, this.dataManager, this.app, () => this.settings);
    this.noteService = new ReadwiseNoteService(this.app);

    this.registerView(STATS_VIEW_TYPE, (leaf) => new StatsView(leaf, this));
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

    this.addSettingTab(new ReadwiseTrackerSettingTab(this.app, this));
    registerCommands(this);
    this.configureAutoSync();
  }

  async activateView(viewType: string): Promise<void> {
    await activateReadwiseView(this.app.workspace, viewType);
  }

  async createInboxNoteFromHighlight(args: CreateInboxNoteArgs): Promise<TFile> {
    return this.noteService.createInboxNoteFromHighlight(this.settings, args);
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
      const message = error instanceof Error ? error.message : String(error);
      this.notice(t("notice.tokenTestFailed", { message }));
      if (this.settings.debugLogging) {
        console.error(error);
      }
    }
  }

  async syncReadwiseData(options?: { silent?: boolean }): Promise<void> {
    if (!this.settings.readwiseToken) {
      if (!options?.silent) {
        this.notice(t("notice.setToken"));
      }
      return;
    }

    if (this.syncInFlight) {
      await this.syncInFlight;
      return;
    }

    if (!options?.silent) {
      this.notice(t("notice.syncing"));
    }

    this.syncInFlight = (async () => {
      try {
        await this.syncService.sync(this.settings.debugLogging, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.settings.debugLogging) {
          console.error(error);
        }
        if (!options?.silent) {
          this.notice(t("notice.syncFailed", { message }));
        }
      } finally {
        this.syncInFlight = null;
      }
    })();

    await this.syncInFlight;
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
