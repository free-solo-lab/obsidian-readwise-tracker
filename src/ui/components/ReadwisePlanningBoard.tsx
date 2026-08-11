import * as React from "react";
import type { LocalBook, ReadingActivityDay } from "../../models/store";
import { t } from "../../i18n";
import {
  countPlanningBooksByStatus,
  getPlanningDirectionKey,
  getPlanningStatus,
  groupPlanningBooksByTag,
  orderPlanningTagGroups,
  type PlanningStatus,
} from "../planningBoard";
import { SortableDirectionHeader } from "./SortableDirectionHeader";
import { getBookInactivityDays } from "../dashboardHelpers";

interface ReadwisePlanningBoardProps {
  books: LocalBook[];
  selectedBookId: string | null;
  selectedTags: string[];
  sortLocale: string;
  focusTags: string[];
  directionOrder: string[];
  directionBookOrder: Record<string, string[]>;
  readingActivityByBook: Record<string, Record<string, ReadingActivityDay>>;
  onSelectBook: (bookId: string) => void;
  onMoveBook: (bookId: string, status: PlanningStatus) => Promise<void>;
  onFocusTagsChange: (tags: string[]) => void;
  onDirectionOrderChange: (directionKeys: string[]) => void;
}

const columns: Array<{
  status: PlanningStatus;
  label: "dashboard.boardToRead" | "dashboard.boardInProgress" | "dashboard.boardDone";
  readerLabel: "dashboard.readerInbox" | "dashboard.readerLater" | "dashboard.readerArchive";
}> = [
  { status: "planned", label: "dashboard.boardToRead", readerLabel: "dashboard.readerLater" },
  { status: "reading", label: "dashboard.boardInProgress", readerLabel: "dashboard.readerInbox" },
  { status: "completed", label: "dashboard.boardDone", readerLabel: "dashboard.readerArchive" },
];

function initials(book: LocalBook): string {
  return `${book.title || ""} ${book.author || ""}`
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "B";
}

const PlanningCard: React.FC<{
  book: LocalBook;
  selected: boolean;
  moving: boolean;
  inactivityDays: number | null;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onSelect: () => void;
}> = ({ book, selected, moving, inactivityDays, onDragStart, onDragEnd, onSelect }) => {
  const progress = Math.min(100, Math.max(0, book.reading_progress || 0));
  return (
    <button
      type="button"
      draggable={!moving}
      className={`readwise-planning-card${selected ? " is-selected" : ""}${moving ? " is-moving" : ""}`}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={moving ? undefined : onSelect}
    >
      <span className="readwise-planning-cover">
        {book.cover_url ? <img src={book.cover_url} alt="" /> : <span>{initials(book)}</span>}
      </span>
      <span className="readwise-planning-card-content">
        <span className="readwise-planning-card-title">{book.title}</span>
        <span className="readwise-planning-card-author">{book.author || t("dashboard.unknownAuthor")}</span>
        {inactivityDays !== null && inactivityDays > 14 ? (
          <span className="readwise-planning-stale-label">
            {t("dashboard.unreadDays", { days: inactivityDays })}
          </span>
        ) : null}
        <span className="readwise-planning-progress-row">
          <span className="readwise-planning-progress-track">
            <span style={{ width: `${progress}%` }} />
          </span>
          <span>{progress.toFixed(0)}%</span>
        </span>
      </span>
    </button>
  );
};

