import { startTimer, stopTimer } from "./timers";
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  /** Drop the pending call, if any. */
  cancel(): void;
  /** Run the pending call now, if any. */
  flush(): void;
}

/** Runs `task` once `delayMs` after the last call; every call restarts the timer. */
export function debounce<Args extends unknown[]>(
  task: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Args | undefined;
  const debounced = ((...args: Args) => {
    if (timer) stopTimer(timer);
    pending = args;
    timer = startTimer(() => {
      timer = undefined;
      pending = undefined;
      task(...args);
    }, delayMs);
  }) as Debounced<Args>;
  debounced.flush = () => {
    if (!timer || !pending) return;
    stopTimer(timer);
    const args = pending;
    timer = undefined;
    pending = undefined;
    task(...args);
  };
  debounced.cancel = () => {
    if (timer) stopTimer(timer);
    timer = undefined;
    pending = undefined;
  };
  return debounced;
}

/** Let the event loop run (rendering, input) between chunks of long synchronous work. */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => startTimer(resolve, 0));

/** A minimal subscribe/notify pair shared by the workspace's background runners. */
export class Listeners {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  clear(): void {
    this.listeners.clear();
  }
}
