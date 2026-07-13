import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import type { ReadwiseTrackerViewHost } from "../plugin/contracts";
import type { LocalBook, ReadingActivityDay } from "../models/store";
import {
  formatHeatmapValue,
  formatRemaining,
  formatShortDate,
  getEstimatedTotalWords,
  getHeatmapLevel,
  getMinutesForDay,
  getRemainingMinutes,
  hasReadingActivity,
} from "./dashboardHelpers";
import { ReadwiseBookSection } from "./components/ReadwiseBookSection";
import { ReadwiseHeatmapPanel } from "./components/ReadwiseHeatmapPanel";
import { ReadwiseTagFilterBar } from "./components/ReadwiseTagFilterBar";
import { ReadwisePlanningBoard } from "./components/ReadwisePlanningBoard";
import { getCurrentLocale, getDateLocale, getSortLocale, t } from "../i18n";
import { getReaderLocation, type PlanningStatus } from "./planningBoard";
import { hasBookActivityInRange, isDateKeyInRange, resolveHeatmapDateRange } from "./dateRangeFilter";

export const DASHBOARD_VIEW_TYPE = "readwise-dashboard-view";

function isCompletedBook(book: LocalBook): boolean {
  return book.status === "completed" || Math.min(100, Math.max(0, book.reading_progress || 0)) >= 100;
}

function isReadingBook(book: LocalBook): boolean {
  return book.status === "reading" && !isCompletedBook(book);
}

function openDatePicker(event: React.MouseEvent<HTMLInputElement>): void {
  const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
  input.showPicker?.();
}

export class DashboardView extends ItemView {
  plugin: ReadwiseTrackerViewHost;
  root: ReactDOM.Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ReadwiseTrackerViewHost) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText() {
    return t("view.dashboard");
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    this.root = ReactDOM.createRoot(container);
    this.render();
  }

  async onClose() {
    this.root?.unmount();
  }

  render() {
    if (!this.root) {
      return;
    }

    this.root.render(<DashboardComponent plugin={this.plugin} />);
  }
}

