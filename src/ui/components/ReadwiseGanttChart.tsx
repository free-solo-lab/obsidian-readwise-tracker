import * as React from "react";
import type { LocalBook, ReadingActivityDay } from "../../models/store";
import { t } from "../../i18n";
import { formatDurationCompact, type SupportedLocale } from "../../i18n/messages";
import {
  addDaysToDateKey,
  buildGanttSchedule,
  getAverageDailyReadingMinutes,
  type GanttPlanItem,
} from "../ganttPlanning";
import {
  getPlanningDirectionKey,
  getPlanningStatus,
  groupPlanningBooksByTag,
  moveItemBefore,
  orderPlanningTagGroups,
} from "../planningBoard";
import { SortableDirectionHeader } from "./SortableDirectionHeader";

interface ReadwiseGanttChartProps {
  books: LocalBook[];
  readingActivity: Record<string, ReadingActivityDay>;
  locale: SupportedLocale;
  dateLocale: string;
  sortLocale: string;
  selectedBookId: string | null;
  startDate: string;
  dailyMinutes: number;
  focusTags: string[];
  directionOrder: string[];
  directionBookOrder: Record<string, string[]>;
  onStartDateChange: (value: string) => void;
  onDailyMinutesChange: (value: number) => void;
  onFocusTagsChange: (tags: string[]) => void;
  onDirectionOrderChange: (directionKeys: string[]) => void;
  onDirectionBookOrderChange: (directionKey: string, bookIds: string[]) => void;
  onSelectBook: (bookId: string) => void;
}

const DAY_WIDTH = 28;
const MIN_TIMELINE_DAYS = 35;

