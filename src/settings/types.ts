export interface ReadwiseTrackerSettings {
  readwiseToken: string;
  debugLogging: boolean;
  readwiseBooksFolder: string;
  readwiseLinkedHighlightsFolder: string;
  readwiseInboxFolder: string;
}

export const DEFAULT_SETTINGS: ReadwiseTrackerSettings = {
  readwiseToken: "",
  debugLogging: false,
  readwiseBooksFolder: "Readwise/Books",
  readwiseLinkedHighlightsFolder: "Readwise/Highlights",
  readwiseInboxFolder: "Inbox/Readwise",
};
