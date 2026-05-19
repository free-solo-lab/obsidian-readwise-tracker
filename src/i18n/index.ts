import { getLanguage } from "obsidian";
import {
  formatDurationCompact,
  getDateLocale,
  getSortLocale,
  normalizeLocale,
  translate,
  type I18nKey,
  type SupportedLocale,
} from "./messages";

export function getCurrentLocale(): SupportedLocale {
  return normalizeLocale(getLanguage());
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  return translate(getCurrentLocale(), key, params);
}

export function currentDateLocale(): "ru-RU" | "en-US" {
  return getDateLocale(getCurrentLocale());
}

export function currentSortLocale(): "ru" | "en" {
  return getSortLocale(getCurrentLocale());
}

export function formatDurationForCurrentLocale(minutes: number): string {
  return formatDurationCompact(minutes, getCurrentLocale());
}

export { formatDurationCompact, getDateLocale, getSortLocale, normalizeLocale, translate };
export type { I18nKey, SupportedLocale };
