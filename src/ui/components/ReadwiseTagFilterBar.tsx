import * as React from "react";
import { t } from "../../i18n";
import { collapsedTagCount } from "../tagFilterLayout";

interface ReadwiseTagFilterBarProps {
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
}

const DISCLOSURE_FALLBACK_WIDTH = 36;

/**
 * Tag pills folded to two rows with a "…" disclosure. The pills are measured on a
 * hidden copy of the full list, so the visible list never flickers while it is cut.
 */
export const ReadwiseTagFilterBar: React.FC<ReadwiseTagFilterBarProps> = ({
  allTags,
  selectedTags,
  onToggleTag,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(allTags.length);
  const measurements = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useLayoutEffect(() => {
    const element = measurements.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      const buttons = Array.from(element.querySelectorAll("button"));
      const disclosure = buttons.pop();
      const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
      const gap = parseFloat(styles?.columnGap || "6") || 0;
      setVisibleCount(
        collapsedTagCount(
          buttons.map((button) => button.getBoundingClientRect().width),
          width,
          gap,
          disclosure?.getBoundingClientRect().width || DISCLOSURE_FALLBACK_WIDTH,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [allTags, selectedTags]);

  if (!allTags.length) return null;
  const hasOverflow = visibleCount < allTags.length;
  const pillClass = (tag: string) =>
    `readwise-tag-pill${selectedTags.includes(tag) ? " is-selected" : ""}`;
  return (
    <div className="readwise-tag-filter-bar">
      <div
        className="readwise-tag-filter-list readwise-tag-measurements"
        ref={measurements}
        aria-hidden="true"
      >
        {allTags.map((tag) => (
          <button type="button" tabIndex={-1} key={tag} className={pillClass(tag)}>
            {tag}
          </button>
        ))}
        <button type="button" tabIndex={-1} className="readwise-tag-pill readwise-tags-disclosure">
          …
        </button>
      </div>
      <div className="readwise-tag-filter-list" id={listId}>
        {(expanded ? allTags : allTags.slice(0, visibleCount)).map((tag) => (
          <button
            type="button"
            key={tag}
            className={pillClass(tag)}
            onClick={() => onToggleTag(tag)}
            aria-pressed={selectedTags.includes(tag)}
            title={tag}
          >
            {tag}
          </button>
        ))}
        {hasOverflow && (
          <button
            type="button"
            className="readwise-tag-pill readwise-tags-disclosure"
            aria-label={t(expanded ? "tags.collapse" : "tags.expand")}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "↑" : "…"}
          </button>
        )}
      </div>
    </div>
  );
};
