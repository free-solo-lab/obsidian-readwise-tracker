import { getLanguage } from "obsidian";
import {
  currentLocale,
  formatDurationCompact,
  getDateLocale,
  getSortLocale,
  normalizeLocale,
  setLocaleProvider,
  t,
  translate,
  type I18nKey,
  type SupportedLocale,
} from "./messages";

setLocaleProvider(() => normalizeLocale(getLanguage()));

export function getCurrentLocale(): SupportedLocale {
  return currentLocale();
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

export { t, formatDurationCompact, getDateLocale, getSortLocale, normalizeLocale, translate };
export type { I18nKey, SupportedLocale };
