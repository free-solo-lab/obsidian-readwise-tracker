/**
 * Notes per mark: one each below 100 notes, then two from 100, three from 200 and so on,
 * so the ruler never grows past about a hundred marks.
 */
export function markGroup(total: number): number {
  return Math.floor(Math.max(0, total) / 100) + 1;
}
