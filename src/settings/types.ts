export type ReadwiseSyncLocation = "new" | "later" | "shortlist" | "feed" | "archive";

export const ALL_SYNC_LOCATIONS: ReadwiseSyncLocation[] = ["new", "later", "shortlist", "feed", "archive"];

export interface ReadwiseTrackerSettings {
  readwiseToken: string;
  debugLogging: boolean;
  readwiseBooksFolder: string;
  readwiseLinkedHighlightsFolder: string;
  readwiseInboxFolder: string;
  /**
   * Reader locations to pull during a sync. Readwise Reader libraries can hold tens of
   * thousands of documents (RSS `feed` + `archive` especially); fetching them all on every
   * sync blows the API rate limit. Restricting to the locations that actually contain reading
   * material keeps syncs small and fast. An empty list means "all locations" (legacy behaviour).
   */
  syncLocations: ReadwiseSyncLocation[];
  /** Delay in milliseconds between paginated list requests, to stay under the Readwise rate limit. */
  requestDelayMs: number;
  /** How many times to wait out an HTTP 429 (respecting Retry-After) before giving up on a request. */
  maxRetries: number;
}

export const DEFAULT_SETTINGS: ReadwiseTrackerSettings = {
  readwiseToken: "",
  debugLogging: false,
  readwiseBooksFolder: "Readwise/Books",
  readwiseLinkedHighlightsFolder: "Readwise/Highlights",
  readwiseInboxFolder: "Inbox/Readwise",
  syncLocations: ["new", "later", "shortlist"],
  requestDelayMs: 1500,
  maxRetries: 8,
};
