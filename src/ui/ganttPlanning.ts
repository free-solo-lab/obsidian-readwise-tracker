import type { LocalBook, ReadingActivityDay } from "../models/store";
import { getRemainingMinutes } from "./dashboardHelpers";
import { UNTAGGED_DIRECTION_KEY } from "./planningBoard";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GanttPlanItem {
  book: LocalBook;
  remainingMinutes: number;
  durationDays: number;
  startOffset: number;
  startDate: string;
  endDate: string;
}

export interface GanttSchedule {
  items: GanttPlanItem[];
  unscheduledBooks: LocalBook[];
  totalDays: number;
}

export interface GanttPlanningOrder {
  focusTags: string[];
  directionOrder: string[];
  directionBookOrder: Record<string, string[]>;
}

interface GanttBookSortDetails {
  focusRank: number;
  directionRank: number;
}

function getNormalizedTags(book: LocalBook): string[] {
  const tags = Array.from(new Set((book.tags || []).map((tag) => tag.trim()).filter(Boolean)));
  return tags.length > 0 ? tags : [UNTAGGED_DIRECTION_KEY];
}

/**
 * Produces the unique sequence used by the schedule. Focused directions follow
 * their visual order, and books follow their visual order inside the direction.
 */
export function orderBooksForGantt(
  books: LocalBook[],
  priorities: GanttPlanningOrder,
  locale: string,
): LocalBook[] {
  const orderedDirections = Array.from(new Set([
    ...priorities.directionOrder,
    ...priorities.focusTags.filter((tag) => !priorities.directionOrder.includes(tag)),
  ]));
  const focusSet = new Set(priorities.focusTags);
  const focusIndex = new Map<string, number>(
    orderedDirections.map((tag, index): [string, number] => [tag, index]),
  );
  const bookIndexByDirection = new Map<string, Map<string, number>>();
  for (const [directionKey, bookIds] of Object.entries(priorities.directionBookOrder)) {
    bookIndexByDirection.set(
      directionKey,
      new Map<string, number>(bookIds.map((bookId, index): [string, number] => [bookId, index])),
    );
  }

  const details: Record<string, GanttBookSortDetails> = {};
  for (const book of books) {
    const focusedTags = getNormalizedTags(book)
      .filter((tag) => focusSet.has(tag))
      .sort((a, b) => (
        (focusIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (focusIndex.get(b) ?? Number.MAX_SAFE_INTEGER)
      ));
    const primaryDirection = focusedTags[0];
    const directionIndex = primaryDirection
      ? bookIndexByDirection.get(primaryDirection)?.get(book.id) ?? -1
      : -1;
    details[book.id] = {
      focusRank: primaryDirection
        ? focusIndex.get(primaryDirection) ?? Number.MAX_SAFE_INTEGER
        : Number.MAX_SAFE_INTEGER,
      directionRank: directionIndex >= 0 ? directionIndex : Number.MAX_SAFE_INTEGER,
    };
  }
  const fallbackDetails: GanttBookSortDetails = {
    focusRank: Number.MAX_SAFE_INTEGER,
    directionRank: Number.MAX_SAFE_INTEGER,
  };

  return [...books].sort((a, b) => {
    const aDetails: GanttBookSortDetails = details[a.id] ?? fallbackDetails;
    const bDetails: GanttBookSortDetails = details[b.id] ?? fallbackDetails;
    if (aDetails.focusRank !== bDetails.focusRank) return aDetails.focusRank - bDetails.focusRank;
    if (aDetails.directionRank !== bDetails.directionRank) return aDetails.directionRank - bDetails.directionRank;
    return a.title.localeCompare(b.title, locale);
  });
}

function parseDateKey(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const timestamp = parseDateKey(dateKey);
  if (timestamp === null) return dateKey;
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

export function getAverageDailyReadingMinutes(
  readingActivity: Record<string, ReadingActivityDay>,
): number {
  const dailyMinutes = Object.values(readingActivity)
    .map((day) => {
      if ((day.minutes || 0) > 0) return day.minutes || 0;
      if ((day.words || 0) > 0) return (day.words || 0) / 200;
      return 0;
    })
    .filter((minutes) => minutes > 0);

  if (dailyMinutes.length === 0) return 0;
  return dailyMinutes.reduce((sum, minutes) => sum + minutes, 0) / dailyMinutes.length;
}

export function buildGanttSchedule(
  books: LocalBook[],
  startDate: string,
  dailyReadingMinutes: number,
): GanttSchedule {
  if (parseDateKey(startDate) === null || dailyReadingMinutes <= 0) {
    return { items: [], unscheduledBooks: books, totalDays: 0 };
  }

  const items: GanttPlanItem[] = [];
  const unscheduledBooks: LocalBook[] = [];
  let offset = 0;

  for (const book of books) {
    const remainingMinutes = getRemainingMinutes(book);
    if (remainingMinutes === null || remainingMinutes <= 0) {
      unscheduledBooks.push(book);
      continue;
    }

    const durationDays = Math.max(1, Math.ceil(remainingMinutes / dailyReadingMinutes));
    items.push({
      book,
      remainingMinutes,
      durationDays,
      startOffset: offset,
      startDate: addDaysToDateKey(startDate, offset),
      endDate: addDaysToDateKey(startDate, offset + durationDays - 1),
    });
    offset += durationDays;
  }

  return { items, unscheduledBooks, totalDays: offset };
}