const DashboardComponent: React.FC<{ plugin: ReadwiseTrackerViewHost }> = ({ plugin }) => {
  const [books, setBooks] = React.useState<LocalBook[]>([]);
  const [readingActivity, setReadingActivity] = React.useState<Record<string, ReadingActivityDay>>({});
  const [readingActivityByBook, setReadingActivityByBook] = React.useState<
    Record<string, Record<string, ReadingActivityDay>>
  >({});
  const [selectedBookId, setSelectedBookId] = React.useState<string | null>(null);
  const [completedCollapsed, setCompletedCollapsed] = React.useState(true);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [selectedDateKey, setSelectedDateKey] = React.useState<string | null>(null);
  const [visibleWeekCount, setVisibleWeekCount] = React.useState<number>(53);
  const [booksView, setBooksView] = React.useState<"list" | "board">("list");
  const [collapsedBoardGroups, setCollapsedBoardGroups] = React.useState<string[]>(
    () => plugin.settings.planningBoardCollapsedGroups || [],
  );
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const locale = getCurrentLocale();
  const dateLocale = getDateLocale(locale);
  const sortLocale = getSortLocale(locale);

  const updateCollapsedBoardGroups = React.useCallback((groupKeys: string[]) => {
    setCollapsedBoardGroups(groupKeys);
    plugin.settings.planningBoardCollapsedGroups = groupKeys;
    void plugin.saveSettings();
  }, [plugin]);

  const loadData = React.useCallback(() => {
    const data = plugin.dataManager.getData();
    setBooks(Object.values(data.books));
    setReadingActivity(data.readingActivity || {});
    setReadingActivityByBook(data.readingActivityByBook || {});
  }, [plugin]);

  React.useEffect(() => {
    loadData();
    const interval = window.setInterval(loadData, 3_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const selectedBook = React.useMemo(() => {
    if (!selectedBookId) {
      return null;
    }
    return books.find((book) => book.id === selectedBookId) || null;
  }, [books, selectedBookId]);

  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const book of books) {
      if (!book.tags) {
        continue;
      }
      for (const tag of book.tags) {
        const trimmed = typeof tag === "string" ? tag.trim() : "";
        if (trimmed) {
          set.add(trimmed);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, sortLocale));
  }, [books, sortLocale]);

  const isBookMatchingTags = React.useCallback(
    (book: LocalBook) => {
      if (selectedTags.length === 0) {
        return true;
      }
      const tags = book.tags || [];
      if (tags.length === 0) {
        return false;
      }
      const set = new Set(tags.map((tag) => (typeof tag === "string" ? tag.trim() : "")).filter(Boolean));
      return selectedTags.some((tag) => set.has(tag));
    },
    [selectedTags],
  );

  const filteredBooks = React.useMemo(
    () => (selectedTags.length === 0 ? books : books.filter(isBookMatchingTags)),
    [books, isBookMatchingTags, selectedTags.length],
  );

  React.useEffect(() => {
    if (!selectedBookId) {
      return;
    }
    const selected = books.find((book) => book.id === selectedBookId);
    if (selected && !isBookMatchingTags(selected)) {
      setSelectedBookId(null);
    }
  }, [books, isBookMatchingTags, selectedBookId]);

  React.useEffect(() => {
    if (selectedDateKey && selectedBookId) {
      setSelectedBookId(null);
    }
  }, [selectedBookId, selectedDateKey]);

  const activeBookIdsForDateFilter = React.useMemo(() => {
    if (!selectedDateKey && !dateFrom && !dateTo) {
      return null;
    }

    const set = new Set<string>();
    for (const book of filteredBooks) {
      if (!selectedDateKey) {
        if (hasBookActivityInRange(book, readingActivityByBook[book.id], { from: dateFrom, to: dateTo })) {
          set.add(book.id);
        }
        continue;
      }
      const byDay = readingActivityByBook[book.id];
      if (byDay && hasReadingActivity(byDay[selectedDateKey])) {
        set.add(book.id);
        continue;
      }

      const iso = book.updated_at || book.created_at;
      if (iso && iso.slice(0, 10) === selectedDateKey) {
        set.add(book.id);
      }
    }
    return set;
  }, [dateFrom, dateTo, filteredBooks, readingActivityByBook, selectedDateKey]);

  const fallbackUpdatesByDate = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const sourceBooks = selectedBookId ? books.filter((book) => book.id === selectedBookId) : filteredBooks;
    for (const book of sourceBooks) {
      const iso = book.updated_at || book.created_at;
      if (!iso) {
        continue;
      }
      const key = iso.slice(0, 10);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [books, filteredBooks, selectedBookId]);

  const activitySource = React.useMemo(() => {
    if (selectedBookId) {
      return readingActivityByBook[selectedBookId] || {};
    }

    if (selectedTags.length > 0) {
      const aggregated: Record<string, ReadingActivityDay> = {};
      for (const book of filteredBooks) {
        const byDay = readingActivityByBook[book.id];
        if (!byDay) {
          continue;
        }
        for (const [dateKey, day] of Object.entries(byDay)) {
          const existing = aggregated[dateKey] || { minutes: 0, words: 0, progressPoints: 0, events: 0 };
          aggregated[dateKey] = {
            minutes: existing.minutes + (day.minutes || 0),
            words: existing.words + (day.words || 0),
            progressPoints: existing.progressPoints + (day.progressPoints || 0),
            events: existing.events + (day.events || 0),
          };
        }
      }
      return aggregated;
    }

    return readingActivity || {};
  }, [filteredBooks, readingActivity, readingActivityByBook, selectedBookId, selectedTags.length]);

  const heatmapMode = React.useMemo(() => {
    const values = Object.values(activitySource);
    if (values.some((value) => (value.minutes || 0) > 0.01 || (value.words || 0) > 0.01)) {
      return "minutes" as const;
    }
    const selectedBookHasEstimatedWords = selectedBookId ? getEstimatedTotalWords(selectedBook) > 0 : false;
    if (selectedBookHasEstimatedWords && values.some((value) => (value.progressPoints || 0) > 0.01)) {
      return "minutes" as const;
    }
    if (values.some((value) => (value.progressPoints || 0) > 0.01)) {
      return "progressPoints" as const;
    }
    return "updates" as const;
  }, [activitySource, selectedBook, selectedBookId]);

  const heatmapValueByDate = React.useCallback(
    (dateKey: string) => {
      if (heatmapMode === "minutes") {
        return getMinutesForDay(activitySource[dateKey], selectedBook);
      }
      if (heatmapMode === "progressPoints") {
        return activitySource[dateKey]?.progressPoints || 0;
      }
      return fallbackUpdatesByDate[dateKey] || 0;
    },
    [activitySource, fallbackUpdatesByDate, heatmapMode, selectedBook],
  );

  const heatmapColors = React.useMemo(
    () => [
      "var(--rwt-heatmap-0)",
      "var(--rwt-heatmap-1)",
      "var(--rwt-heatmap-2)",
      "var(--rwt-heatmap-3)",
      "var(--rwt-heatmap-4)",
    ],
    [],
  );

  const displayedHeatmapValueByDate = React.useCallback((dateKey: string) => {
    if ((dateFrom || dateTo) && !isDateKeyInRange(dateKey, { from: dateFrom, to: dateTo })) {
      return 0;
    }
    return heatmapValueByDate(dateKey);
  }, [dateFrom, dateTo, heatmapValueByDate]);

  const heatmapData = React.useMemo(() => {
    const today = new Date();
    const selectedRange = resolveHeatmapDateRange({ from: dateFrom, to: dateTo }, today);
    const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 364);

    const gridStart = new Date(rangeStart);
    while (gridStart.getDay() !== 0) {
      gridStart.setDate(gridStart.getDate() - 1);
    }

    const gridEnd = new Date(rangeEnd);
    while (gridEnd.getDay() !== 6) {
      gridEnd.setDate(gridEnd.getDate() + 1);
    }

    const days: Date[] = [];
    for (const date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) {
      days.push(new Date(date));
    }

    const weeks: Date[][] = [];
    for (let index = 0; index < days.length; index += 7) {
      weeks.push(days.slice(index, index + 7));
    }

    let maxValue = 0;
    let totalValue = 0;
    let activeDays = 0;
    for (let date = new Date(selectedRange.start); date <= selectedRange.end; date.setDate(date.getDate() + 1)) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const value = displayedHeatmapValueByDate(key);
      totalValue += value;
      if (value > maxValue) {
        maxValue = value;
      }
      if (value > 0) {
        activeDays += 1;
      }
    }

    return {
      weeks,
      rangeStart,
      rangeEnd,
      maxValue,
      totalValue,
      activeDays,
      avgValue: activeDays > 0 ? totalValue / activeDays : 0,
      legendLabel:
        heatmapMode === "minutes"
          ? t("dashboard.minutesLegend")
          : heatmapMode === "progressPoints"
            ? t("dashboard.progressLegend")
            : t("dashboard.updatesLegend"),
    };
  }, [dateFrom, dateTo, displayedHeatmapValueByDate, heatmapMode]);

  const heatmapViewportRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const element = heatmapViewportRef.current;
    if (!element) {
      return;
    }

    const columnWidth = 13 + 4;
    const compute = () => {
      const width = element.clientWidth;
      const available = width - (30 + 8);
      const cols = Math.max(1, Math.floor((available + 4) / columnWidth));
      setVisibleWeekCount((previous) => (previous === cols ? previous : cols));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const displayedWeeks = React.useMemo(() => {
    const count = Math.max(1, Math.min(heatmapData.weeks.length, visibleWeekCount || heatmapData.weeks.length));
    return heatmapData.weeks.slice(Math.max(0, heatmapData.weeks.length - count));
  }, [heatmapData.weeks, visibleWeekCount]);

  const monthLabelByWeekIndex = React.useMemo(() => {
    const labels: Array<string | null> = new Array(displayedWeeks.length).fill(null);
    let previousMonth: string | null = null;

    for (let weekIndex = 0; weekIndex < displayedWeeks.length; weekIndex += 1) {
      const week = displayedWeeks[weekIndex];
      const firstInRange =
        week.find((date) => date >= heatmapData.rangeStart && date <= heatmapData.rangeEnd) ||
        week.find((date) => date <= heatmapData.rangeEnd) ||
        week[0];
      if (!firstInRange) {
        continue;
      }

      const label = new Intl.DateTimeFormat(dateLocale, { month: "short" }).format(firstInRange);
      if (label !== previousMonth) {
        labels[weekIndex] = label;
        previousMonth = label;
      }
    }
    return labels;
  }, [dateLocale, displayedWeeks, heatmapData.rangeEnd, heatmapData.rangeStart]);

  const selectedDayValue = React.useMemo(
    () => (selectedDateKey ? heatmapValueByDate(selectedDateKey) : null),
    [heatmapValueByDate, selectedDateKey],
  );

  const selectedDayLabel = React.useMemo(() => {
    if (!selectedDateKey) {
      return null;
    }
    const [year, month, day] = selectedDateKey.split("-").map((part) => Number(part));
    const date = new Date(year, (month || 1) - 1, day || 1);
    if (Number.isNaN(date.getTime())) {
      return selectedDateKey;
    }
    return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short" }).format(date);
  }, [dateLocale, selectedDateKey]);

  const statsPanel = React.useMemo(() => {
    if (!selectedDateKey) {
      return {
        periodLabel: dateFrom || dateTo
          ? `${t("dashboard.periodRange")}: ${dateFrom || "…"} — ${dateTo || "…"}`
          : t("dashboard.period365"),
        total: heatmapData.totalValue,
        max: heatmapData.maxValue,
        avg: heatmapData.avgValue,
        active: heatmapData.activeDays,
      };
    }

    const value = selectedDayValue || 0;
    const active = value > 0 ? 1 : 0;
    return {
      periodLabel: `${t("dashboard.periodDay")}${selectedDayLabel ? ` (${selectedDayLabel})` : ""}`,
      total: value,
      max: value,
      avg: active ? value : 0,
      active,
    };
  }, [
    heatmapData.activeDays,
    heatmapData.avgValue,
    heatmapData.maxValue,
    heatmapData.totalValue,
    dateFrom,
    dateTo,
    selectedDateKey,
    selectedDayLabel,
    selectedDayValue,
  ]);

  const readingBooks = React.useMemo(
    () =>
      filteredBooks
        .filter(isReadingBook)
        .filter((book) => (activeBookIdsForDateFilter ? activeBookIdsForDateFilter.has(book.id) : true))
        .sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
        ),
    [activeBookIdsForDateFilter, filteredBooks],
  );

  const completedBooks = React.useMemo(
    () =>
      filteredBooks
        .filter(isCompletedBook)
        .filter((book) => (activeBookIdsForDateFilter ? activeBookIdsForDateFilter.has(book.id) : true))
        .sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
        ),
    [activeBookIdsForDateFilter, filteredBooks],
  );

  const boardBooks = React.useMemo(
    () => filteredBooks
      .filter((book) => (activeBookIdsForDateFilter ? activeBookIdsForDateFilter.has(book.id) : true))
      .sort((a, b) => a.title.localeCompare(b.title, sortLocale)),
    [activeBookIdsForDateFilter, filteredBooks, sortLocale],
  );

  const readingRightLabelByBookId = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const book of readingBooks) {
      const remainingMinutes = getRemainingMinutes(book);
      labels[book.id] = remainingMinutes === null ? t("dashboard.remainingUnknown") : formatRemaining(remainingMinutes, locale);
    }
    return labels;
  }, [locale, readingBooks]);

  const completedRightLabelByBookId = React.useMemo(() => {
    const labels: Record<string, string> = {};
    for (const book of completedBooks) {
      labels[book.id] = t("dashboard.completedLabel");
    }
    return labels;
  }, [completedBooks]);

  const rightDateByBookId = React.useMemo(() => {
    const dates: Record<string, string> = {};
    for (const book of [...readingBooks, ...completedBooks]) {
      dates[book.id] = formatShortDate(book.updated_at || book.created_at, locale);
    }
    return dates;
  }, [completedBooks, locale, readingBooks]);

  const selectBook = React.useCallback((bookId: string) => {
    setSelectedBookId(bookId);
    void plugin.openBookHighlights(bookId);
  }, [plugin]);

  const moveBook = React.useCallback(async (bookId: string, status: PlanningStatus) => {
    const previous = books.find((book) => book.id === bookId);
    if (!previous) return;
    const location = getReaderLocation(status);
    const optimistic = { ...previous, location, status };
    setBooks((current) => current.map((book) => book.id === bookId ? optimistic : book));
    try {
      await plugin.moveReaderDocument(bookId, location);
      loadData();
      new Notice(t("dashboard.moveSuccess", { location: t(
        status === "planned"
          ? "dashboard.readerLater"
          : status === "reading"
            ? "dashboard.readerInbox"
            : "dashboard.readerArchive",
      ) }));
    } catch (error) {
      setBooks((current) => current.map((book) => book.id === bookId ? previous : book));
      new Notice(t("dashboard.moveFailed", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [books, loadData, plugin]);

  return (
    <div className="readwise-dashboard-root">
      <div className="readwise-dashboard-top">
        <ReadwiseTagFilterBar
          allTags={allTags}
          selectedTags={selectedTags}
          onToggleTag={(tag) =>
            setSelectedTags((previous) =>
              previous.includes(tag) ? previous.filter((value) => value !== tag) : [...previous, tag],
            )
          }
        />

        <ReadwiseHeatmapPanel
          displayedWeeks={displayedWeeks}
          monthLabelByWeekIndex={monthLabelByWeekIndex}
          rangeStart={heatmapData.rangeStart}
          rangeEnd={heatmapData.rangeEnd}
          selectedDateKey={selectedDateKey}
          legendLabel={heatmapData.legendLabel}
          heatmapColors={heatmapColors}
          statsPanel={statsPanel}
          viewportRef={heatmapViewportRef}
          heatmapValueByDate={displayedHeatmapValueByDate}
          heatmapLevel={(value) => getHeatmapLevel(value, heatmapMode)}
          heatmapValueFormat={(value) => formatHeatmapValue(value, heatmapMode, locale)}
          onToggleDate={(dateKey) => {
            setSelectedDateKey((previous) => (previous === dateKey ? null : dateKey));
            setDateFrom("");
            setDateTo("");
            setSelectedBookId(null);
            setCompletedCollapsed(false);
          }}
        />
      </div>

      <div className="readwise-books-view-toolbar">
        <div className="readwise-date-range-filter" aria-label={t("dashboard.dateRange")}>
          <label>
            <span>{t("dashboard.dateFrom")}</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onClick={openDatePicker}
              onChange={(event) => {
                setDateFrom(event.currentTarget.value);
                setSelectedDateKey(null);
                setSelectedBookId(null);
              }}
            />
          </label>
          <label>
            <span>{t("dashboard.dateTo")}</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onClick={openDatePicker}
              onChange={(event) => {
                setDateTo(event.currentTarget.value);
                setSelectedDateKey(null);
                setSelectedBookId(null);
              }}
            />
          </label>
          <button
            type="button"
            className={`readwise-date-range-clear${dateFrom || dateTo ? "" : " is-hidden"}`}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            aria-label={t("dashboard.dateClear")}
            title={t("dashboard.dateClear")}
          >
            ×
          </button>
        </div>
        <div className="readwise-view-switch" role="group" aria-label={t("dashboard.viewMode")}>
          <button
            type="button"
            className={booksView === "list" ? "is-active" : ""}
            onClick={() => setBooksView("list")}
          >
            <span aria-hidden="true">☷</span>
            {t("dashboard.listView")}
          </button>
          <button
            type="button"
            className={booksView === "board" ? "is-active" : ""}
            onClick={() => setBooksView("board")}
          >
            <span aria-hidden="true">▥</span>
            {t("dashboard.boardView")}
          </button>
        </div>
      </div>

      {booksView === "board" ? (
        <ReadwisePlanningBoard
          books={boardBooks}
          selectedBookId={selectedBookId}
          selectedTags={selectedTags}
          sortLocale={sortLocale}
          collapsedGroupKeys={collapsedBoardGroups}
          onSelectBook={selectBook}
          onMoveBook={moveBook}
          onCollapsedGroupKeysChange={updateCollapsedBoardGroups}
        />
      ) : <>
      <ReadwiseBookSection
        title={t("dashboard.currentlyReading")}
        books={readingBooks}
        selectedBookId={selectedBookId}
        rightLabelByBookId={readingRightLabelByBookId}
        rightDateByBookId={rightDateByBookId}
        accentColor="#2a9a96"
        emptyText={t("dashboard.noActiveBooks")}
        showReset={!!selectedBookId}
        onReset={() => setSelectedBookId(null)}
        onToggleBook={selectBook}
      />

      <ReadwiseBookSection
        title={t("dashboard.completed")}
        books={completedBooks.slice(0, 50)}
        selectedBookId={selectedBookId}
        rightLabelByBookId={completedRightLabelByBookId}
        rightDateByBookId={rightDateByBookId}
        accentColor="#2a9a96"
        emptyText={t("dashboard.noCompletedBooks")}
        showReset={!!(selectedBookId && selectedBook && isCompletedBook(selectedBook))}
        onReset={() => setSelectedBookId(null)}
        onToggleBook={selectBook}
        collapsed={completedCollapsed}
        countLabel={`(${completedBooks.length})`}
        onToggleCollapsed={() => setCompletedCollapsed((value) => !value)}
      />
      </>}
    </div>
  );
};
