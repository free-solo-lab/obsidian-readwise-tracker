import * as React from "react";
import type { LocalBook } from "../../models/store";
import { ReadwiseBookCard } from "./ReadwiseBookCard";
import { t } from "../../i18n";

interface ReadwiseBookSectionProps {
  title: string;
  books: LocalBook[];
  selectedBookId: string | null;
  rightLabelByBookId: Record<string, string>;
  rightDateByBookId: Record<string, string>;
  accentColor: string;
  emptyText: string;
  showReset: boolean;
  onReset: () => void;
  onToggleBook: (bookId: string) => void;
  collapsed?: boolean;
  countLabel?: string;
  onToggleCollapsed?: () => void;
}

export const ReadwiseBookSection: React.FC<ReadwiseBookSectionProps> = ({
  title,
  books,
  selectedBookId,
  rightLabelByBookId,
  rightDateByBookId,
  accentColor,
  emptyText,
  showReset,
  onReset,
  onToggleBook,
  collapsed = false,
  countLabel,
  onToggleCollapsed,
}) => (
  <div className="readwise-book-section">
    <div className="readwise-book-section-header">
      {onToggleCollapsed ? (
        <div
          role="button"
          tabIndex={0}
          className="readwise-section-toggle"
          onClick={onToggleCollapsed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              onToggleCollapsed();
            }
          }}
        >
          <span>{collapsed ? "▶" : "▼"}</span>
          <span>{title}</span>
          {countLabel ? <span className="readwise-section-count">{countLabel}</span> : null}
        </div>
      ) : (
        <h2 className="readwise-book-section-title">{title}</h2>
      )}

      <button
        className={`readwise-reset-button${showReset ? "" : " is-hidden"}`}
        type="button"
        onClick={showReset ? onReset : undefined}
        disabled={!showReset}
        aria-hidden={!showReset}
        tabIndex={showReset ? 0 : -1}
      >
        {t("bookSection.showAll")}
      </button>
    </div>

    {collapsed ? null : books.length === 0 ? (
      <div className="readwise-empty-state">{emptyText}</div>
    ) : (
      <div className="readwise-book-list">
        {books.map((book) => (
          <ReadwiseBookCard
            key={book.id}
            book={book}
            progress={Math.min(100, Math.max(0, book.reading_progress || 0))}
            rightLabel={rightLabelByBookId[book.id] || "—"}
            rightDate={rightDateByBookId[book.id] || ""}
            accentColor={accentColor}
            isSelected={selectedBookId === book.id}
            onToggle={() => onToggleBook(book.id)}
            author={book.author}
          />
        ))}
      </div>
    )}
  </div>
);
