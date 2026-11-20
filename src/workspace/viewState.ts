export interface BookWorkspaceLocation extends Record<string, unknown> {
  documentId?: string;
  right?: "thought" | "dialog" | "relation";
  sourceOpen?: boolean;
  notesCollapsed?: boolean;
  split?: number;
  focused?: string;
  /** The furthest highlight the reader has reached; marked on the book map to come back to. */
  furthest?: string;
  positions?: Record<string, number>;
  /** Top block and offset inside it per panel; survives re-measuring, unlike pixels. */
  anchors?: Record<string, { key: string; delta: number }>;
}
export interface BookWorkspaceState extends BookWorkspaceLocation {
  history?: string[];
  trail?: BookWorkspaceLocation[];
}
function location(value: unknown): BookWorkspaceLocation {
  const state =
    value && typeof value === "object" ? (value as BookWorkspaceLocation) : {};
  return {
    documentId:
      typeof state.documentId === "string" ? state.documentId : undefined,
    right: ["thought", "dialog", "relation"].includes(state.right || "")
      ? state.right
      : undefined,
    sourceOpen: state.sourceOpen === true,
    notesCollapsed: state.notesCollapsed === true,
    split:
      typeof state.split === "number" && Number.isFinite(state.split)
        ? Math.max(0.25, Math.min(0.75, state.split))
        : 0.5,
    focused: typeof state.focused === "string" ? state.focused : undefined,
    furthest: typeof state.furthest === "string" ? state.furthest : undefined,
    positions: Object.fromEntries(
      Object.entries(
        state.positions && typeof state.positions === "object"
          ? state.positions
          : {},
      ).filter(
        ([, offset]) =>
          typeof offset === "number" && Number.isFinite(offset) && offset >= 0,
      ),
    ),
    anchors: Object.fromEntries(
      Object.entries(
        state.anchors && typeof state.anchors === "object" ? state.anchors : {},
      ).filter(([, value]) => {
        const anchor = value as { key?: unknown; delta?: unknown } | null;
        return (
          !!anchor &&
          typeof anchor.key === "string" &&
          typeof anchor.delta === "number" &&
          Number.isFinite(anchor.delta)
        );
      }),
    ),
  };
}
export function readWorkspaceState(value: unknown): BookWorkspaceState {
  const state =
    value && typeof value === "object" ? (value as BookWorkspaceState) : {};
  return {
    ...location(state),
    history: Array.isArray(state.history)
      ? state.history.filter((id) => typeof id === "string")
      : [],
    trail: Array.isArray(state.trail)
      ? state.trail.map(location).filter((item) => !!item.documentId)
      : [],
  };
}
export function navigateWorkspace(
  state: BookWorkspaceState,
  id: string,
  back = false,
): BookWorkspaceState {
  const history = [...(state.history || [])],
    trail = [...(state.trail || [])];
  if (back) {
    history.pop();
    const previous = trail.pop();
    return {
      ...(previous?.documentId === id
        ? previous
        : { ...location(state), documentId: id, positions: {}, anchors: {} }),
      history,
      trail,
    };
  }
  if (state.documentId) {
    history.push(state.documentId);
    trail.push(location(state));
  }
  // Bounded: the state is saved with the layout on every scroll pause.
  return {
    documentId: id,
    history: history.slice(-50),
    trail: trail.slice(-50),
    // A linked item opens on its text, with the notes folded away.
    right: undefined,
    sourceOpen: true,
    notesCollapsed: true,
    split: state.split,
    positions: {},
    anchors: {},
  };
}
