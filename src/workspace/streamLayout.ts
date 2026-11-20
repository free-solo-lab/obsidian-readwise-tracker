/** A resized block entirely above the viewport must not move the text being read,
 * including while scrolling backward. A block spanning the top grows below it. */
export function preserveViewportOnResize(
  item: { end: number },
  _delta: number,
  virtual: { scrollOffset: number | null },
): boolean {
  return item.end <= (virtual.scrollOffset ?? 0);
}
