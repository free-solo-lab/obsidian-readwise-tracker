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
  const loaded: Record<string, unknown> = {};
  if (isPluginDataRecord(stored)) for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in stored) loaded[key] = stored[key];
  }
  removeLegacyPlanningSettings(loaded);
  return Object.assign({}, DEFAULT_SETTINGS, loaded);
}

export async function savePluginSettings(
  plugin: Plugin,
  settings: ReadwiseTrackerSettings,
): Promise<void> {
  await updatePluginData(plugin, (existing) => {
    const next = { ...existing };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ReadwiseTrackerSettings>) next[key] = settings[key];
    removeLegacyPlanningSettings(next);
    return next;
  });
}
