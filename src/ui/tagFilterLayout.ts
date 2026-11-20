const MAX_ROWS = 2;

/**
 * How many tag pills fit in two rows, keeping room for the disclosure button on the
 * second row when not everything fits. Widths are measured pills in layout order.
 */
export function collapsedTagCount(
  widths: number[],
  availableWidth: number,
  gap: number,
  disclosureWidth: number,
): number {
  if (availableWidth <= 0) return 0;
  const fits = (count: number, withDisclosure: boolean) => {
    const items = widths.slice(0, count);
    if (withDisclosure) items.push(disclosureWidth);
    let row = 1,
      used = 0;
    for (const item of items) {
      const width = Math.min(availableWidth, Math.max(0, item));
      if (used > 0 && used + gap + width > availableWidth + 0.5) {
        row++;
        used = 0;
      }
      used += (used ? gap : 0) + width;
      if (row > MAX_ROWS) return false;
    }
    return true;
  };
  if (fits(widths.length, false)) return widths.length;
  // The largest prefix that still leaves room for the disclosure: binary search.
  let low = 0,
    high = widths.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle, true)) low = middle;
    else high = middle - 1;
  }
  return low;
}
