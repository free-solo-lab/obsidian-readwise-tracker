import test from "node:test";
import assert from "node:assert/strict";
import type { Plugin } from "obsidian";
import type { LocalBook, PluginData } from "../../src/models/store";
import { DataManager } from "../../src/services/dataManager";
import { savePluginSettings } from "../../src/settings/persistence";
import { DEFAULT_SETTINGS } from "../../src/settings/types";

const book: LocalBook = {
  id: "book",
  title: "Book",
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
  status: "completed",
  reading_progress: 50,
  location: "archive",
};

test("saveReaderLocationChange persists the book and pending confirmation together", async () => {
  let saved: PluginData | undefined;
  const plugin = {
    loadData: async () => saved || {},
    saveData: async (value: PluginData) => { saved = value; },
  } as unknown as Plugin;
  const manager = new DataManager(plugin);
  await manager.loadData();

  await manager.saveReaderLocationChange(book.id, "archive", book);

  assert.equal(saved?.books[book.id]?.status, "completed");
  assert.equal(saved?.pendingReaderLocations[book.id], "archive");
});

test("book data and settings saves cannot overwrite each other", async () => {
  let stored: Record<string, unknown> = {};
  let saveCount = 0;
  let releaseFirstSave: () => void = () => undefined;
  const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  const plugin = {
    loadData: async () => stored,
    saveData: async (value: Record<string, unknown>) => {
      saveCount += 1;
      if (saveCount === 1) await firstSaveGate;
      stored = value;
    },
  } as unknown as Plugin;
  const manager = new DataManager(plugin);
  await manager.loadData();

  const bookSave = manager.saveReaderLocationChange(book.id, "archive", book);
  const settingsSave = savePluginSettings(plugin, {
    ...DEFAULT_SETTINGS,
    ganttStartDate: "2026-08-12",
  });
  await Promise.resolve();
  releaseFirstSave();
  await Promise.all([bookSave, settingsSave]);

  const persisted = stored as unknown as PluginData;
  assert.equal(persisted.books[book.id]?.location, "archive");
  assert.equal(persisted.pendingReaderLocations[book.id], "archive");
  assert.equal((stored as { ganttStartDate?: string }).ganttStartDate, "2026-08-12");
});
