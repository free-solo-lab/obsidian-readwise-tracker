import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type ReadwiseTrackerSettings } from "./types";

export async function loadPluginSettings(plugin: Plugin): Promise<ReadwiseTrackerSettings> {
  return Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
}

export async function savePluginSettings(
  plugin: Plugin,
  settings: ReadwiseTrackerSettings,
): Promise<void> {
  const existing = (await plugin.loadData()) ?? {};
  await plugin.saveData(Object.assign({}, existing, settings));
}
