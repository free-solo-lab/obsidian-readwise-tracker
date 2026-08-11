import * as React from "react";
import { moveItemBefore } from "../planningBoard";

const DIRECTION_DRAG_TYPE = "application/x-readwise-direction";

interface SortableDirectionHeaderProps {
  className: string;
  directionKey: string;
  orderedDirectionKeys: string[];
  expanded: boolean;
  title: string;
  onToggle: () => void;
  onOrderChange: (directionKeys: string[]) => void;
  children: React.ReactNode;
}

export const SortableDirectionHeader: React.FC<SortableDirectionHeaderProps> = ({
  className,
  directionKey,
  orderedDirectionKeys,
  expanded,
  title,
  onToggle,
  onOrderChange,
  children,
}) => {
  const suppressClick = React.useRef(false);

  return (
    <button
      type="button"
      className={className}
      draggable
      aria-expanded={expanded}
      title={title}
      onDragStart={(event) => {
        suppressClick.current = true;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DIRECTION_DRAG_TYPE, directionKey);
      }}
      onDragEnd={() => {
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DIRECTION_DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceKey = event.dataTransfer.getData(DIRECTION_DRAG_TYPE);
        if (!sourceKey || sourceKey === directionKey) return;
        onOrderChange(moveItemBefore(orderedDirectionKeys, sourceKey, directionKey));
      }}
      onClick={() => {
        if (!suppressClick.current) onToggle();
      }}
    >
      {children}
    </button>
  );
};
