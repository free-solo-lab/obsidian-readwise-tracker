import * as React from "react";
import { t } from "../../i18n";

interface ReadwiseTagFilterBarProps {
  allTags: string[];
  selectedTags: string[];
  onToggleTag(tag: string): void;
  onReset(): void;
}

export const ReadwiseTagFilterBar: React.FC<ReadwiseTagFilterBarProps> = ({
  allTags,
  selectedTags,
  onToggleTag,
  onReset,
}) => {
  if (allTags.length === 0) {
    return null;
  }

  return (
    <div className="readwise-tag-filter-bar">
      <div className="readwise-tag-filter-list">
        {allTags.slice(0, 40).map((tag) => {
          const selected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              className={`readwise-tag-pill${selected ? " is-selected" : ""}`}
              onClick={() => onToggleTag(tag)}
              title={tag}
            >
              {tag}
            </button>
          );
        })}
      </div>
      {selectedTags.length > 0 ? (
        <button className="readwise-reset-button" onClick={onReset}>
          {t("tagFilter.reset")}
        </button>
      ) : null}
    </div>
  );
};
