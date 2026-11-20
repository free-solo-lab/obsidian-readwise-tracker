import * as React from "react";
import type { App } from "obsidian";
import type { WorkspaceFile, WorkspaceNode } from "./types";
import { IconButton, WorkspacePicker } from "./controls";
import { basename } from "./markdown";
import { t } from "../i18n";

/** A note whose sources are being re-chosen: highlights are ticked in the list, other notes added here. */
export interface SourceSelection {
  node: WorkspaceNode;
  paths: Set<string>;
}

export function SelectionBar({
  app,
  selection,
  isHighlight,
  files,
  onChange,
  onSave,
  onCancel,
}: {
  app: App;
  selection: SourceSelection;
  /** Highlights of this book are shown as checkboxes in the notes pane, not as chips here. */
  isHighlight: (path: string) => boolean;
  files: () => WorkspaceFile[];
  onChange: (selection: SourceSelection) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const update = (paths: Set<string>) => onChange({ ...selection, paths });
  const addFromVault = () =>
    new WorkspacePicker(
      app,
      files()
        .filter(
          (file) =>
            file.path.endsWith(".md") &&
            !file.path.includes("/Workspace/Source/") &&
            file.path !== selection.node.path,
        )
        .map((file) => ({ id: file.path, title: file.basename, detail: file.path })),
      (choice) => update(new Set([...selection.paths, choice.id])),
      t("workspace.picker.source"),
    ).open();
  return (
    <div className="rwt-selection-bar">
      {[...selection.paths]
        .filter((path) => !isHighlight(path))
        .map((path) => (
          <button
            type="button"
            key={path}
            title={t("workspace.action.removeSource")}
            onClick={() => {
              const paths = new Set(selection.paths);
              paths.delete(path);
              update(paths);
            }}
          >
            {basename(path)} ×
          </button>
        ))}
      <span>{selection.paths.size}</span>
      <IconButton icon="plus" label={t("workspace.action.addSource")} onClick={addFromVault} />
      <IconButton icon="check" label={t("workspace.action.saveSources")} onClick={onSave} />
      <IconButton icon="x" label={t("workspace.action.cancelSelection")} onClick={onCancel} />
    </div>
  );
}
