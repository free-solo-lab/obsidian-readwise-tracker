import type { Plugin } from "obsidian";

export type PluginDataRecord = Record<string, unknown>;
type PluginDataUpdater = (current: PluginDataRecord) => PluginDataRecord;

const saveChains = new WeakMap<Plugin, Promise<void>>();

export function isPluginDataRecord(value: unknown): value is PluginDataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serializes every read-modify-write operation against Obsidian's shared plugin data file. */
export function updatePluginData(plugin: Plugin, updater: PluginDataUpdater): Promise<void> {
  const previous = saveChains.get(plugin) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const loaded: unknown = await plugin.loadData();
      const current = isPluginDataRecord(loaded) ? loaded : {};
      await plugin.saveData(updater(current));
    });
  saveChains.set(plugin, next);
  return next;
}
