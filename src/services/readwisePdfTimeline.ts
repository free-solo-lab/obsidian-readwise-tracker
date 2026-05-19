import type { LocalBook, ReadingActivityDay } from "../models/store";
import { toDateKey } from "../utils/date";
import { parseReadwiseHighlightsFromMarkdown } from "./readwiseHighlightParsing";

export function extractHighlightDateKeysFromMarkdown(markdown: string): string[] {
  try {
    return parseReadwiseHighlightsFromMarkdown(markdown)
      .map((highlight) => highlight.date)
      .filter((date): date is string => typeof date === "string" && date.trim().length > 0)
      .map((date) => toDateKey(date));
  } catch {
    return [];
  }
}

export function buildPdfReadingActivity(
  book: Pick<LocalBook, "words_count" | "reading_progress">,
  highlightDateKeys: string[],
): Record<string, ReadingActivityDay> {
  const countsByDate = new Map<string, number>();
  for (const dateKey of highlightDateKeys) {
    if (!dateKey) {
      continue;
    }
    countsByDate.set(dateKey, (countsByDate.get(dateKey) || 0) + 1);
  }

  const totalHighlights = Array.from(countsByDate.values()).reduce((sum, count) => sum + count, 0);
  if (totalHighlights <= 0) {
    return {};
  }

  const readingProgress = Math.max(0, Math.min(100, book.reading_progress || 0));
  const totalWords = Math.max(0, book.words_count || 0);
  const activity: Record<string, ReadingActivityDay> = {};

  for (const [dateKey, count] of countsByDate.entries()) {
    const progressPoints = readingProgress > 0 ? (readingProgress * count) / totalHighlights : 0;
    const words = totalWords > 0 && progressPoints > 0 ? (totalWords * progressPoints) / 100 : 0;
    activity[dateKey] = {
      minutes: words > 0 ? words / 200 : 0,
      words,
      progressPoints,
      events: count,
    };
  }

  return activity;
}
