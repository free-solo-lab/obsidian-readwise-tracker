import test from "node:test";
import assert from "node:assert/strict";
import type { LocalBook } from "../../src/models/store";
import {
  addDaysToDateKey,
  buildGanttSchedule,
  getAverageDailyReadingMinutes,
  orderBooksForGantt,
} from "../../src/ui/ganttPlanning";
import { UNTAGGED_DIRECTION_KEY } from "../../src/ui/planningBoard";

const book = (id: string, words: number, progress = 0): LocalBook => ({
  id,
  title: id,
  author: "Author",
  category: "epub",
  source: "readwise",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: progress > 0 ? "reading" : "planned",
  reading_progress: progress,
  words_count: words,
});

test("getAverageDailyReadingMinutes averages active days and estimates words", () => {
  assert.equal(getAverageDailyReadingMinutes({
    "2026-01-01": { minutes: 30, words: 0, progressPoints: 0, events: 1 },
    "2026-01-02": { minutes: 0, words: 6000, progressPoints: 0, events: 1 },
    "2026-01-03": { minutes: 0, words: 0, progressPoints: 0, events: 0 },
  }), 30);
});

test("buildGanttSchedule places books sequentially using remaining reading time", () => {
  const schedule = buildGanttSchedule([
    book("a", 12_000),
    book("b", 24_000, 50),
  ], "2026-07-13", 30);

  assert.deepEqual(schedule.items.map((item) => ({
    id: item.book.id,
    days: item.durationDays,
    start: item.startDate,
    end: item.endDate,
  })), [
    { id: "a", days: 2, start: "2026-07-13", end: "2026-07-14" },
    { id: "b", days: 2, start: "2026-07-15", end: "2026-07-16" },
  ]);
  assert.equal(schedule.totalDays, 4);
});

test("buildGanttSchedule separates books without a known length", () => {
  const unknown = book("unknown", 0);
  const schedule = buildGanttSchedule([unknown], "2026-07-13", 30);
  assert.deepEqual(schedule.items, []);
  assert.deepEqual(schedule.unscheduledBooks, [unknown]);
});

test("addDaysToDateKey uses calendar dates without DST drift", () => {
  assert.equal(addDaysToDateKey("2026-03-28", 2), "2026-03-30");
});

test("orderBooksForGantt applies direction and book drag order", () => {
  const books = [
    { ...book("other", 12_000), tags: ["science"] },
    { ...book("history-low", 12_000), tags: ["history"] },
    { ...book("history-high", 12_000), tags: ["history"] },
    { ...book("global", 12_000), tags: ["science"] },
  ];

  const ordered = orderBooksForGantt(books, {
    focusTags: ["history"],
    directionOrder: ["history", "science"],
    directionBookOrder: { history: ["history-high", "history-low"] },
  }, "en");

  assert.deepEqual(ordered.map((item) => item.id), [
    "history-high",
    "history-low",
    "global",
    "other",
  ]);
});

test("orderBooksForGantt supports several focused directions in focus order", () => {
  const ordered = orderBooksForGantt([
    { ...book("history", 12_000), tags: ["history"] },
    { ...book("design", 12_000), tags: ["design"] },
    { ...book("other", 12_000), tags: ["science"] },
  ], {
    focusTags: ["design", "history"],
    directionOrder: ["design", "history"],
    directionBookOrder: {},
  }, "en");

  assert.deepEqual(ordered.map((item) => item.id), ["design", "history", "other"]);
});

test("orderBooksForGantt can focus the untagged direction", () => {
  const ordered = orderBooksForGantt([
    { ...book("tagged", 12_000), tags: ["history"] },
    book("untagged", 12_000),
  ], {
    focusTags: [UNTAGGED_DIRECTION_KEY],
    directionOrder: [UNTAGGED_DIRECTION_KEY, "history"],
    directionBookOrder: { [UNTAGGED_DIRECTION_KEY]: ["untagged"] },
  }, "en");

  assert.deepEqual(ordered.map((item) => item.id), ["untagged", "tagged"]);
});

test("a multi-tag book is scheduled by its highest focused direction", () => {
  const ordered = orderBooksForGantt([
    { ...book("history", 12_000), tags: ["history"] },
    { ...book("multi", 12_000), tags: ["science", "history"] },
    { ...book("science", 12_000), tags: ["science"] },
  ], {
    focusTags: ["science", "history"],
    directionOrder: ["history", "science"],
    directionBookOrder: { history: ["multi", "history"] },
  }, "en");

  assert.deepEqual(ordered.map((item) => item.id), ["multi", "history", "science"]);
});
