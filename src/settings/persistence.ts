import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type ReadwiseTrackerSettings } from "./types";
import { isPluginDataRecord, updatePluginData } from "../services/pluginDataPersistence";

const LEGACY_PLANNING_SETTING_KEYS = [
  "planningBoardCollapsedGroups",
  "ganttBookOrder",
  "ganttGlobalBookPriorities",
  "ganttDirectionBookPriorities",
] as const;

function removeLegacyPlanningSettings(settings: Record<string, unknown>): void {
  for (const key of LEGACY_PLANNING_SETTING_KEYS) delete settings[key];
}

export async function loadPluginSettings(plugin: Plugin): Promise<ReadwiseTrackerSettings> {
  const stored: unknown = await plugin.loadData();
  const loaded = Object.assign({}, isPluginDataRecord(stored) ? stored : {});
  removeLegacyPlanningSettings(loaded);
  return Object.assign({}, DEFAULT_SETTINGS, loaded);
}

export async function savePluginSettings(
  plugin: Plugin,
  settings: ReadwiseTrackerSettings,
): Promise<void> {
  await updatePluginData(plugin, (existing) => {
    const next = Object.assign({}, existing, settings) as Record<string, unknown>;
    removeLegacyPlanningSettings(next);
    return next;
  });
}
