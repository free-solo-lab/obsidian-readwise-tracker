import { ItemView, type WorkspaceLeaf, type ViewStateResult } from "obsidian";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReadwiseTrackerViewHost } from "../plugin/contracts";
import { t } from "../i18n";
import { WorkspaceScreen } from "./WorkspaceScreen";
import {
  readWorkspaceState,
  navigateWorkspace,
  type BookWorkspaceState,
} from "./viewState";
import { debounce } from "../utils/timing";
export type { BookWorkspaceState } from "./viewState";

export const BOOK_WORKSPACE_VIEW = "readwise-book-workspace";
export class BookWorkspaceView extends ItemView {
  private root: Root | undefined;
  private state: BookWorkspaceState = {};
  /** Scroll positions arrive on every pause; the layout is saved once per burst. */
  private readonly saveLayout = debounce(() => this.app.workspace.requestSaveLayout(), 300);
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ReadwiseTrackerViewHost,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return BOOK_WORKSPACE_VIEW;
  }
  getDisplayText(): string {
    return t("workspace.viewTitle");
  }
  getIcon(): string {
    return "panels-top-left";
  }
  getState(): BookWorkspaceState {
    return this.state;
  }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await this.plugin.workspaceService.flush();
    this.state = readWorkspaceState(state);
    this.render();
    await super.setState(state, result);
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("rwt-workspace-host");
    this.root = createRoot(this.contentEl);
    this.render();
  }
  async onClose(): Promise<void> {
    // The last scroll position must reach the saved layout, not be dropped with the timer.
    this.saveLayout.flush();
    await this.plugin.workspaceService.flush();
    this.root?.unmount();
  }
  private render(): void {
    const owner = this.state.documentId;
    this.root?.render(
      <WorkspaceScreen
        key={this.state.documentId || "empty"}
        plugin={this.plugin}
        initial={this.state}
        persist={(patch) => {
          if (owner !== this.state.documentId) return;
          this.state = { ...this.state, ...patch };
          this.saveLayout();
        }}
        navigate={async (id, back = false) => {
          await this.plugin.workspaceService.flush();
          if (owner !== this.state.documentId) return;
          this.state = navigateWorkspace(this.state, id, back);
          this.render();
          this.app.workspace.requestSaveLayout();
        }}
      />,
    );
  }
}
