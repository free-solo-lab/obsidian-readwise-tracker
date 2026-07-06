import { App, PluginSettingTab, Setting } from "obsidian";
import type { ReadwiseTrackerPlugin } from "../plugin/ReadwiseTrackerPlugin";
import { t } from "../i18n";
import { ALL_SYNC_LOCATIONS } from "./types";

export class ReadwiseTrackerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ReadwiseTrackerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settings.title") });

    new Setting(containerEl)
      .setName(t("settings.setupGuideName"))
      .setDesc(t("settings.setupGuideDesc"))
      .addButton((button) =>
        button
          .setButtonText(t("settings.setupGuideButton"))
          .onClick(() => {
            window.open(
              "https://github.com/free-solo-lab/obsidian-readwise-tracker#setup-with-the-official-readwise-plugin",
              "_blank",
            );
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.tokenName"))
      .setDesc(t("settings.tokenDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.tokenPlaceholder"))
          .setValue(this.plugin.settings.readwiseToken)
          .onChange(async (value) => {
            this.plugin.settings.readwiseToken = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.debugName"))
      .setDesc(t("settings.debugDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
          this.plugin.settings.debugLogging = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.booksFolderName"))
      .setDesc(t("settings.booksFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder("Readwise/Books")
          .setValue(this.plugin.settings.readwiseBooksFolder)
          .onChange(async (value) => {
            this.plugin.settings.readwiseBooksFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.linkedHighlightsName"))
      .setDesc(t("settings.linkedHighlightsDesc"))
      .addText((text) =>
        text
          .setPlaceholder("Readwise/Highlights")
          .setValue(this.plugin.settings.readwiseLinkedHighlightsFolder)
          .onChange(async (value) => {
            this.plugin.settings.readwiseLinkedHighlightsFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.inboxFolderName"))
      .setDesc(t("settings.inboxFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder("Inbox/Readwise")
          .setValue(this.plugin.settings.readwiseInboxFolder)
          .onChange(async (value) => {
            this.plugin.settings.readwiseInboxFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: t("settings.syncScopeTitle") });

    new Setting(containerEl)
      .setName(t("settings.syncLocationsName"))
      .setDesc(t("settings.syncLocationsDesc"));

    for (const location of ALL_SYNC_LOCATIONS) {
      new Setting(containerEl)
        .setName(location.charAt(0).toUpperCase() + location.slice(1))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.syncLocations.includes(location))
            .onChange(async (value) => {
              const selected = new Set(this.plugin.settings.syncLocations);
              if (value) {
                selected.add(location);
              } else {
                selected.delete(location);
              }
              this.plugin.settings.syncLocations = ALL_SYNC_LOCATIONS.filter((item) =>
                selected.has(item),
              );
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName(t("settings.requestDelayName"))
      .setDesc(t("settings.requestDelayDesc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.requestDelayMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.requestDelayMs = Number.isFinite(parsed)
              ? Math.min(60_000, Math.max(0, parsed))
              : 0;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.maxRetriesName"))
      .setDesc(t("settings.maxRetriesDesc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxRetries))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.maxRetries = Number.isFinite(parsed)
              ? Math.min(20, Math.max(0, parsed))
              : 8;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.fullHistoryName"))
      .setDesc(t("settings.fullHistoryDesc"))
      .addButton((button) =>
        button
          .setButtonText(t("settings.fullHistoryButton"))
          .onClick(async () => {
            await this.plugin.syncReadwiseData({ fullHistory: true });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.testTokenName"))
      .setDesc(t("settings.testTokenDesc"))
      .addButton((button) =>
        button.setButtonText(t("settings.testButton")).onClick(async () => {
          await this.plugin.testReadwiseToken();
        }),
      );
  }
}
