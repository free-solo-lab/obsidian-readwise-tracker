/**
 * Timers of the window Obsidian is running in (popout windows have their own); Node's timers
 * when there is no window, as in the unit tests.
 */
export type TimerHandle = ReturnType<typeof setTimeout>;

const host = (): Pick<Window, "setTimeout" | "clearTimeout"> =>
  typeof window === "undefined" ? (global as unknown as Window) : window;

export function startTimer(callback: () => void, delay?: number): TimerHandle {
  return host().setTimeout(callback, delay) as unknown as TimerHandle;
}

export function stopTimer(handle: TimerHandle | undefined): void {
  if (handle !== undefined) host().clearTimeout(handle as unknown as number);
}
