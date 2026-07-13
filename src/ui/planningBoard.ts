import type { LocalBook } from "../models/store";

export type PlanningStatus = "planned" | "reading" | "completed";

export interface PlanningTagGroup {
  tag: string | null;
  books: LocalBook[];
}

export function getPlanningStatus(book: LocalBook): PlanningStatus {
  if (book.location === "archive") return "completed";
  if (book.location === "new") return "reading";
  if (book.location === "later" || book.location === "shortlist" || book.location === "feed") return "planned";
  const progress = Math.min(100, Math.max(0, book.reading_progress || 0));
  if (book.status === "completed" || progress >= 100) return "completed";
  if (book.status === "reading") return "reading";
  return "planned";
}

export function getReaderLocation(status: PlanningStatus): "new" | "later" | "archive" {
  if (status === "completed") return "archive";
  if (status === "reading") return "new";
  return "later";
}

export function groupPlanningBooksByTag(
  books: LocalBook[],
  locale: string,
  tagScope: string[] = [],
): PlanningTagGroup[] {
  const groups = new Map<string, LocalBook[]>();
  const scopedTags = new Set(tagScope);
  const untagged: LocalBook[] = [];

  for (const book of books) {
    const tags = Array.from(new Set(
      (book.tags || []).map((tag) => tag.trim()).filter(Boolean),
    )).filter((tag) => scopedTags.size === 0 || scopedTags.has(tag));

    if (tags.length === 0) {
      if (scopedTags.size === 0) untagged.push(book);
      continue;
    }

    for (const tag of tags) {
      groups.set(tag, [...(groups.get(tag) || []), book]);
    }
  }

  const result: PlanningTagGroup[] = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, locale))
    .map(([tag, groupedBooks]) => ({ tag, books: groupedBooks }));

  if (untagged.length > 0) result.push({ tag: null, books: untagged });
  return result;
}
