import * as React from "react";
import type { ReadwiseTrackerViewHost } from "../plugin/contracts";
import type { DialogMessage, WorkspaceDocument, WorkspaceNode } from "./types";
import { Icon, IconButton, Markdown, NoteEditor } from "./controls";
import { basename, parseMarkdown, parseMessages } from "./markdown";
import { safeAssistantMarkdown } from "./ai";
import { t } from "../i18n";
import { SCOPE_BOOK, SCOPE_KEY } from "./dialog";

const SUBMIT_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";

interface DialogProps {
  plugin: ReadwiseTrackerViewHost;
  node: WorkspaceNode;
  document?: WorkspaceDocument;
  revision?: string;
  autoFocus?: boolean;
  windowed?: boolean;
  sources?: React.ReactNode;
  onOrigin?: (path: string) => void;
  onCancel?: () => void;
  onEditing: (path?: string) => void;
  onDone: () => void;
  onThought: (message: DialogMessage) => void;
}

export function ChatFeed(
  props: Omit<DialogProps, "onEditing" | "onDone">,
): React.ReactElement {
  return (
    <div className="rwt-chat">
      <DialogBody
        {...props}
        autoFocus
        windowed
        onEditing={() => undefined}
        onDone={() => undefined}
      />
    </div>
  );
}

