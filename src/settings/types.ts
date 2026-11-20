export type ReadwiseSyncLocation = "new" | "later" | "shortlist" | "feed" | "archive";

export const ALL_SYNC_LOCATIONS: ReadwiseSyncLocation[] = ["new", "later", "shortlist", "feed", "archive"];

/** How the reader last saw a book in the workspace: its translation into `language`, or the original. */
export interface WorkspaceTranslationView {
  language: string;
  translation: boolean;
}

export interface ReadwiseTrackerSettings {
  readwiseToken: string;
  readwiseReaderSessionCookie: string;
  debugLogging: boolean;
  readwiseBooksFolder: string;
  readwiseLinkedHighlightsFolder: string;
  readwiseInboxFolder: string;
  /** Model id for book dialogs through Codex Bridge; empty uses the Bridge default. */
  workspaceAiModel: string;
  /** Ask Codex Bridge for web search and the MCP servers allowed there (e.g. Readwise). */
  workspaceAiFullAccess: boolean;
  /** Send reading progress from the book workspace to Reader; a finished book is archived there. */
  workspaceMirrorProgress: boolean;
  /** Per workspace document id: the text the reader last had on screen (translation or original). */
  workspaceTranslationViews: Record<string, WorkspaceTranslationView>;
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
  /** Start date used by the reading Gantt plan; empty means today. */
  ganttStartDate: string;
  /** Explicit daily reading budget in minutes; zero means use the observed average. */
  ganttDailyMinutes: number;
  /** Expanded directions shared by the board and Gantt views. */
  ganttFocusTags: string[];
  /** User-defined order of directions shared by the board and Gantt views. */
  ganttDirectionOrder: string[];
  /** User-defined book order inside each direction. */
  ganttDirectionBookOrder: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: ReadwiseTrackerSettings = {
  readwiseToken: "",
  readwiseReaderSessionCookie: "",
  debugLogging: false,
  readwiseBooksFolder: "Readwise/Books",
  readwiseLinkedHighlightsFolder: "Readwise/Highlights",
  readwiseInboxFolder: "Inbox/Readwise",
  workspaceAiModel: "",
  workspaceAiFullAccess: false,
  workspaceMirrorProgress: false,
  workspaceTranslationViews: {},
  syncLocations: ["new", "later", "shortlist"],
  requestDelayMs: 3200,
  maxRetries: 8,
  ganttStartDate: "",
  ganttDailyMinutes: 0,
  ganttFocusTags: [],
  ganttDirectionOrder: [],
  ganttDirectionBookOrder: {},
};
