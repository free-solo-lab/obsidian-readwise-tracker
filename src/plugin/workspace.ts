import type { Workspace, WorkspaceLeaf } from "obsidian";
import { BOOK_GRAPH_VIEW_TYPE } from "../ui/BookGraphView";
import { DASHBOARD_VIEW_TYPE } from "../ui/DashboardView";
import { STATS_VIEW_TYPE } from "../ui/StatsView";

export async function activateReadwiseView(workspace: Workspace, viewType: string): Promise<void> {
  const existingLeaves = workspace.getLeavesOfType(viewType);
  let leaf: WorkspaceLeaf | null = existingLeaves.length > 0 ? existingLeaves[0] : null;

  if (!leaf) {
    leaf = viewType === STATS_VIEW_TYPE ? workspace.getRightLeaf(false) : workspace.getLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
    }
  }

  if (leaf) {
    workspace.revealLeaf(leaf);
  }
}

export async function openReadwiseBookGraph(workspace: Workspace, bookId?: string): Promise<void> {
  const existingLeaves = workspace.getLeavesOfType(BOOK_GRAPH_VIEW_TYPE);
  const leaf = existingLeaves.length > 0 ? existingLeaves[0] : workspace.getLeaf(false);
  if (!leaf) {
    return;
  }

  await leaf.setViewState({
    type: BOOK_GRAPH_VIEW_TYPE,
    active: true,
    state: { bookId },
  });
  workspace.revealLeaf(leaf);
}

export { BOOK_GRAPH_VIEW_TYPE, DASHBOARD_VIEW_TYPE, STATS_VIEW_TYPE };
