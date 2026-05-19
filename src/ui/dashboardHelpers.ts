import type { LocalBook, ReadingActivityDay } from "../models/store";
import { formatDurationCompact, getDateLocale, translate, type SupportedLocale } from "../i18n/messages";

export function hasReadingActivity(day: ReadingActivityDay | undefined): boolean {
  if (!day) {
    return false;
  }

  return (
    (day.minutes || 0) > 0.01 ||
    (day.words || 0) > 0.01 ||
    (day.progressPoints || 0) > 0.01 ||
    (day.events || 0) > 0
  );
}

export function getEstimatedTotalWords(book: LocalBook | null): number {
  if (!book) {
    return 0;
  }
  if ((book.words_count || 0) > 0) {
    return book.words_count || 0;
  }
  if ((book.total_pages || 0) > 0) {
    return (book.total_pages || 0) * 280;
  }
  return 0;
}

export function getMinutesForDay(day: ReadingActivityDay | undefined, selectedBook: LocalBook | null): number {
  if (!day) {
    return 0;
  }
  if ((day.minutes || 0) > 0) {
    return day.minutes || 0;
  }
  if ((day.words || 0) > 0) {
    return (day.words || 0) / 200;
  }
  const estimatedWords = getEstimatedTotalWords(selectedBook);
  if ((day.progressPoints || 0) > 0 && estimatedWords > 0) {
    return ((estimatedWords * (day.progressPoints || 0)) / 100) / 200;
  }
  return 0;
}

export function formatHeatmapValue(
  value: number,
  mode: "minutes" | "progressPoints" | "updates",
  locale: SupportedLocale = "ru",
): string {
  if (mode === "minutes") {
    return `${value.toFixed(1)} ${translate(locale, "heatmap.minutesUnit")}`;
  }
  if (mode === "progressPoints") {
    return `${value.toFixed(1)} ${translate(locale, "heatmap.progressUnit")}`;
  }
  return `${value.toFixed(0)} ${translate(locale, "heatmap.booksUnit")}`;
}

export function getHeatmapLevel(value: number, mode: "minutes" | "progressPoints" | "updates"): number {
  if (value <= 0) {
    return 0;
  }
  if (mode === "minutes") {
    if (value < 10) return 1;
    if (value < 30) return 2;
    if (value < 60) return 3;
    return 4;
  }
  if (mode === "progressPoints") {
    if (value < 1) return 1;
    if (value < 3) return 2;
    if (value < 7) return 3;
    return 4;
  }
  if (value < 1) return 1;
  if (value < 2) return 2;
  if (value < 4) return 3;
  return 4;
}

export function formatRemaining(minutesRaw: number, locale: SupportedLocale = "ru"): string {
  const duration = formatDurationCompact(minutesRaw, locale);
  return locale === "ru" ? `${duration} осталось` : `${duration} remaining`;
}

export function getRemainingMinutes(book: LocalBook): number | null {
  const totalWords = book.words_count || 0;
  if (totalWords <= 0) {
    return null;
  }
  const progressRatio = Math.min(100, Math.max(0, book.reading_progress || 0)) / 100;
  return (totalWords * (1 - progressRatio)) / 200;
}

export function formatShortDate(iso: string | undefined, locale: SupportedLocale = "ru"): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(getDateLocale(locale), { day: "numeric", month: "short" }).format(date);
}
