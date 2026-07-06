import type { ReadwiseTrackerPlugin } from "../plugin/ReadwiseTrackerPlugin";
import { DASHBOARD_VIEW_TYPE, STATS_VIEW_TYPE } from "../plugin/workspace";
import { t } from "../i18n";

export function registerCommands(plugin: ReadwiseTrackerPlugin): void {
  plugin.addCommand({
    id: "readwise-stats",
    name: t("command.openHighlights"),
    callback: async () => {
      await plugin.activateView(STATS_VIEW_TYPE);
    },
  });

  plugin.addCommand({
    id: "readwise-dashboard",
    name: t("command.openDashboard"),
    callback: async () => {
      await plugin.activateView(DASHBOARD_VIEW_TYPE);
    },
  });

  plugin.addCommand({
    id: "readwise-sync",
    name: t("command.syncReadwiseData"),
    callback: async () => {
      await plugin.syncReadwiseData();
    },
  });

  plugin.addCommand({
    id: "readwise-sync-full-history",
    name: t("command.syncFullHistory"),
    callback: async () => {
      await plugin.syncReadwiseData({ fullHistory: true });
    },
  });

  plugin.addCommand({
    id: "readwise-sync-all",
    name: t("command.syncAll"),
    callback: async () => {
      let officialOk = false;
      try {
        await plugin.triggerReadwiseOfficialSyncAndWait();
        officialOk = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        plugin.notice(t("notice.officialSyncSkippedFailed", { message }));
      }

      await plugin.syncReadwiseData();
      await plugin.migrateReadwiseBookNotesToLinkedHighlights();
      plugin.notice(officialOk ? t("notice.allSyncCompleted") : t("notice.trackerSyncCompleted"));
    },
  });

  plugin.addCommand({
    id: "readwise-test-token",
    name: t("command.testToken"),
    callback: async () => {
      await plugin.testReadwiseToken();
    },
  });

  plugin.addCommand({
    id: "readwise-migrate-linked-highlights",
    name: t("command.migrateHighlights"),
    callback: async () => {
      await plugin.migrateReadwiseBookNotesToLinkedHighlights();
    },
  });
}
