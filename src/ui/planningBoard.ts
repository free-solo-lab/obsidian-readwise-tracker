import type { LocalBook } from "../models/store";

export type PlanningStatus = "planned" | "reading" | "completed";
export const UNTAGGED_DIRECTION_KEY = "__readwise_untagged__";

export interface PlanningTagGroup {
  tag: string | null;
  books: LocalBook[];
}

export function getPlanningDirectionKey(tag: string | null): string {
  return tag || UNTAGGED_DIRECTION_KEY;
}

export function moveItemBefore<T>(items: T[], source: T, target: T): T[] {
  if (source === target) return items;
  const sourceIndex = items.indexOf(source);
  const targetIndex = items.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

export function mergeVisibleOrder<T>(visibleItems: T[], savedItems: T[]): T[] {
  const visible = new Set(visibleItems);
  return [...visibleItems, ...savedItems.filter((item) => !visible.has(item))];
}

export function orderPlanningTagGroups(
  groups: PlanningTagGroup[],
  directionOrder: string[],
  directionBookOrder: Record<string, string[]>,
  locale: string,
): PlanningTagGroup[] {
  const directionIndex = new Map(directionOrder.map((key, index) => [key, index]));
  return groups.map((group) => {
    const groupKey = getPlanningDirectionKey(group.tag);
    const bookIndex = new Map((directionBookOrder[groupKey] || []).map((bookId, index) => [bookId, index]));
    return {
      ...group,
      books: [...group.books].sort((a, b) => {
        const aIndex = bookIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = bookIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.title.localeCompare(b.title, locale);
      }),
    };
  }).sort((a, b) => {
    const aIndex = directionIndex.get(getPlanningDirectionKey(a.tag));
    const bIndex = directionIndex.get(getPlanningDirectionKey(b.tag));
    if (aIndex !== undefined || bIndex !== undefined) {
      if (aIndex === undefined) return 1;
      if (bIndex === undefined) return -1;
      return aIndex - bIndex;
    }
    if (a.tag === null) return 1;
    if (b.tag === null) return -1;
    return a.tag.localeCompare(b.tag, locale);
  });
}

export type PlanningStatusCounts = Record<PlanningStatus, number>;

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

export function countPlanningBooksByStatus(books: LocalBook[]): PlanningStatusCounts {
  const counts: PlanningStatusCounts = { planned: 0, reading: 0, completed: 0 };
  for (const book of books) counts[getPlanningStatus(book)] += 1;
  return counts;
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
