import type { Workspace, WorkspaceLeaf } from "obsidian";
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
    await workspace.revealLeaf(leaf);
  }
}

export { DASHBOARD_VIEW_TYPE, STATS_VIEW_TYPE };
