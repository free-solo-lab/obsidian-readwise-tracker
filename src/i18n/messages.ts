export type SupportedLocale = "en" | "ru";

type MessageParams = Record<string, string | number>;

export type I18nKey = keyof typeof messages.en;

const messages = {
  en: {
    "command.openHighlights": "Open Readwise Book Highlights",
    "command.openDashboard": "Open Progress Dashboard",
    "command.syncReadwiseData": "Sync Readwise Data",
    "command.syncAll": "Sync All (Official + Tracker)",
    "command.testToken": "Test Readwise Token",
    "command.migrateHighlights": "Migrate Readwise book notes to linked highlights",

    "notice.officialSyncSkippedFailed": "Readwise Official sync skipped/failed: {message}",
    "notice.allSyncCompleted": "All sync steps completed.",
    "notice.trackerSyncCompleted": "Tracker sync steps completed.",
    "notice.setToken": "Please set Readwise API Token in settings.",
    "notice.tokenValid": "Readwise token is valid (204).",
    "notice.tokenTestFailed": "Readwise token test failed: {message}",
    "notice.syncing": "Syncing Readwise data...",
    "notice.syncFailed": "Failed to sync Readwise data: {message}",
    "notice.syncComplete": "Sync complete. Added {newCount} books, updated {updateCount} books.",
    "notice.officialCommandNotFound": "Readwise Official command not found",
    "notice.officialSyncing": "Readwise Official: syncing...",
    "notice.officialSyncTimeout": "Timeout waiting for Readwise Official sync",
    "notice.setFolders": "Please set Readwise folders in settings.",
    "notice.noMarkdownFiles": "No markdown files found in {sourceFolder}",
    "notice.migratingNotes": "Migrating Readwise notes: {count} files...",
    "notice.migrationComplete": "Migration complete. Created {created}, skipped {skipped}, errors {errors}.",

    "settings.title": "Readwise Reading Tracker Settings",
    "settings.setupGuideName": "Setup guide",
    "settings.setupGuideDesc": "Read how to configure this plugin with the official Readwise Obsidian export.",
    "settings.setupGuideButton": "Open README",
    "settings.tokenName": "Readwise Access Token",
    "settings.tokenDesc": "Your API token from https://readwise.io/access_token",
    "settings.tokenPlaceholder": "Enter your token",
    "settings.debugName": "Debug logging",
    "settings.debugDesc": "Log Readwise requests and statuses to the developer console",
    "settings.booksFolderName": "Readwise books folder",
    "settings.booksFolderDesc": "Folder with markdown files created by the Readwise official plugin (books).",
    "settings.linkedHighlightsName": "Linked highlights folder",
    "settings.linkedHighlightsDesc": "Destination folder for linked highlight notes (one subfolder per book).",
    "settings.inboxFolderName": "Inbox folder",
    "settings.inboxFolderDesc": "Destination folder for notes created from highlights in Readwise Book Highlights.",
    "settings.testTokenName": "Test Readwise Token",
    "settings.testTokenDesc": "Performs GET https://readwise.io/api/v2/auth/ (expects 204)",
    "settings.testButton": "Test",
    "settings.syncScopeTitle": "Sync scope",
    "settings.syncLocationsName": "Reader locations to sync",
    "settings.syncLocationsDesc": "Which Readwise Reader locations to pull. Large libraries (lots of RSS feed / archive) can exceed the API rate limit if everything is fetched every time. Turning a location off skips it. With none selected, all locations are fetched (legacy behaviour).",
    "settings.requestDelayName": "Delay between requests (ms)",
    "settings.requestDelayDesc": "Pause between paginated list requests to stay under the Readwise rate limit (~20 req/min). Increase this if you still hit HTTP 429; set 0 to disable.",
    "settings.maxRetriesName": "Max rate-limit retries",
    "settings.maxRetriesDesc": "How many times to wait out an HTTP 429 (honouring Retry-After) before a request fails.",

    "view.highlights": "Readwise Book Highlights",
    "view.dashboard": "Reading Heatmap",

    "stats.searchPlaceholder": "Search books...",
    "stats.currentlyReading": "Currently reading",
    "stats.selectBook": "Select a book to view its notes.",
    "stats.spent": "spent",
    "stats.remaining": "remaining",
    "stats.remainingUnknown": "remaining: -",
    "stats.highlights": "Highlights",
    "stats.noHighlights": "No linked highlight notes found.",
    "stats.sortHighlights": "Highlight sorting",
    "stats.sortByDate": "By date",
    "stats.sortByIndex": "By index",
    "stats.toggleSortDirection": "Change sort direction",
    "stats.collapse": "Collapse",
    "stats.expand": "Expand",
    "stats.createInboxNote": "Create inbox note",
    "stats.inInbox": "To inbox",
    "stats.loading": "Loading...",
    "stats.emptyNote": "Empty note.",
    "stats.readNoteError": "Error reading note: {message}",

    "dashboard.minutesLegend": "Reading minutes",
    "dashboard.progressLegend": "Progress (p.p.)",
    "dashboard.updatesLegend": "Books (updates)",
    "dashboard.period365": "Last 365 days",
    "dashboard.periodDay": "1 day",
    "dashboard.remainingUnknown": "remaining: -",
    "dashboard.completedLabel": "read",
    "dashboard.currentlyReading": "Currently reading",
    "dashboard.completed": "Read",
    "dashboard.noActiveBooks": "No active books.",
    "dashboard.noCompletedBooks": "No read books yet.",

    "heatmap.mon": "Mon",
    "heatmap.wed": "Wed",
    "heatmap.fri": "Fri",
    "heatmap.less": "Less",
    "heatmap.more": "More",
    "heatmap.maxDay": "Max per day",
    "heatmap.avgActiveDay": "Average (active day)",
    "heatmap.activeDays": "Reading days",
    "heatmap.minutesUnit": "min",
    "heatmap.progressUnit": "p.p.",
    "heatmap.booksUnit": "books",

    "bookSection.showAll": "Show all",

    "note.links": "Links",
  },
  ru: {
    "command.openHighlights": "Открыть Readwise Book Highlights",
    "command.openDashboard": "Открыть дашборд прогресса",
    "command.syncReadwiseData": "Синхронизировать Readwise",
    "command.syncAll": "Синхронизировать всё (Official + Tracker)",
    "command.testToken": "Проверить Readwise Token",
    "command.migrateHighlights": "Мигрировать заметки Readwise в связанные хайлайты",

    "notice.officialSyncSkippedFailed": "Readwise Official пропущен/завершился с ошибкой: {message}",
    "notice.allSyncCompleted": "Все шаги синхронизации завершены.",
    "notice.trackerSyncCompleted": "Шаги синхронизации Tracker завершены.",
    "notice.setToken": "Укажите Readwise API Token в настройках.",
    "notice.tokenValid": "Readwise token валиден (204).",
    "notice.tokenTestFailed": "Проверка Readwise token не прошла: {message}",
    "notice.syncing": "Синхронизация Readwise...",
    "notice.syncFailed": "Не удалось синхронизировать Readwise: {message}",
    "notice.syncComplete": "Синхронизация завершена. Добавлено книг: {newCount}, обновлено: {updateCount}.",
    "notice.officialCommandNotFound": "Команда Readwise Official не найдена",
    "notice.officialSyncing": "Readwise Official: синхронизация...",
    "notice.officialSyncTimeout": "Превышено время ожидания синхронизации Readwise Official",
    "notice.setFolders": "Укажите папки Readwise в настройках.",
    "notice.noMarkdownFiles": "Markdown-файлы не найдены в {sourceFolder}",
    "notice.migratingNotes": "Миграция заметок Readwise: {count} файлов...",
    "notice.migrationComplete": "Миграция завершена. Создано: {created}, пропущено: {skipped}, ошибок: {errors}.",

    "settings.title": "Настройки Readwise Reading Tracker",
    "settings.setupGuideName": "Setup guide",
    "settings.setupGuideDesc": "Read how to configure this plugin with the official Readwise Obsidian export.",
    "settings.setupGuideButton": "Open README",
    "settings.tokenName": "Readwise Access Token",
    "settings.tokenDesc": "API token из https://readwise.io/access_token",
    "settings.tokenPlaceholder": "Введите token",
    "settings.debugName": "Debug logging",
    "settings.debugDesc": "Логировать запросы и статусы Readwise в developer console",
    "settings.booksFolderName": "Папка книг Readwise",
    "settings.booksFolderDesc": "Папка с markdown-файлами, созданными официальным Readwise plugin (книги).",
    "settings.linkedHighlightsName": "Папка связанных хайлайтов",
    "settings.linkedHighlightsDesc": "Папка для связанных заметок-хайлайтов (по подпапке на книгу).",
    "settings.inboxFolderName": "Папка inbox",
    "settings.inboxFolderDesc": "Папка для заметок, созданных из хайлайтов в Readwise Book Highlights.",
    "settings.testTokenName": "Проверить Readwise Token",
    "settings.testTokenDesc": "Выполняет GET https://readwise.io/api/v2/auth/ (ожидает 204)",
    "settings.testButton": "Проверить",
    "settings.syncScopeTitle": "Что синхронизировать",
    "settings.syncLocationsName": "Локации Reader для синхронизации",
    "settings.syncLocationsDesc": "Какие локации Readwise Reader подтягивать. На больших библиотеках (много RSS feed / archive) выборка всего подряд каждый раз упирается в лимит API. Выключенная локация пропускается. Если не выбрано ничего — тянутся все локации (старое поведение).",
    "settings.requestDelayName": "Пауза между запросами (мс)",
    "settings.requestDelayDesc": "Задержка между постраничными запросами, чтобы не превысить лимит Readwise (~20 запр/мин). Увеличьте, если всё ещё ловите HTTP 429; 0 — отключить.",
    "settings.maxRetriesName": "Макс. повторов при лимите",
    "settings.maxRetriesDesc": "Сколько раз пережидать HTTP 429 (с учётом Retry-After), прежде чем запрос упадёт.",

    "view.highlights": "Readwise Book Highlights",
    "view.dashboard": "Reading Heatmap",

    "stats.searchPlaceholder": "Поиск книги...",
    "stats.currentlyReading": "Читаю сейчас",
    "stats.selectBook": "Выберите книгу, чтобы посмотреть её заметки.",
    "stats.spent": "ушло",
    "stats.remaining": "осталось",
    "stats.remainingUnknown": "осталось: -",
    "stats.highlights": "Highlights",
    "stats.noHighlights": "Нет созданных хайлайтов в папке связок.",
    "stats.sortHighlights": "Сортировка хайлайтов",
    "stats.sortByDate": "По дате",
    "stats.sortByIndex": "По индексу",
    "stats.toggleSortDirection": "Поменять направление",
    "stats.collapse": "Схлопнуть",
    "stats.expand": "Раскрыть",
    "stats.createInboxNote": "Создать заметку в inbox",
    "stats.inInbox": "В inbox",
    "stats.loading": "Загрузка...",
    "stats.emptyNote": "Пустая заметка.",
    "stats.readNoteError": "Ошибка чтения заметки: {message}",

    "dashboard.minutesLegend": "Минуты чтения",
    "dashboard.progressLegend": "Прогресс (п.п.)",
    "dashboard.updatesLegend": "Книги (обновления)",
    "dashboard.period365": "За 365 дней",
    "dashboard.periodDay": "За 1 день",
    "dashboard.remainingUnknown": "осталось: -",
    "dashboard.completedLabel": "прочитано",
    "dashboard.currentlyReading": "Сейчас читаю",
    "dashboard.completed": "Прочитано",
    "dashboard.noActiveBooks": "Нет активных книг.",
    "dashboard.noCompletedBooks": "Пока нет прочитанных книг.",

    "heatmap.mon": "Пн",
    "heatmap.wed": "Ср",
    "heatmap.fri": "Пт",
    "heatmap.less": "Меньше",
    "heatmap.more": "Больше",
    "heatmap.maxDay": "Макс. за день",
    "heatmap.avgActiveDay": "Среднее (активный день)",
    "heatmap.activeDays": "Дней с чтением",
    "heatmap.minutesUnit": "мин",
    "heatmap.progressUnit": "п.п.",
    "heatmap.booksUnit": "книг",

    "bookSection.showAll": "Показать все",

    "note.links": "Связи",
  },
} as const;

export function normalizeLocale(language: string | undefined | null): SupportedLocale {
  return String(language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function getDateLocale(locale: SupportedLocale): "ru-RU" | "en-US" {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export function getSortLocale(locale: SupportedLocale): "ru" | "en" {
  return locale === "ru" ? "ru" : "en";
}

export function translate(locale: SupportedLocale, key: I18nKey, params: MessageParams = {}): string {
  const template = messages[locale][key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));
}

export function formatDurationCompact(minutesRaw: number, locale: SupportedLocale): string {
  const minutes = Math.max(0, Math.round(minutesRaw));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourUnit = locale === "ru" ? "ч" : "h";
  const minuteUnit = locale === "ru" ? "м" : "m";

  if (hours <= 0) {
    return `${rest}${minuteUnit}`;
  }
  if (rest === 0) {
    return `${hours}${hourUnit}`;
  }
  return `${hours}${hourUnit} ${rest}${minuteUnit}`;
}
