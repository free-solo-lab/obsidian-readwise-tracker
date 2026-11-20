import { startTimer, stopTimer } from "../utils/timers";
/** Reading progress mirrored to Reader: sent after a pause, only forward, and "finished" archives the document. */
export const FINISHED = 0.97;
export const PROGRESS_STEP = 0.01;
/** Fraction of the text before the block at the top of the pane, 0..1. */
export function readingProgress(blockStart: number, length: number): number {
  if (!(length > 0) || !Number.isFinite(blockStart)) return 0;
  return Math.max(0, Math.min(1, Math.round((blockStart / length) * 100) / 100));
}
/** Reader cannot store progress for PDFs, and only Reader documents have an id there. */
export const mirrorsProgress = (document: {
  readerId?: string;
  category: string;
}): boolean => !!document.readerId && document.category !== "pdf";

interface State {
  sent: number;
  archived: boolean;
  pending?: number;
  readerId?: string;
  timer?: ReturnType<typeof setTimeout>;
}
export class ProgressMirror {
  private states = new Map<string, State>();
  constructor(
    private readonly send: (readerId: string, progress: number) => Promise<void>,
    private readonly archive: (readerId: string) => Promise<void>,
    private readonly report: (error: unknown) => void,
    private readonly delay = 20_000,
  ) {}
  note(readerId: string, progress: number): void {
    const state = this.states.get(readerId) ?? { sent: 0, archived: false };
    this.states.set(readerId, state);
    const done = progress >= FINISHED && !state.archived;
    if (!done && progress < state.sent + PROGRESS_STEP) return;
    state.pending = progress;
    state.readerId = readerId;
    if (state.timer) stopTimer(state.timer);
    state.timer = startTimer(() => void this.flush(readerId), this.delay);
  }
  async flush(readerId: string): Promise<void> {
    const state = this.states.get(readerId);
    if (!state || state.pending === undefined) return;
    if (state.timer) stopTimer(state.timer);
    state.timer = undefined;
    const finished = state.pending >= FINISHED,
      value = finished ? 1 : Math.max(state.pending, state.sent);
    state.pending = undefined;
    try {
      await this.send(readerId, value);
      state.sent = value;
      if (finished && !state.archived) {
        await this.archive(readerId);
        state.archived = true;
      }
    } catch (error) {
      this.report(error);
    }
  }
  async flushAll(): Promise<void> {
    await Promise.all([...this.states.keys()].map((id) => this.flush(id)));
  }
  dispose(): void {
    for (const state of this.states.values())
      if (state.timer) stopTimer(state.timer);
  }
}
