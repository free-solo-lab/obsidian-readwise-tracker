export type ReadwiseSyncLocation = "new" | "later" | "shortlist" | "feed" | "archive";

export const ALL_SYNC_LOCATIONS: ReadwiseSyncLocation[] = ["new", "later", "shortlist", "feed", "archive"];

export interface ReadwiseTrackerSettings {
  readwiseToken: string;
  debugLogging: boolean;
  readwiseBooksFolder: string;
  readwiseLinkedHighlightsFolder: string;
  readwiseInboxFolder: string;
  /**
   * Reader locations used to bootstrap an empty tracker. Later regular syncs fetch only
   * documents changed since the previous successful sync across every location.
   * An empty list means "all locations" for the bootstrap.
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
  requestDelayMs: 3200,
  maxRetries: 8,
};
