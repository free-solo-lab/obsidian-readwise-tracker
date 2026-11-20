import * as React from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { WorkspaceFocus, WorkspacePanel } from "./focus";
import { preserveViewportOnResize } from "./streamLayout";
import { startTimer, stopTimer } from "../utils/timers";

export interface StreamAnchor {
  key: string;
  delta: number;
}
interface StreamProps<T> {
  panel: WorkspacePanel;
  coordinator: WorkspaceFocus;
  items: T[];
  itemKey: (item: T) => string;
  active?: string;
  navigationKey?: string;
  editing?: string;
  initialOffset?: number;
  /** The block that was at the top and how far into it, saved with the offset: pixels alone point at another block once sizes are re-measured. */
  initialAnchor?: StreamAnchor;
  onPosition: (offset: number, anchor?: StreamAnchor) => void;
  onFocus: (item: T) => void;
  onLead?: () => void;
  children: (item: T) => React.ReactNode;
}
const RESTORE_GRACE_MS = 4000;

/** Room above the first and below the last note so that any of them can sit in the middle. */
export function edgePadding(viewport: number): number {
  return Math.max(64, viewport / 2 - 40);
}

export function VirtualStream<T>({
  panel,
  coordinator,
  items,
  itemKey,
  active,
  navigationKey,
  editing,
  initialOffset,
  initialAnchor,
  onPosition,
  onFocus,
  onLead,
  children,
}: StreamProps<T>): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState(0);
  const centered = panel !== "source",
    gap = panel === "highlights" ? 104 : panel === "source" ? 0 : 64;
  const count = React.useRef(items.length);
  count.current = items.length;
  const editingIndex = items.findIndex((item) => itemKey(item) === editing);
  const keys = React.useMemo(
    () => new Map(items.map((item, index) => [itemKey(item), index])),
    [items, itemKey],
  );
  const activeIndex = active === undefined ? -1 : (keys.get(active) ?? -1);
  const getItemKey = React.useCallback(
    (index: number) => itemKey(items[index]),
    [items, itemKey],
  );
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => element.current,
    estimateSize: () => (panel === "source" ? 160 : 250),
    getItemKey,
    overscan: 5,
    initialOffset,
    gap,
    // Fixed by the viewport alone: sized from the edge notes' measured heights, the padding
    // changed while they loaded or were edited, and the centred note jumped to the bottom.
    paddingStart: centered ? edgePadding(viewport) : 24,
    paddingEnd: centered ? edgePadding(viewport) : 24,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(editingIndex >= 0 ? [editingIndex] : []),
        ]),
      ].sort((a, b) => a - b),
  });
  virtual.shouldAdjustScrollPositionOnItemSizeChange = preserveViewportOnResize;
  const rows = React.useRef(new Set<HTMLElement>());
  const observerRef = React.useRef<ResizeObserver>();
  const measured = React.useRef(new WeakMap<HTMLElement, number>());
  const following = React.useRef<{
    index: number;
    armed: boolean;
  }>();
  const correction = React.useRef<ReturnType<typeof setTimeout>>();
  const correct = React.useCallback(() => {
    if (!following.current?.armed || coordinator.accepts(panel)) return;
    if (correction.current) stopTimer(correction.current);
    correction.current = startTimer(() => {
      const target = following.current,
        el = element.current;
      if (!target?.armed || !el || coordinator.accepts(panel)) return;
      const offset = virtual.getOffsetForIndex(target.index, "center")?.[0];
      if (offset !== undefined && Math.abs(offset - el.scrollTop) > 1)
        virtual.scrollToIndex(target.index, {
          align: "center",
          behavior: "auto",
        });
    }, 80);
  }, [coordinator, panel, virtual]);
  const measure = React.useCallback(
    (row: HTMLElement) => {
      if (!row.isConnected) return;
      // MarkdownRenderer is asynchronous. Its empty mount is not the block's height.
      if (row.querySelector('[data-rwt-render-state="pending"]')) return;
      const index = Number(row.dataset.index),
        height = row.getBoundingClientRect().height;
      if (!Number.isInteger(index) || index >= count.current || height <= 0)
        return;
      const known = virtual.itemSizeCache.get(
        virtual.options.getItemKey(index),
      );
      if (
        known !== undefined &&
        height < known &&
        Array.from(row.querySelectorAll("img")).some(
          (img) => !img.complete && !img.naturalWidth,
        )
      )
        return;
      const previous = measured.current.get(row);
      measured.current.set(row, height);
      virtual.resizeItem(index, height);
      if (previous === undefined || Math.abs(previous - height) > 0.5)
        correct();
    },
    [virtual, correct],
  );
  const rowRef = React.useCallback(
    (row: HTMLDivElement | null) => {
      if (row) {
        rows.current.add(row);
        observerRef.current?.observe(row);
        measure(row);
      } else
        for (const old of rows.current)
          if (!old.isConnected) {
            observerRef.current?.unobserve(old);
            rows.current.delete(old);
          }
    },
    [measure],
  );
  React.useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) {
          setViewport((old) =>
            old === el.clientHeight ? old : el.clientHeight,
          );
          correct();
        } else measure(entry.target as HTMLElement);
      }
    });
    const ready = (event: Event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        ".rwt-stream-item",
      );
      if (row) measure(row);
    };
    el.addEventListener("rwt-markdown-ready", ready);
    observerRef.current = observer;
    setViewport(el.clientHeight);
    observer.observe(el);
    for (const row of rows.current) observer.observe(row);
    return () => {
      observer.disconnect();
      el.removeEventListener("rwt-markdown-ready", ready);
      observerRef.current = undefined;
    };
  }, [measure, correct]);
  const focus = React.useRef(onFocus);
  focus.current = onFocus;
  const positions = React.useRef(onPosition);
  positions.current = onPosition;
  const state = React.useRef({ items, itemKey, active });
  state.current = { items, itemKey, active };
  const last = React.useRef("");
  // A reopened pane keeps its saved place: following the focus would jump it to the
  // note of the focused highlight while notes are still loading in.
  const savedPlace = React.useRef(
    !!initialAnchor || (initialOffset !== undefined && initialOffset > 0)
      ? Date.now() + RESTORE_GRACE_MS
      : 0,
  );
  const restoring = React.useRef(!!initialAnchor);
  React.useEffect(() => {
    const el = element.current;
    if (!el || activeIndex < 0 || coordinator.accepts(panel)) return;
    if (coordinator.touches === 0 && (restoring.current || Date.now() < savedPlace.current)) return;
    const targetState = { index: activeIndex, armed: false };
    following.current = targetState;
    let timer: ReturnType<typeof setTimeout> | undefined,
      settle: ReturnType<typeof setTimeout> | undefined,
      frame = 0;
    const arm = () => {
      settle = startTimer(() => {
        if (following.current !== targetState) return;
        targetState.armed = true;
        correct();
      }, 300);
    };
    timer = startTimer(() => {
      if (coordinator.accepts(panel)) return;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const target =
        virtual.getOffsetForIndex(activeIndex, "center")?.[0] ?? el.scrollTop;
      if (!reduced && Math.abs(target - el.scrollTop) > el.clientHeight * 2) {
        el.classList.add("is-seeking");
        timer = startTimer(() => {
          if (!coordinator.accepts(panel))
            virtual.scrollToIndex(activeIndex, {
              align: "center",
              behavior: "auto",
            });
          frame = window.requestAnimationFrame(() =>
            el.classList.remove("is-seeking"),
          );
          arm();
        }, 70);
      } else {
        virtual.scrollToIndex(activeIndex, {
          align: "center",
          behavior: reduced ? "auto" : "smooth",
        });
        arm();
      }
    }, 40);
    return () => {
      if (timer) stopTimer(timer);
      if (settle) stopTimer(settle);
      if (correction.current) stopTimer(correction.current);
      following.current = undefined;
      virtual.cancelScroll();
      window.cancelAnimationFrame(frame);
      el.classList.remove("is-seeking");
    };
  }, [
    activeIndex,
    active,
    navigationKey,
    panel,
    coordinator,
    virtual,
    correct,
  ]);
  const keyIndex = React.useRef(keys);
  keyIndex.current = keys;
  // Reopened blocks are re-measured while loading, so the saved pixel offset drifts.
  // Return to the saved block until the layout settles or the reader scrolls.
  React.useLayoutEffect(() => {
    const el = element.current,
      anchor = initialAnchor;
    if (!el || !anchor) return;
    let stopped = false,
      stable = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const stop = () => {
      stopped = true;
      restoring.current = false;
    };
    const events = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const name of events) el.addEventListener(name, stop, { passive: true });
    const tick = () => {
      if (stopped) return;
      const index = keyIndex.current.get(anchor.key),
        base =
          index === undefined
            ? undefined
            : virtual.getOffsetForIndex(index, "start")?.[0];
      if (base !== undefined) {
        const target = base + anchor.delta;
        if (Math.abs(target - el.scrollTop) > 1) {
          el.scrollTop = target;
          stable = 0;
        } else stable++;
      }
      // Items may still be loading: an unknown block is waited for, not given up on.
      if (stable >= 4 || Date.now() - started > RESTORE_GRACE_MS) {
        stop();
        schedule.current();
        return;
      }
      timer = startTimer(tick, 60);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) stopTimer(timer);
      for (const name of events) el.removeEventListener(name, stop);
    };
    // Only on mount: later scrolling is the reader's.
  }, []);
  const schedule = React.useRef<() => void>(() => undefined);
  React.useEffect(() => {
    const el = element.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!restoring.current) {
        const top = el.scrollTop,
          first = virtual
            .getVirtualItems()
            .find((item) => item.end > top + 1);
        positions.current(
          top,
          first ? { key: String(first.key), delta: top - first.start } : undefined,
        );
      }
      if (restoring.current || !coordinator.accepts(panel)) return;
      const center = el.scrollTop + el.clientHeight * 0.5,
        visible = virtual.getVirtualItems();
      const chosen =
        visible.find((item) => item.start <= center && item.end >= center) ||
        visible.reduce<(typeof visible)[number] | undefined>(
          (best, item) =>
            !best ||
            Math.abs(item.start + item.size / 2 - center) <
              Math.abs(best.start + best.size / 2 - center)
              ? item
              : best,
          undefined,
        );
      const current = state.current;
      if (!chosen || !current.items[chosen.index]) return;
      const key = current.itemKey(current.items[chosen.index]),
        old = visible.find((item) => item.key === last.current);
      if (
        old &&
        key !== last.current &&
        center >= old.start - 24 &&
        center <= old.end + 24
      )
        return;
      if (key !== last.current || key !== current.active) {
        last.current = key;
        focus.current(current.items[chosen.index]);
      }
    };
    const scroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule.current = scroll;
    el.addEventListener("scroll", scroll, { passive: true });
    scroll();
    return () => {
      el.removeEventListener("scroll", scroll);
      window.cancelAnimationFrame(frame);
      schedule.current = () => undefined;
    };
  }, [coordinator, panel, virtual, items.length, viewport]);
  const lead = () => {
    following.current = undefined;
    if (correction.current) stopTimer(correction.current);
    const el = element.current;
    // Cancel the virtualizer's target and the browser's running smooth animation.
    // Starting another virtual scroll here would keep a command alive under user input.
    virtual.cancelScroll();
    if (el && !coordinator.accepts(panel))
      el.scrollTo({ top: el.scrollTop, behavior: "auto" });
    coordinator.lead(panel);
    onLead?.();
    el?.classList.remove("is-seeking");
    schedule.current();
  };
  const mediaChanged = (event: React.SyntheticEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      ".rwt-stream-item",
    );
    if (row) measure(row);
    correct();
  };
  return (
    <div
      ref={element}
      className="rwt-stream"
      data-panel={panel}
      tabIndex={0}
      onWheel={lead}
      onTouchStart={lead}
      onPointerDown={lead}
      onLoadCapture={mediaChanged}
      onErrorCapture={mediaChanged}
      onKeyDown={(event) => {
        if (
          [
            "ArrowDown",
            "ArrowUp",
            "PageDown",
            "PageUp",
            "Home",
            "End",
            " ",
          ].includes(event.key)
        )
          lead();
      }}
    >
      <div
        className="rwt-stream-space"
        style={{ height: virtual.getTotalSize() }}
      >
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={rowRef}
            className="rwt-stream-item"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {children(items[row.index])}
          </div>
        ))}
      </div>
    </div>
  );
}
