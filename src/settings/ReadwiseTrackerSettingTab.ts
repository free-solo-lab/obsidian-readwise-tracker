import { App, PluginSettingTab, Setting } from "obsidian";
import type { ReadwiseTrackerPlugin } from "../plugin/ReadwiseTrackerPlugin";
import { t } from "../i18n";

export class ReadwiseTrackerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ReadwiseTrackerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settings.title") });

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
