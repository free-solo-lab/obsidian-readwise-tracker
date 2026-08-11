import test from "node:test";
import assert from "node:assert/strict";
import type { Plugin } from "obsidian";
import { loadPluginSettings, savePluginSettings } from "../../src/settings/persistence";
import { DEFAULT_SETTINGS } from "../../src/settings/types";

test("planning settings migration removes obsolete priority fields", async () => {
  let saved: unknown;
  const plugin = {
    loadData: async () => ({
      ganttStartDate: "2026-08-11",
      ganttBookOrder: ["old-book"],
      ganttGlobalBookPriorities: { "old-book": 1 },
      planningBoardCollapsedGroups: ["old-group"],
    }),
    saveData: async (value: unknown) => { saved = value; },
  } as unknown as Plugin;

  const settings = await loadPluginSettings(plugin);
  assert.equal(settings.ganttStartDate, "2026-08-11");
  assert.equal("ganttBookOrder" in settings, false);
  assert.equal("planningBoardCollapsedGroups" in settings, false);

  await savePluginSettings(plugin, { ...DEFAULT_SETTINGS, ganttStartDate: "2026-08-12" });
  assert.equal((saved as Record<string, unknown>).ganttStartDate, "2026-08-12");
  assert.equal("ganttGlobalBookPriorities" in (saved as Record<string, unknown>), false);
});
