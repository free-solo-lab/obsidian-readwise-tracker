import test from "node:test";
import assert from "node:assert/strict";
import { Virtualizer } from "@tanstack/virtual-core";
import { preserveViewportOnResize } from "../../src/workspace/streamLayout";

function stream() {
  let offset = 10_000;
  let report: (offset: number, scrolling: boolean) => void = () => undefined;
  const element = {
    ownerDocument: { defaultView: null },
  } as unknown as HTMLElement;
  const virtual = new Virtualizer<HTMLElement, HTMLElement>({
    count: 100,
    getScrollElement: () => element,
    estimateSize: () => 200,
    observeElementRect: (_instance, callback) => {
      callback({ width: 600, height: 800 });
      return () => undefined;
    },
    observeElementOffset: (_instance, callback) => {
      report = callback;
      callback(offset, false);
      return () => undefined;
    },
    scrollToFn: (value, options) => {
      offset = value + (options.adjustments || 0);
      report(offset, true);
    },
    initialOffset: offset,
  });
  virtual.shouldAdjustScrollPositionOnItemSizeChange = preserveViewportOnResize;
  virtual._willUpdate();
  return {
    virtual,
    scroll: (value: number) => {
      offset = value;
      report(value, true);
    },
    screenTop: (index: number) =>
      // Measurements are private API, but the test needs the laid-out item starts.
      (virtual as unknown as { getMeasurements(): Array<{ start: number }> }).getMeasurements()[index].start - offset,
    offset: () => offset,
  };
}

test("scrolling upward keeps the visible passage steady when an image above it grows", () => {
  const { virtual, scroll, screenTop, offset } = stream();
  virtual.resizeItem(40, 200);
  scroll(9970);
  assert.equal(virtual.scrollDirection, "backward");
  const passage = screenTop(50);
  virtual.resizeItem(40, 1100);
  assert.equal(screenTop(50), passage);
  const compensated = offset();
  scroll(compensated - 30);
  assert.equal(screenTop(50), passage + 30);
  virtual.resizeItem(39, 360);
  assert.equal(screenTop(50), passage + 30);
});

test("a returning block's final measurement cannot pull the passage upward during backward scrolling", () => {
  const { virtual, scroll, screenTop } = stream();
  virtual.resizeItem(40, 600);
  scroll(10_370);
  const passage = screenTop(50);
  virtual.resizeItem(40, 480);
  assert.equal(screenTop(50), passage);
  virtual.resizeItem(38, 90);
  assert.equal(screenTop(50), passage);
});

test("growth of the paragraph crossing the viewport top does not scroll past its beginning", () => {
  const { virtual, scroll, offset, screenTop } = stream();
  scroll(9910);
  const top = screenTop(49),
    position = offset();
  virtual.resizeItem(49, 1400);
  assert.equal(offset(), position);
  assert.equal(screenTop(49), top);
});
