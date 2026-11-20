import type { WorkspaceDocument, WorkspaceNodeKind } from "./types";

/**
 * Where a book's workspace lives inside the vault:
 *
 *   <highlights folder>/<book>/Workspace/
 *     Source/source.md      the manifest: bound files, anchors, Reader ids
 *     Source/content.md     the extracted text (content-<hash>.md for later revisions)
 *     Source/translation-<lang>.md
 *     Thoughts/, Dialogs/, Links/
 *     Chat.md               the book's single AI chat feed
 *   <highlights folder>/_Assets/   originals and images, named by content hash
 */
export const WORKSPACE_FOLDER = "Workspace";
export const ASSETS_FOLDER = "_Assets";
export const SOURCE_MANIFEST = "Source/source.md";
export const SOURCE_CONTENT = "Source/content.md";
export const CHAT_FILE = "Chat.md";

export const NOTE_FOLDERS: Record<Exclude<WorkspaceNodeKind, "highlight">, string> = {
  thought: "Thoughts",
  dialog: "Dialogs",
  relation: "Links",
};

/** Any path inside a workspace or the shared assets folder. */
export const MANAGED_PATH = /(?:^|\/)(?:Workspace|_Assets)(?:\/|$)/;
/** Notes the reader writes: their bodies never change what a document is. */
export const NOTE_FOLDER_PATH = /\/Workspace\/(?:Thoughts|Dialogs|Links)\//;
const TRANSLATION_PATH = /\/Workspace\/Source\/translation-[a-z-]+\.md$/;
const MANIFEST_SUFFIX = "/" + WORKSPACE_FOLDER + "/" + SOURCE_MANIFEST;

const join = (...parts: string[]) => parts.join("/");

export const manifestPath = (document: Pick<WorkspaceDocument, "workspacePath">): string =>
  join(document.workspacePath, SOURCE_MANIFEST);

export const contentPath = (document: Pick<WorkspaceDocument, "workspacePath">): string =>
  join(document.workspacePath, SOURCE_CONTENT);

export const chatPath = (document: Pick<WorkspaceDocument, "workspacePath">): string =>
  join(document.workspacePath, CHAT_FILE);

export const isManifestPath = (path: string): boolean => path.endsWith(MANIFEST_SUFFIX);

export const isWorkspacePath = (path: string): boolean =>
  path.includes("/" + WORKSPACE_FOLDER + "/");

/** Files whose edits only change note text, never the document's structure. */
export const isNoteBodyPath = (path: string): boolean =>
  NOTE_FOLDER_PATH.test(path) || TRANSLATION_PATH.test(path);