export const ReadwisePlanningBoard: React.FC<ReadwisePlanningBoardProps> = ({
  books,
  selectedBookId,
  selectedTags,
  sortLocale,
  focusTags,
  directionOrder,
  directionBookOrder,
  readingActivityByBook,
  onSelectBook,
  onMoveBook,
  onFocusTagsChange,
  onDirectionOrderChange,
}) => {
  const [draggedBookId, setDraggedBookId] = React.useState<string | null>(null);
  const [dropStatus, setDropStatus] = React.useState<PlanningStatus | null>(null);
  const [movingBookId, setMovingBookId] = React.useState<string | null>(null);
  const groups = React.useMemo(
    () => orderPlanningTagGroups(
      groupPlanningBooksByTag(books, sortLocale, selectedTags),
      directionOrder,
      directionBookOrder,
      sortLocale,
    ),
    [books, directionBookOrder, directionOrder, selectedTags, sortLocale],
  );
  const orderedDirectionKeys = React.useMemo(
    () => groups.map((group) => getPlanningDirectionKey(group.tag)),
    [groups],
  );
  const counts = React.useMemo(() => countPlanningBooksByStatus(books), [books]);
  const inactivityDaysByBookId = React.useMemo(() => {
    const result: Record<string, number> = {};
    const now = new Date();
    for (const book of books) {
      if (getPlanningStatus(book) !== "reading") continue;
      const days = getBookInactivityDays(book, readingActivityByBook, now);
      if (days !== null && days > 14) result[book.id] = days;
    }
    return result;
  }, [books, readingActivityByBook]);

  if (books.length === 0) return <div className="readwise-empty-state">{t("dashboard.boardEmpty")}</div>;

  return (
    <div className="readwise-planning-board">
      <div className="readwise-planning-columns-header">
        {columns.map((column) => (
          <div key={column.status} className={`readwise-planning-column-title is-${column.status}`}>
            <span className="readwise-planning-status-dot" />
            <span className="readwise-planning-column-label">
              <span>{t(column.label)}</span>
              <span>{t(column.readerLabel)}</span>
            </span>
            <span className="readwise-planning-count">{counts[column.status]}</span>
          </div>
        ))}
      </div>

      {groups.map((group) => {
        const groupKey = getPlanningDirectionKey(group.tag);
        const collapsed = !focusTags.includes(groupKey);
        const groupLabel = group.tag || t("dashboard.boardNoTag");
        const groupCounts = countPlanningBooksByStatus(group.books);
        return (
          <section key={groupKey} className={`readwise-planning-tag-group${collapsed ? " is-collapsed" : " is-focus"}`}>
            <SortableDirectionHeader
              className="readwise-planning-tag-heading"
              directionKey={groupKey}
              orderedDirectionKeys={orderedDirectionKeys}
              expanded={!collapsed}
              title={t(collapsed ? "stats.expand" : "stats.collapse")}
              onOrderChange={onDirectionOrderChange}
              onToggle={() => {
                onFocusTagsChange(
                  collapsed
                    ? [...focusTags, groupKey]
                    : focusTags.filter((key) => key !== groupKey),
                );
                setDropStatus(null);
              }}
            >
              {columns.map((column, index) => (
                <span key={column.status} className="readwise-planning-tag-heading-cell">
                  {index === 0 ? (
                    <span className="readwise-planning-tag-label">
                      <span className="readwise-gantt-drag" aria-hidden="true">⋮⋮</span>
                      <span className="readwise-planning-tag-chevron" aria-hidden="true">
                        {collapsed ? "▶" : "▼"}
                      </span>
                      <span className="readwise-planning-tag-icon">#</span>
                      <span>{groupLabel}</span>
                    </span>
                  ) : null}
                  <span className="readwise-planning-count">{groupCounts[column.status]}</span>
                </span>
              ))}
            </SortableDirectionHeader>
            {collapsed ? null : (
              <div className="readwise-planning-columns">
                {columns.map((column) => (
                  <div
                    key={column.status}
                    className={`readwise-planning-column${dropStatus === column.status ? " is-drop-target" : ""}`}
                    onDragEnter={(event) => {
                      if (!draggedBookId) return;
                      event.preventDefault();
                      setDropStatus(column.status);
                    }}
                    onDragOver={(event) => {
                      if (!draggedBookId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const bookId = draggedBookId || event.dataTransfer.getData("text/plain");
                      setDraggedBookId(null);
                      setDropStatus(null);
                      if (!bookId) return;
                      const book = books.find((candidate) => candidate.id === bookId);
                      if (!book || getPlanningStatus(book) === column.status) return;
                      setMovingBookId(bookId);
                      void onMoveBook(bookId, column.status).finally(() => setMovingBookId(null));
                    }}
                  >
                    {group.books
                      .filter((book) => getPlanningStatus(book) === column.status)
                      .map((book) => (
                        <PlanningCard
                          key={book.id}
                          book={book}
                          selected={selectedBookId === book.id}
                          moving={movingBookId === book.id}
                          inactivityDays={inactivityDaysByBookId[book.id] ?? null}
                          onDragStart={(event) => {
                            setDraggedBookId(book.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", book.id);
                          }}
                          onDragEnd={() => {
                            setDraggedBookId(null);
                            setDropStatus(null);
                          }}
                          onSelect={() => onSelectBook(book.id)}
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};
