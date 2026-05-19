const HOUR_MS = 60 * 60 * 1000;

export const AUTO_SYNC_MIN_PERIOD_MS = 12 * HOUR_MS;
export const AUTO_SYNC_CHECK_INTERVAL_MS = HOUR_MS;

export function isAutoSyncDue(
  lastSyncIso: string | null | undefined,
  nowMs: number = Date.now(),
  minPeriodMs: number = AUTO_SYNC_MIN_PERIOD_MS,
): boolean {
  if (!lastSyncIso) {
    return true;
  }

  const lastSyncMs = new Date(lastSyncIso).getTime();
  if (!Number.isFinite(lastSyncMs)) {
    return true;
  }

  return nowMs - lastSyncMs >= minPeriodMs;
}
