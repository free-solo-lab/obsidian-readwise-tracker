import type { ReadwiseSyncLocation } from "../settings/types";

const INCREMENTAL_SYNC_OVERLAP_MS = 5 * 60 * 1000;

export interface ReadwiseSyncRequest {
  location?: ReadwiseSyncLocation;
  updatedAfter?: string;
}

export interface ReadwiseSyncPlan {
  mode: "bootstrap" | "incremental";
  requests: ReadwiseSyncRequest[];
}

export function createRegularSyncPlan(
  lastSync: string | null,
  configuredLocations: ReadwiseSyncLocation[],
): ReadwiseSyncPlan {
  const lastSyncMs = lastSync ? Date.parse(lastSync) : Number.NaN;
  if (Number.isFinite(lastSyncMs)) {
    return {
      mode: "incremental",
      requests: [
        {
          updatedAfter: new Date(
            Math.max(0, lastSyncMs - INCREMENTAL_SYNC_OVERLAP_MS),
          ).toISOString(),
        },
      ],
    };
  }

  const locations = configuredLocations.length > 0 ? configuredLocations : [undefined];
  return {
    mode: "bootstrap",
    requests: locations.map((location) => ({ location })),
  };
}
