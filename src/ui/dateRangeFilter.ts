import type { LocalBook, ReadingActivityDay } from "../models/store";
import { hasReadingActivity } from "./dashboardHelpers";

export interface DateRange {
  from: string;
  to: string;
}

export function parseDateKey(dateKey: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveHeatmapDateRange(range: DateRange, today: Date): { start: Date; end: Date } {
  const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedEnd = parseDateKey(range.to) || normalizedToday;
  const selectedStart = parseDateKey(range.from);
  const start = selectedStart || new Date(selectedEnd);
  if (!selectedStart) start.setDate(start.getDate() - 364);
  if (start > selectedEnd) return { start: selectedEnd, end: start };
  return { start, end: selectedEnd };
}

export function isDateKeyInRange(dateKey: string, range: DateRange): boolean {
  if (!dateKey) return false;
  if (range.from && dateKey < range.from) return false;
  if (range.to && dateKey > range.to) return false;
  return true;
}

export function hasBookActivityInRange(
  book: LocalBook,
  activityByDate: Record<string, ReadingActivityDay> | undefined,
  range: DateRange,
): boolean {
  const activityDates = Object.entries(activityByDate || {})
    .filter(([, activity]) => hasReadingActivity(activity))
    .map(([dateKey]) => dateKey);

  if (activityDates.length > 0) {
    return activityDates.some((dateKey) => isDateKeyInRange(dateKey, range));
  }

  const fallbackDate = (book.updated_at || book.created_at || "").slice(0, 10);
  return isDateKeyInRange(fallbackDate, range);
}
