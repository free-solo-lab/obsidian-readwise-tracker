import test from "node:test";
import assert from "node:assert/strict";
import { formatDurationCompact, normalizeLocale, translate } from "../../src/i18n/messages";

test("normalizeLocale supports Russian and falls back to English", () => {
  assert.equal(normalizeLocale("ru"), "ru");
  assert.equal(normalizeLocale("ru-RU"), "ru");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr"), "en");
});

test("translate resolves English and Russian strings with interpolation", () => {
  assert.equal(translate("en", "stats.currentlyReading"), "Currently reading");
  assert.equal(translate("ru", "stats.currentlyReading"), "Читаю сейчас");
  assert.equal(
    translate("en", "notice.syncComplete", { newCount: 2, updateCount: 3 }),
    "Sync complete. Added 2 books, updated 3 books.",
  );
});

test("formatDurationCompact uses locale-specific units", () => {
  assert.equal(formatDurationCompact(75, "en"), "1h 15m");
  assert.equal(formatDurationCompact(75, "ru"), "1ч 15м");
});
