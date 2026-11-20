import type { WorkspaceTranslationView } from "../settings/types";
import { TRANSLATION_LANGUAGES, translationPath } from "./translation";
import type { WorkspaceDocument } from "./types";

/** Which text the pane shows: the translation into `language` when `shown`, else the original. */
export interface TranslationView {
  language: string;
  shown: boolean;
}
export type TranslationViewPreferences = Record<string, WorkspaceTranslationView>;

/** How many books keep a remembered view; the oldest entries make room for new ones. */
export const TRANSLATION_VIEW_LIMIT = 500;

/** The languages a book is already translated into, in the order the picker offers them. */
export function translationLanguagesOf(
  document: Pick<WorkspaceDocument, "workspacePath">,
  exists: (path: string) => boolean,
): string[] {
  return TRANSLATION_LANGUAGES.map((item) => item.code).filter((code) =>
    exists(translationPath(document, code)),
  );
}

/**
 * The view a book opens in: the one the reader last used, or the translation when one exists
 * and nothing is remembered. A remembered language whose translation is gone gives way to one
 * that exists, so the toggle always leads somewhere.
 */
export function resolveTranslationView(
  preference: WorkspaceTranslationView | undefined,
  available: string[],
): TranslationView {
  const fallback = available[0] ?? TRANSLATION_LANGUAGES[0].code;
  const remembered = preference?.language;
  const language =
    remembered && (available.includes(remembered) || !available.length) ? remembered : fallback;
  return { language, shown: preference ? preference.translation : available.length > 0 };
}

/** Preferences with this book's view recorded last; the same object when nothing changes. */
export function rememberTranslationView(
  preferences: TranslationViewPreferences,
  documentId: string,
  view: TranslationView,
  limit = TRANSLATION_VIEW_LIMIT,
): TranslationViewPreferences {
  const current = preferences[documentId];
  if (current && current.language === view.language && current.translation === view.shown)
    return preferences;
  const entries = Object.entries(preferences).filter(([id]) => id !== documentId);
  entries.push([documentId, { language: view.language, translation: view.shown }]);
  return Object.fromEntries(entries.slice(-Math.max(1, limit)));
}

/** Stored preferences as the settings file has them, keeping only well-formed entries. */
export function readTranslationViewPreferences(value: unknown): TranslationViewPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: TranslationViewPreferences = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const item = entry as { language?: unknown; translation?: unknown } | null;
    if (item && typeof item.language === "string" && typeof item.translation === "boolean")
      result[id] = { language: item.language, translation: item.translation };
  }
  return result;
}
