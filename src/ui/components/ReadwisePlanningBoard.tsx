import * as React from "react";
import type { LocalBook } from "../../models/store";
import { t } from "../../i18n";
import { getPlanningStatus, groupPlanningBooksByTag, type PlanningStatus } from "../planningBoard";

interface ReadwisePlanningBoardProps {
  books: LocalBook[];
  selectedBookId: string | null;
  selectedTags: string[];
  sortLocale: string;
  collapsedGroupKeys: string[];
  onSelectBook(bookId: string): void;
  onMoveBook(bookId: string, status: PlanningStatus): Promise<void>;
  onCollapsedGroupKeysChange(groupKeys: string[]): void;
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
  onDragStart(event: React.DragEvent<HTMLButtonElement>): void;
  onDragEnd(): void;
  onSelect(): void;
}> = ({ book, selected, moving, onDragStart, onDragEnd, onSelect }) => {
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
  collapsedGroupKeys,
  onSelectBook,
  onMoveBook,
  onCollapsedGroupKeysChange,
}) => {
  const [draggedBookId, setDraggedBookId] = React.useState<string | null>(null);
  const [dropStatus, setDropStatus] = React.useState<PlanningStatus | null>(null);
  const [movingBookId, setMovingBookId] = React.useState<string | null>(null);
  const collapsedGroups = React.useMemo(() => new Set(collapsedGroupKeys), [collapsedGroupKeys]);
  const groups = React.useMemo(
    () => groupPlanningBooksByTag(books, sortLocale, selectedTags),
    [books, selectedTags, sortLocale],
  );
  const counts = React.useMemo(() => {
    const result: Record<PlanningStatus, number> = { planned: 0, reading: 0, completed: 0 };
    for (const book of books) result[getPlanningStatus(book)] += 1;
    return result;
  }, [books]);

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
        const groupKey = JSON.stringify(group.tag);
        const collapsed = collapsedGroups.has(groupKey);
        const groupLabel = group.tag || t("dashboard.boardNoTag");
        return (
          <section key={groupKey} className={`readwise-planning-tag-group${collapsed ? " is-collapsed" : ""}`}>
            <button
              type="button"
              className="readwise-planning-tag-heading"
              aria-expanded={!collapsed}
              title={t(collapsed ? "stats.expand" : "stats.collapse")}
              onClick={() => {
                onCollapsedGroupKeysChange(
                  collapsed
                    ? collapsedGroupKeys.filter((key) => key !== groupKey)
                    : [...collapsedGroupKeys, groupKey],
                );
                setDropStatus(null);
              }}
            >
              <span className="readwise-planning-tag-chevron" aria-hidden="true">
                {collapsed ? "▶" : "▼"}
              </span>
              <span className="readwise-planning-tag-icon">#</span>
              <span>{groupLabel}</span>
              <span className="readwise-planning-count">{group.books.length}</span>
            </button>
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
