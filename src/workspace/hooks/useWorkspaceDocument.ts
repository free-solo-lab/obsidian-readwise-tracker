import * as React from "react";
import type { BookWorkspaceService } from "../service";
import type { WorkspaceDocument, WorkspaceNode } from "../types";
import { manifestPath } from "../layout";
import { errorMessage } from "../../utils/errors";

export interface WorkspaceDocumentState {
  document?: WorkspaceDocument;
  /** The document's own notes: highlights, thoughts, dialogs and relations. */
  nodes: WorkspaceNode[];
  /** The whole link graph, for resolving sources that point outside this book. */
  allNodes: WorkspaceNode[];
  error: string;
  /** Changes whenever the bound text or the manifest is written; the text pane reloads on it. */
  sourceStamp: string;
}

/**
 * Loads the document and its notes, and reloads them on every workspace change.
 * `onFirstLoad` runs once per document id, before the first render with its notes.
 */
export function useWorkspaceDocument(
  service: BookWorkspaceService,
  documentId: string | undefined,
  onFirstLoad: (document: WorkspaceDocument, nodes: WorkspaceNode[]) => void,
): WorkspaceDocumentState {
  const [state, setState] = React.useState<WorkspaceDocumentState>({
    nodes: [],
    allNodes: [],
    error: "",
    sourceStamp: "",
  });
  const firstLoad = React.useRef(onFirstLoad);
  firstLoad.current = onFirstLoad;
  const initialized = React.useRef("");
  React.useEffect(() => {
    if (!documentId) return;
    let alive = true,
      running = false,
      again = false;
    const refresh = async () => {
      // Events arriving mid-load are coalesced into one more pass.
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const current = await service.document(documentId);
        const [nodes, allNodes] = await Promise.all([
          service.repository.nodesFor(current),
          service.repository.graph(),
        ]);
        const bound = await service.repository.source(current);
        const sourceStamp = [
          bound.contentPath,
          bound.contentPath && service.storage.mtime(bound.contentPath),
          service.storage.mtime(manifestPath(current)),
        ].join(":");
        if (!alive) return;
        if (initialized.current !== current.id) {
          initialized.current = current.id;
          firstLoad.current(current, nodes);
        }
        setState({ document: current, nodes, allNodes, error: "", sourceStamp });
      } catch (error) {
        if (alive) setState((old) => ({ ...old, error: errorMessage(error) }));
      } finally {
        running = false;
        if (again && alive) {
          again = false;
          void refresh();
        }
      }
    };
    void refresh();
    const unsubscribe = service.subscribe(() => void refresh());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [service, documentId]);
  return state;
}
