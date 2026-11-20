import type { WorkspaceNodeKind } from "./types";

export type RightKind = Exclude<WorkspaceNodeKind, "highlight">;
export const RIGHT_KINDS: RightKind[] = ["thought", "dialog", "relation"];

/**
 * Which panes are on screen. The stage shows, left to right:
 * `Text | Notes | Thoughts | AI | Links`, where at most the text, the notes and one right
 * pane are open at a time and the rest are rails. `reading` is the text alone, full screen.
 */
export interface PaneLayout {
  right?: RightKind;
  sourceOpen: boolean;
  notesCollapsed: boolean;
  reading: boolean;
}

export type PaneAction =
  /** Toolbar "book text": the text replaces whatever was open on the right. */
  | { type: "toggleSource" }
  /** The text pane's own close button; the other panes stay as they are. */
  | { type: "closeSource" }
  /** The text rail: opening closes the right pane; closing never leaves the notes folded alone. */
  | { type: "toggleSourceRail" }
  /** Fold or unfold the notes while the text or a right pane is open. */
  | { type: "toggleNotes" }
  /** The notes pane's own close button; with nothing else open the text takes its place. */
  | { type: "collapseNotes" }
  /** The notes rail. */
  | { type: "expandNotes" }
  /** A highlight asks for its passage: text open, right pane closed. */
  | { type: "showSource" }
  /** Open a right pane next to the notes (from a highlight's idea/question buttons). */
  | { type: "showRight"; kind: RightKind }
  /** A right rail: the same kind again closes it. */
  | { type: "toggleRight"; kind: RightKind }
  /** Right pane's "text alongside": the text takes the notes' place. */
  | { type: "toggleSourceBesideRight" }
  | { type: "closeRight" }
  /** A note was created: only the right pane changes. */
  | { type: "setRight"; kind: RightKind }
  | { type: "toggleReading" }
  | { type: "exitReading" }
  /** A plain Markdown document with no highlights opens as a reader. */
  | { type: "readerDefault" };

export function reducePaneLayout(state: PaneLayout, action: PaneAction): PaneLayout {
  switch (action.type) {
    case "toggleSource":
      return { ...state, sourceOpen: !state.sourceOpen, right: undefined, notesCollapsed: false };
    case "closeSource":
      return { ...state, sourceOpen: false };
    case "toggleSourceRail":
      if (!state.sourceOpen) return { ...state, sourceOpen: true, right: undefined, notesCollapsed: false };
      return { ...state, sourceOpen: false, notesCollapsed: state.right ? state.notesCollapsed : false };
    case "toggleNotes":
      return { ...state, notesCollapsed: !state.notesCollapsed, sourceOpen: false };
    case "collapseNotes":
      return { ...state, notesCollapsed: true, sourceOpen: state.sourceOpen || !state.right };
    case "expandNotes":
      return { ...state, notesCollapsed: false, sourceOpen: state.right ? false : state.sourceOpen };
    case "showSource":
      return { ...state, sourceOpen: true, right: undefined };
    case "showRight":
      return { ...state, right: action.kind, sourceOpen: false, notesCollapsed: false };
    case "toggleRight":
      return {
        ...state,
        right: state.right === action.kind ? undefined : action.kind,
        sourceOpen: false,
        notesCollapsed: false,
      };
    case "toggleSourceBesideRight":
      return { ...state, notesCollapsed: true, sourceOpen: !state.sourceOpen };
    case "closeRight":
      return { ...state, right: undefined, notesCollapsed: false, sourceOpen: false };
    case "setRight":
      return { ...state, right: action.kind };
    case "toggleReading":
      return { ...state, reading: !state.reading, sourceOpen: true };
    case "exitReading":
      return { ...state, reading: false };
    case "readerDefault":
      return { ...state, sourceOpen: true, notesCollapsed: true };
  }
}
