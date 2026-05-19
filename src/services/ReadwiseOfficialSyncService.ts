import { Notice, TFile, normalizePath, type App } from "obsidian";
import type { ReadwiseTrackerSettings } from "../settings/types";
import { t } from "../i18n";

interface CommandRegistry {
  executeCommandById(commandId: string): Promise<void> | void;
  commands?: Record<string, { name?: string }>;
}

export class ReadwiseOfficialSyncService {
  constructor(private readonly app: App) {}

  async triggerAndWait(settings: ReadwiseTrackerSettings): Promise<void> {
    const commandId = this.findOfficialSyncCommandId();
    if (!commandId) {
      throw new Error(t("notice.officialCommandNotFound"));
    }

    const roots = this.getWatchRoots(settings);
    let lastActivityAt = Date.now();
    let seenActivity = false;

    const onCreate = this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile) || !this.matchesWatchedPath(file.path, roots)) {
        return;
      }
      seenActivity = true;
      lastActivityAt = Date.now();
    });
    const onModify = this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || !this.matchesWatchedPath(file.path, roots)) {
        return;
      }
      seenActivity = true;
      lastActivityAt = Date.now();
    });

    try {
      new Notice(t("notice.officialSyncing"));
      const registry = this.getCommandRegistry();
      await Promise.resolve(registry?.executeCommandById(commandId));

      const startedAt = Date.now();
      const timeoutMs = 5 * 60 * 1000;
      const idleMs = 2_000;
      const noActivityMaxMs = 15_000;

      while (Date.now() - startedAt <= timeoutMs) {
        const now = Date.now();
        if (seenActivity && now - lastActivityAt > idleMs) {
          return;
        }
        if (!seenActivity && now - startedAt > noActivityMaxMs) {
          return;
        }
        await sleep(250);
      }
      throw new Error(t("notice.officialSyncTimeout"));
    } finally {
      this.app.vault.offref(onCreate);
      this.app.vault.offref(onModify);
    }
  }

  private getCommandRegistry(): CommandRegistry | null {
    const appWithCommands = this.app as App & { commands?: CommandRegistry };
    return appWithCommands.commands ?? null;
  }

  private findOfficialSyncCommandId(): string | null {
    const registry = this.getCommandRegistry();
    const commands = registry?.commands;
    if (!commands || typeof commands !== "object") {
      return null;
    }

    const entries = Object.entries(commands);
    for (const [id, command] of entries) {
      const name = typeof command?.name === "string" ? command.name.toLowerCase() : "";
      if (name.includes("readwise") && name.includes("sync") && name.includes("official")) {
        return id;
      }
    }

    for (const [id, command] of entries) {
      const name = typeof command?.name === "string" ? command.name.toLowerCase() : "";
      if (name.includes("readwise") && name.includes("sync")) {
        return id;
      }
      if (id.toLowerCase().includes("readwise") && name.includes("sync")) {
        return id;
      }
    }

    return null;
  }

  private getWatchRoots(settings: ReadwiseTrackerSettings): Set<string> {
    const normalizeFolder = (value: string | undefined) =>
      normalizePath(String(value || "")).replace(/^\/+/, "").replace(/\/+$/, "");

    const roots = new Set<string>();
    const booksFolder = normalizeFolder(settings.readwiseBooksFolder) || "Readwise/Books";
    const highlightsFolder = normalizeFolder(settings.readwiseLinkedHighlightsFolder) || "Readwise/Highlights";

    roots.add(booksFolder);
    roots.add(highlightsFolder);
    roots.add(booksFolder.split("/")[0] || booksFolder);
    roots.add(highlightsFolder.split("/")[0] || highlightsFolder);
    roots.add("Readwise");

    return roots;
  }

  private matchesWatchedPath(path: string, roots: Set<string>): boolean {
    for (const root of roots) {
      if (path === root || path.startsWith(`${root}/`)) {
        return true;
      }
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