function formatDate(dateKey: string, locale: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

const GanttBookRow: React.FC<{
  book: LocalBook;
  item: GanttPlanItem | undefined;
  selected: boolean;
  dragging: boolean;
  timelineWidth: number;
  locale: SupportedLocale;
  dateLocale: string;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}> = ({
  book,
  item,
  selected,
  dragging,
  timelineWidth,
  locale,
  dateLocale,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) => {
  const status = getPlanningStatus(book);
  return (
    <div
      className={`readwise-gantt-row${dragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className={`readwise-gantt-book-cell${selected ? " is-selected" : ""}`}>
        <button type="button" className="readwise-gantt-book" onClick={onSelect}>
          <span className="readwise-gantt-drag" aria-hidden="true">⋮⋮</span>
          <span className="readwise-gantt-book-copy">
            <span>{book.title}</span>
            <span>
              {t(status === "reading" ? "dashboard.boardInProgress" : "dashboard.boardToRead")}
              {" · "}
              {item
                ? `${formatDurationCompact(item.remainingMinutes, locale)} · ${item.durationDays} ${t("dashboard.ganttDays")}`
                : t("dashboard.ganttUnknownDuration")}
            </span>
          </span>
        </button>
      </div>
      <div className="readwise-gantt-timeline" style={{ width: `${timelineWidth}px` }}>
        {item ? (
          <button
            type="button"
            className={`readwise-gantt-bar${status === "reading" ? " is-reading" : ""}`}
            style={{
              left: `${item.startOffset * DAY_WIDTH + 2}px`,
              width: `${Math.max(24, item.durationDays * DAY_WIDTH - 4)}px`,
            }}
            title={`${formatDate(item.startDate, dateLocale)} — ${formatDate(item.endDate, dateLocale)}`}
            onClick={onSelect}
          >
            <span>{formatDate(item.startDate, dateLocale)} — {formatDate(item.endDate, dateLocale)}</span>
          </button>
        ) : (
          <span className="readwise-gantt-unscheduled">{t("dashboard.ganttUnknownDuration")}</span>
        )}
      </div>
    </div>
  );
};

export const ReadwiseGanttChart: React.FC<ReadwiseGanttChartProps> = ({
  books,
  readingActivity,
  locale,
  dateLocale,
  sortLocale,
  selectedBookId,
  startDate,
  dailyMinutes,
  focusTags,
  directionOrder,
  directionBookOrder,
  onStartDateChange,
  onDailyMinutesChange,
  onFocusTagsChange,
  onDirectionOrderChange,
  onDirectionBookOrderChange,
  onSelectBook,
}) => {
  const [draggedBookId, setDraggedBookId] = React.useState<string | null>(null);
  const [draggedBookDirectionKey, setDraggedBookDirectionKey] = React.useState<string | null>(null);
  const averageMinutes = React.useMemo(
    () => getAverageDailyReadingMinutes(readingActivity),
    [readingActivity],
  );
  const effectiveDailyMinutes = Math.max(1, dailyMinutes || Math.round(averageMinutes) || 30);
  const schedule = React.useMemo(
    () => buildGanttSchedule(books, startDate, effectiveDailyMinutes),
    [books, effectiveDailyMinutes, startDate],
  );
  const scheduleByBookId = React.useMemo(
    () => new Map(schedule.items.map((item) => [item.book.id, item])),
    [schedule.items],
  );
  const groups = React.useMemo(
    () => orderPlanningTagGroups(
      groupPlanningBooksByTag(books, sortLocale),
      directionOrder,
      directionBookOrder,
      sortLocale,
    ),
    [books, directionBookOrder, directionOrder, sortLocale],
  );
  const orderedDirectionKeys = React.useMemo(
    () => groups.map((group) => getPlanningDirectionKey(group.tag)),
    [groups],
  );
  const timelineDays = Math.max(MIN_TIMELINE_DAYS, schedule.totalDays + 2);
  const timelineWidth = timelineDays * DAY_WIDTH;
  const weekMarkers = Array.from({ length: Math.ceil(timelineDays / 7) }, (_, index) => index * 7);

  if (books.length === 0) {
    return <div className="readwise-empty-state">{t("dashboard.ganttEmpty")}</div>;
  }

  return (
    <div className="readwise-gantt">
      <div className="readwise-gantt-controls">
        <label>
          <span>{t("dashboard.ganttStart")}</span>
          <input
            type="date"
            value={startDate}
            onClick={(event) => {
              const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
              input.showPicker?.();
            }}
            onChange={(event) => onStartDateChange(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>{t("dashboard.ganttDailyMinutes")}</span>
          <input
            type="number"
            min="1"
            max="1440"
            value={effectiveDailyMinutes}
            onChange={(event) => onDailyMinutesChange(Math.max(1, Number(event.currentTarget.value) || 1))}
          />
        </label>
        <span className="readwise-gantt-average">
          {t("dashboard.ganttAverage", { minutes: Math.round(averageMinutes || 0) })}
        </span>
      </div>

      <div className="readwise-gantt-scroll">
        <div className="readwise-gantt-header readwise-gantt-row">
          <div className="readwise-gantt-book-heading">{t("dashboard.ganttBook")}</div>
          <div className="readwise-gantt-timeline" style={{ width: `${timelineWidth}px` }}>
            {weekMarkers.map((offset) => (
              <span key={offset} className="readwise-gantt-date-marker" style={{ left: `${offset * DAY_WIDTH}px` }}>
                {formatDate(addDaysToDateKey(startDate, offset), dateLocale)}
              </span>
            ))}
          </div>
        </div>

        {groups.map((group) => {
          const focusKey = getPlanningDirectionKey(group.tag);
          const focused = focusTags.includes(focusKey);
          return (
            <React.Fragment key={focusKey}>
            <div className={`readwise-gantt-tag-row readwise-gantt-row${focused ? " is-focus" : ""}`}>
              <SortableDirectionHeader
                className="readwise-gantt-tag-heading"
                directionKey={focusKey}
                orderedDirectionKeys={orderedDirectionKeys}
                expanded={focused}
                title={t(focused ? "stats.collapse" : "stats.expand")}
                onOrderChange={onDirectionOrderChange}
                onToggle={() => {
                  onFocusTagsChange(
                    focused ? focusTags.filter((value) => value !== focusKey) : [...focusTags, focusKey],
                  );
                }}
              >
                <span className="readwise-gantt-drag" aria-hidden="true">⋮⋮</span>
                <span className="readwise-planning-tag-chevron" aria-hidden="true">
                  {focused ? "▼" : "▶"}
                </span>
                <span className="readwise-planning-tag-icon">#</span>
                <span>{group.tag || t("dashboard.boardNoTag")}</span>
                <span className="readwise-planning-count">{group.books.length}</span>
              </SortableDirectionHeader>
              <div className="readwise-gantt-timeline" style={{ width: `${timelineWidth}px` }} />
            </div>
              {focused ? group.books.map((book) => (
                <GanttBookRow
                  key={book.id}
                  book={book}
                  item={scheduleByBookId.get(book.id)}
                  selected={selectedBookId === book.id}
                  dragging={draggedBookId === book.id}
                  timelineWidth={timelineWidth}
                  locale={locale}
                  dateLocale={dateLocale}
                  onSelect={() => onSelectBook(book.id)}
                  onDragStart={(event) => {
                    setDraggedBookId(book.id);
                    setDraggedBookDirectionKey(focusKey);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", book.id);
                  }}
                  onDragEnd={() => {
                    setDraggedBookId(null);
                    setDraggedBookDirectionKey(null);
                  }}
                  onDragOver={(event) => {
                    if (
                      draggedBookId &&
                      draggedBookDirectionKey === focusKey &&
                      draggedBookId !== book.id
                    ) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = draggedBookId || event.dataTransfer.getData("text/plain");
                    setDraggedBookId(null);
                    setDraggedBookDirectionKey(null);
                    if (!sourceId || draggedBookDirectionKey !== focusKey || sourceId === book.id) return;
                    onDirectionBookOrderChange(
                      focusKey,
                      moveItemBefore(group.books.map((candidate) => candidate.id), sourceId, book.id),
                    );
                  }}
                />
              )) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
