import * as React from "react";
import type { BookWorkspaceService } from "../service";
import type { ContentResolution, SourceAnchor, WorkspaceDocument } from "../types";
import type { WorkspaceFocus } from "../focus";
import { emptyResolution } from "../source";
import { errorMessage } from "../../utils/errors";

interface Options {
  service: BookWorkspaceService;
  document?: WorkspaceDocument;
  /** Whether Reader may be asked for the text (an API token is set). */
  remote: boolean;
  /** The pane is on screen; nothing is fetched while it is closed. */
  open: boolean;
  /** Changes when the bound text or manifest is written on disk. */
  stamp: string;
  /** The highlight in focus; its missing image anchor is resolved on demand. */
  focusPath?: string;
  anchor?: SourceAnchor;
  coordinator: WorkspaceFocus;
}

export interface SourceTextState {
  source?: ContentResolution;
  setSource: (source: ContentResolution) => void;
  busy: boolean;
  /** Resolve the text again; with `repairTables` legacy tables are rebuilt from the original HTML. */
  reload: (repairTables?: boolean) => Promise<void>;
  /** Bind a vault file as the book's text. */
  attach: (path: string) => Promise<void>;
  /** Stop a background table repair (the reader started scrolling). */
  abortRepair: () => void;
}

/**
 * The book's text: resolved when the pane opens or the bound files change, with background
 * table repair and image-anchor matching that never fight a reader who is scrolling.
 */
export function useSourceText({
  service,
  document,
  remote,
  open,
  stamp,
  focusPath,
  anchor,
  coordinator,
}: Options): SourceTextState {
  const [source, setSource] = React.useState<ContentResolution>();
  const [busy, setBusy] = React.useState(false);
  const sourceRef = React.useRef(source);
  sourceRef.current = source;
  /** Only the newest request may publish its result. */
  const request = React.useRef(0);
  const attaching = React.useRef(false);
  const repair = React.useRef<AbortController>();
  const abortRepair = React.useCallback(() => repair.current?.abort(), []);
  React.useEffect(() => abortRepair, [abortRepair]);

  const reload = React.useCallback(
    async (repairTables = false) => {
      if (!document || attaching.current) return;
      const mine = ++request.current;
      if (sourceRef.current?.status !== "ready") setBusy(true);
      try {
        const resolved = await service.sources.resolve(document, remote);
        if (mine === request.current) setSource(resolved);
        if (repairTables && resolved.status === "ready") {
          repair.current?.abort();
          const controller = new AbortController();
          repair.current = controller;
          const repaired = await service.sources.repairTables(document, remote, controller.signal);
          if (repaired && mine === request.current && !controller.signal.aborted) setSource(repaired);
        }
      } catch (error) {
        if (mine !== request.current) return;
        // A text that is already shown stays; only the first load shows the error in its place.
        if (sourceRef.current?.status === "ready") {
          service.report(error);
          return;
        }
        const bound = await service.repository.source(document).catch(() => ({ originalPath: undefined }));
        setSource(emptyResolution("error", { message: errorMessage(error), originalPath: bound.originalPath }));
      } finally {
        if (mine === request.current) setBusy(false);
      }
    },
    [document, service, remote],
  );

  const attach = React.useCallback(
    async (path: string) => {
      if (!document || attaching.current) return;
      repair.current?.abort();
      attaching.current = true;
      ++request.current;
      setBusy(true);
      try {
        setSource(await service.sources.attach(document, path));
      } catch (error) {
        setSource(emptyResolution("error", { originalPath: path, message: errorMessage(error) }));
      } finally {
        attaching.current = false;
        setBusy(false);
      }
    },
    [document, service],
  );

  React.useEffect(() => {
    if (open) void reload();
  }, [open, reload, stamp]);

  // Legacy tables are repaired in the background once the text is on screen and still.
  React.useEffect(() => {
    if (!open) repair.current?.abort();
    if (!open || !document || sourceRef.current?.status !== "ready" || coordinator.accepts("source")) return;
    const controller = new AbortController();
    repair.current?.abort();
    repair.current = controller;
    const timer = setTimeout(() => {
      void service.sources
        .repairTables(document, remote, controller.signal)
        .then((repaired) => {
          if (repaired && !controller.signal.aborted) setSource(repaired);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) service.report(error);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, document, service, source?.revision, coordinator, remote]);

  // An image-only highlight without a match is looked up when it comes into focus.
  React.useEffect(() => {
    if (!open || !document || !focusPath || sourceRef.current?.status !== "ready") return;
    const current = sourceRef.current.anchors.find((item) => item.nodePath === focusPath);
    if (current?.status !== "missing" || current.manual) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void service.sources
        .resolveImageAnchor(document, focusPath, controller.signal)
        .then((resolved) => {
          if (resolved && !controller.signal.aborted) setSource(resolved);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) service.report(error);
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, document, service, focusPath, source?.revision, anchor?.quote, anchor?.status]);

  return { source, setSource, busy, reload, attach, abortRepair };
}
