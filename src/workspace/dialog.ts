import { readableError } from "./ai";
import { SAVE_REQUEST, readerLinkIds, takeReaderIds } from "./readerLinks";
import type { WorkspaceRepository } from "./repository";
import type {
  AiRequest,
  DialogMessage,
  WorkspaceAiAdapter,
  WorkspaceDocument,
  WorkspaceNode,
} from "./types";
import { t } from "../i18n/messages";
import { Listeners } from "../utils/timing";

export interface DialogJob {
  path: string;
  status: "running" | "error";
  /** The answer so far. */
  text: string;
  progress: string;
  error?: string;
  /** Tasks of other plugins ahead of this one in the shared Bridge queue. */
  queued: number;
}
interface Running extends DialogJob {
  abort: AbortController;
}
/** Dialog file properties: its own Codex thread, and whether it reads the whole book's conversation. */
export const SCOPE_KEY = "rwt_scope";
export const SCOPE_BOOK = "book";
const THREAD_KEY = "rwt_thread";
const noteKey = (note: AiRequest["notes"][number]) => note.quote + "\u0000" + note.comment;

/**
 * Sends dialog questions and stores answers in the dialog's own file. It lives outside the
 * React view, so an answer is saved even if the view is closed or another book is opened.
 */
export class DialogRunner {
  private jobs = new Map<string, Running>();
  private listeners = new Listeners();
  private snapshots = new Map<string, DialogJob>();
  /** Questions of one book go one after another, so two dialogs never start two Codex threads. */
  private turns = new Map<string, Promise<void>>();
  /** Notes already shown to a thread; they are not repeated in every later question. */
  private told = new Map<string, Set<string>>();
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly adapter: WorkspaceAiAdapter,
    private readonly notes: (
      document: WorkspaceDocument,
      dialog: WorkspaceNode,
    ) => Promise<AiRequest["notes"]>,
    private readonly saved: () => void,
    private readonly link?: (
      document: WorkspaceDocument,
      dialog: WorkspaceNode,
      readerIds: string[],
    ) => Promise<void>,
    private readonly report?: (error: unknown) => void,
  ) {}
  unavailable(): string | undefined {
    return this.adapter.unavailable();
  }
  job(path: string): DialogJob | undefined {
    return this.snapshots.get(path);
  }
  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }
  private publish(job: Running | undefined, path: string): void {
    if (job) {
      const { abort: _abort, ...visible } = job;
      this.snapshots.set(path, visible);
    } else this.snapshots.delete(path);
    this.listeners.notify();
  }
  cancel(path: string): void {
    this.jobs.get(path)?.abort.abort();
  }
  cancelAll(): void {
    for (const job of this.jobs.values()) job.abort.abort();
  }
  dismiss(path: string): void {
    if (!this.jobs.has(path)) this.publish(undefined, path);
  }
  /** Send the dialog's draft as a new question; with no draft, answer the last unanswered one. */
  async send(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    revision?: string,
  ): Promise<void> {
    if (!this.ready(dialog)) return;
    const draft = (await this.repository.takeDraft(dialog)).trim();
    if (draft) await this.ask(document, dialog, draft, dialog.sources, revision);
    await this.enqueue(document, dialog, revision);
  }
  /** Ask an earlier question again: a copy goes to the end of the dialog, so the history stays and the thread continues. */
  async resend(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    question: DialogMessage,
    revision?: string,
  ): Promise<void> {
    if (!this.ready(dialog) || !question.content.trim()) return;
    await this.ask(document, dialog, question.content, question.sources, revision);
    await this.enqueue(document, dialog, revision);
  }
  /** Throws when the adapter cannot run; false while this dialog is already being answered. */
  private ready(dialog: WorkspaceNode): boolean {
    const reason = this.adapter.unavailable();
    if (reason) throw new Error(reason);
    return !this.jobs.has(dialog.path);
  }
  /** Write the question into the dialog (and the book chat) before anything is sent. */
  private async ask(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    content: string,
    sources: string[],
    revision?: string,
  ): Promise<void> {
    const message: DialogMessage = {
      id: crypto.randomUUID(),
      role: "user",
      created: new Date().toISOString(),
      content,
      sources,
      revision,
    };
    await this.repository.appendMessage(dialog, message);
    await this.mirror(document, dialog, message);
    this.saved();
  }
  private enqueue(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    revision?: string,
  ): Promise<void> {
    const previous = this.turns.get(document.id) ?? Promise.resolve();
    const turn = previous
      .catch(() => undefined)
      .then(() => this.answer(document, dialog, revision));
    this.turns.set(document.id, turn);
    return turn;
  }
  /** Questions and answers from a note dialog also belong to the book's single chat feed. */
  private async mirror(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    message: DialogMessage,
  ): Promise<void> {
    const chat = await this.repository.chat(document);
    if (chat.path === dialog.path) return;
    await this.repository.appendMessage(chat, { ...message, origin: dialog.path });
  }
  private async answer(
    document: WorkspaceDocument,
    dialog: WorkspaceNode,
    revision?: string,
  ): Promise<void> {
    const messages = await this.repository.messages(dialog),
      question = messages[messages.length - 1];
    if (!question || question.role !== "user") return;
    const job: Running = {
      path: dialog.path,
      status: "running",
      text: "",
      progress: t("dialog.preparing"),
      queued: 0,
      abort: new AbortController(),
    };
    this.jobs.set(dialog.path, job);
    this.publish(job, dialog.path);
    try {
      const chat = await this.repository.chat(document);
      // A note's dialog is its own conversation: only the book chat, or a dialog the reader
      // switched to the whole book, shares one Codex thread and history across the book.
      const wholeBook =
        chat.path === dialog.path ||
        (await this.repository.dialogProperty(dialog, SCOPE_KEY)) === SCOPE_BOOK;
      const threadId = wholeBook
        ? await this.repository.chatThread(document)
        : await this.repository.dialogProperty(dialog, THREAD_KEY);
      // The shared feed is what a new thread is told about; a live thread remembers it.
      const feed = wholeBook ? await this.repository.messages(chat) : [];
      // Messages written before the chat existed live only in their dialog; keep them too.
      const known = new Set(feed.map((item) => item.id));
      const history = [
        ...feed,
        ...messages.filter((item) => !known.has(item.id)),
      ].filter((item) => item.id !== question.id);
      const noted = threadId ? this.told.get(threadId) : undefined;
      const everything = await this.notes(document, dialog);
      const notes = everything.filter((note) => !noted?.has(noteKey(note)));
      const answer = await this.adapter.generate(
        {
          book: { title: document.title, author: document.author },
          notes,
          history,
          question: question.content,
          threadId,
          title: `Obsidian · ${document.title}`,
        },
        {
          signal: job.abort.signal,
          onProgress: (progress) => {
            job.progress = progress;
            job.queued = this.adapter.queued();
            this.publish(job, dialog.path);
          },
          onText: (text) => {
            job.text = text;
            this.publish(job, dialog.path);
          },
        },
      );
      const { text: content, ids: marked } = takeReaderIds(answer.text);
      const readerIds = marked.length
        ? marked
        : SAVE_REQUEST.test(question.content)
          ? readerLinkIds(answer.text).slice(0, 3)
          : [];
      if (!content && !readerIds.length) throw new Error("Codex returned no text.");
      if (answer.threadId) {
        if (answer.threadId !== threadId)
          await (wholeBook
            ? this.repository.setChatThread(document, answer.threadId)
            : this.repository.setDialogProperty(dialog, THREAD_KEY, answer.threadId));
        // A new thread saw this question's notes only if it was told them; remember what it knows.
        const shown = this.told.get(answer.threadId) ?? new Set<string>();
        for (const note of everything) shown.add(noteKey(note));
        this.told.set(answer.threadId, shown);
      }
      const reply: DialogMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        created: new Date().toISOString(),
        content: content || t("dialog.savedToReader"),
        sources: dialog.sources,
        revision,
      };
      await this.repository.appendMessage(dialog, reply);
      await this.mirror(document, dialog, reply);
      // Documents Codex saved to Reader become links of this book; the answer stays even if linking fails.
      if (readerIds.length && this.link)
        await this.link(document, dialog, readerIds).catch((error: unknown) =>
          this.report?.(error),
        );
      this.jobs.delete(dialog.path);
      this.publish(undefined, dialog.path);
      this.saved();
    } catch (error) {
      this.jobs.delete(dialog.path);
      const cancelled = job.abort.signal.aborted;
      // The question stays in the file; a failed or cancelled try can be repeated.
      this.publish(
        cancelled
          ? undefined
          : { ...job, status: "error", error: readableError(error) },
        dialog.path,
      );
    }
  }
}