export function DialogBody({
  plugin,
  node,
  document,
  revision,
  autoFocus = false,
  windowed = false,
  sources,
  onOrigin,
  onCancel,
  onEditing,
  onDone,
  onThought,
}: DialogProps): React.ReactElement {
  const service = plugin.workspaceService;
  const job = React.useSyncExternalStore(
    (listener) => service.dialogs.subscribe(listener),
    () => service.dialogs.job(node.path),
  );
  const all = React.useMemo(() => parseMessages(node.body), [node.body]);
  const [shown, setShown] = React.useState(40),
    [submitting, setSubmitting] = React.useState(false);
  const [draft, setDraft] = React.useState(() =>
    String(parseMarkdown(node.raw).metadata.rwt_draft || ""),
  );
  const wholeBook = String(parseMarkdown(node.raw).metadata[SCOPE_KEY] || "") === SCOPE_BOOK;
  const toggleScope = () =>
    void service.repository
      .setDialogProperty(node, SCOPE_KEY, wholeBook ? undefined : SCOPE_BOOK)
      .catch((error: unknown) => service.report(error));
  const [copied, setCopied] = React.useState<string>();
  const copyTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const sending = React.useRef(false),
    alive = React.useRef(true);
  const submitted = React.useRef(false);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  const messages = windowed ? all.slice(-shown) : all;
  const unavailable = service.dialogs.unavailable(),
    running = job?.status === "running";
  const unanswered = all.length > 0 && all[all.length - 1].role === "user";
  const hasDraft = !!draft.trim(),
    retry = !hasDraft && unanswered;
  const canSend = !unavailable && !!document && (hasDraft || unanswered);
  const history = React.useRef<HTMLDivElement>(null),
    near = React.useRef(true);
  React.useLayoutEffect(() => {
    const el = history.current;
    if (windowed && el && near.current) el.scrollTop = el.scrollHeight;
  }, [windowed, node.body, job?.text, job?.status]);
  /** One question at a time from this composer; the runner itself guards the dialog. */
  const submit = (task: () => Promise<void>) => {
    if (running || sending.current) return;
    sending.current = true;
    submitted.current = true;
    setSubmitting(true);
    void task()
      .catch((error: unknown) => service.report(error))
      .finally(() => {
        sending.current = false;
        if (alive.current) setSubmitting(false);
      });
  };
  const send = () => {
    if (!document || !canSend) return;
    submit(async () => {
      await service.flush();
      await service.dialogs.send(document, node, revision);
    });
  };
  const resend = (message: DialogMessage) => {
    if (!document || unavailable) return;
    submit(() => service.dialogs.resend(document, node, message, revision));
  };
  const cancelDraft = () => {
    void (async () => {
      await service.flush();
      if (!(await service.repository.messages(node)).length) onCancel?.();
    })().catch((error: unknown) => service.report(error));
  };
  const canDiscard =
    onCancel && !all.length && !job && !submitting && !submitted.current;
  const copy = (message: DialogMessage) => {
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        if (!alive.current) return;
        setCopied(message.id);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(undefined), 1600);
      })
      .catch((error: unknown) => service.report(error));
  };
  const action = t(
    running ? "dialog.stop" : submitting ? "dialog.sending" : retry ? "dialog.retry" : "dialog.send",
  );
  const shortcut = SUBMIT_SHORTCUT;
  const roleName = (role: DialogMessage["role"]) => t(role === "user" ? "dialog.you" : "dialog.ai");
  return (
    <div className={"rwt-dialog" + (windowed ? " is-feed" : "")}>
      <div
        className="rwt-dialog-messages"
        ref={history}
        onScroll={(event) => {
          const el = event.currentTarget;
          near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {windowed && all.length > messages.length && (
          <button
            type="button"
            className="rwt-more"
            onClick={() => setShown(shown + 40)}
          >
            {t("dialog.showEarlier", { count: all.length - messages.length })}
          </button>
        )}
        {messages.map((message) => (
          <section
            key={message.id}
            className={"rwt-message rwt-message-" + message.role}
          >
            <div className="rwt-message-role">
              {message.role === "assistant" && <Icon icon="sparkles" />}
              <span>{roleName(message.role)}</span>
              {message.origin && onOrigin && (
                <button
                  type="button"
                  className="rwt-message-origin"
                  title={t("dialog.openOrigin")}
                  onClick={() => onOrigin(message.origin as string)}
                >
                  ↗ {basename(message.origin).slice(0, 28)}
                </button>
              )}
            </div>
            <Markdown
              app={plugin.app}
              path={node.path}
              text={
                message.role === "assistant"
                  ? safeAssistantMarkdown(message.content)
                  : message.content
              }
            />
            {message.role === "user" && !windowed && (
              <div className="rwt-message-actions">
                <IconButton
                  icon="rotate-cw"
                  label={
                    unavailable ||
                    t(running || submitting ? "dialog.waitForAnswer" : "dialog.resend")
                  }
                  onClick={() => resend(message)}
                />
              </div>
            )}
            {message.role === "assistant" && (
              <div className="rwt-message-actions">
                <IconButton
                  icon={copied === message.id ? "check" : "copy"}
                  label={t(copied === message.id ? "dialog.copied" : "dialog.copy")}
                  onClick={() => copy(message)}
                />
                <IconButton
                  icon="pencil-line"
                  label={t("dialog.saveThought")}
                  onClick={() => onThought(message)}
                />
              </div>
            )}
          </section>
        ))}
        {!messages.length && node.body.trim() && (
          <Markdown app={plugin.app} text={node.body} path={node.path} />
        )}
        {running && job && (
          <section
            className="rwt-message rwt-message-assistant is-pending"
            aria-busy="true"
          >
            <div className="rwt-message-role">
              <Icon icon="sparkles" />
              <span>{roleName("assistant")}</span>
            </div>
            {job.text ? (
              <div className="rwt-stream-text">{job.text}</div>
            ) : (
              <div className="rwt-ai-status" role="status">
                <span className="rwt-thinking-dot" aria-hidden="true" />
                {job.progress}
                {job.queued > 0 ? t("dialog.queued", { count: job.queued }) : ""}
              </div>
            )}
          </section>
        )}
      </div>
      <div
        className={
          "rwt-composer" +
          (running ? " is-running" : "") +
          (job?.status === "error" ? " has-error" : "")
        }
        role="group"
        aria-label={t("dialog.composer")}
      >
        {(sources || canDiscard) && (
          <div className="rwt-composer-context">
            {sources}
            {canDiscard && (
              <IconButton
                icon="x"
                label={t("dialog.discardDraft")}
                onClick={cancelDraft}
              />
            )}
          </div>
        )}
        <NoteEditor
          service={service}
          node={node}
          draft
          autoFocus={autoFocus}
          placeholder={t(windowed ? "dialog.askBook" : "dialog.askNote")}
          onValueChange={setDraft}
          onEditing={onEditing}
          onDone={onDone}
          onSubmit={send}
        />
        {job?.status === "error" && (
          <div className="rwt-ai-error" role="alert">
            <Icon icon="circle-alert" />
            <span>{job.error}</span>
            <IconButton
              icon="x"
              label={t("workspace.action.hideError")}
              onClick={() => service.dialogs.dismiss(node.path)}
            />
          </div>
        )}
        <div className="rwt-composer-footer">
          <div className="rwt-composer-meta">
            {unavailable ? (
              <span title={unavailable}>{t("dialog.unavailable")}</span>
            ) : running ? (
              <span role="status">{t("dialog.generating")}</span>
            ) : submitting ? (
              <span role="status">{t("dialog.sendingShort")}</span>
            ) : (
              <>
                {!windowed && (
                  <IconButton
                    icon="library"
                    label={t(wholeBook ? "dialog.scopeBook" : "dialog.scopeNote")}
                    active={wholeBook}
                    keepFocus
                    onClick={toggleScope}
                  />
                )}
                {plugin.settings.workspaceAiModel && (
                  <span className="rwt-composer-model" title={t("dialog.model")}>
                    {plugin.settings.workspaceAiModel}
                  </span>
                )}
                <span
                  className="rwt-composer-shortcut"
                  title={t("dialog.send")}
                >
                  {shortcut}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className={
              "rwt-composer-action" +
              (running ? " is-stop" : submitting ? " is-sending" : "")
            }
            aria-label={action}
            title={
              unavailable ||
              action + (!running && !submitting ? " (" + shortcut + ")" : "")
            }
            disabled={!running && (submitting || !canSend)}
            onClick={running ? () => service.dialogs.cancel(node.path) : send}
          >
            <Icon
              icon={
                running
                  ? "square"
                  : submitting
                    ? "loader-circle"
                    : retry
                      ? "rotate-cw"
                      : "arrow-up"
              }
            />
          </button>
        </div>
      </div>
    </div>
  );
}
