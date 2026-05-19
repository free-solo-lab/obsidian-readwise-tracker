import * as React from "react";
import type { LocalBook } from "../../models/store";

interface ReadwiseBookCardProps {
  book: LocalBook;
  progress: number;
  rightLabel: string;
  rightDate: string;
  accentColor: string;
  isSelected: boolean;
  onToggle(): void;
  author?: string;
}

function getBookPlaceholderLabel(book: LocalBook): string {
  const source = `${book.title || ""} ${book.author || ""}`.trim();
  const letters = source
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "B";
}

export const ReadwiseBookCard: React.FC<ReadwiseBookCardProps> = ({
  book,
  progress,
  rightLabel,
  rightDate,
  accentColor,
  isSelected,
  onToggle,
  author,
}) => (
  <div className={`readwise-book-card${isSelected ? " is-selected" : ""}`} onClick={onToggle}>
    <div className="readwise-book-cover">
      {book.cover_url ? (
        <img src={book.cover_url} alt={book.title} className="readwise-book-cover-image" />
      ) : (
        <span className="readwise-book-cover-placeholder">{getBookPlaceholderLabel(book)}</span>
      )}
    </div>

    <div className="readwise-book-card-body">
      <div className="readwise-book-card-header">
        <div className="readwise-book-card-title">{book.title}</div>
        <div className="readwise-book-card-date">{rightDate}</div>
      </div>
      <div className="readwise-book-card-author">{author || ""}</div>

      <div className="readwise-book-progress">
        <div className="readwise-book-progress-labels">
          <div>{progress.toFixed(1)}%</div>
          <div className="readwise-book-progress-right">{rightLabel}</div>
        </div>
        <div className="readwise-book-progress-bar">
          <div className="readwise-book-progress-fill" style={{ width: `${progress}%`, background: accentColor }} />
        </div>
      </div>
    </div>
  </div>
);
