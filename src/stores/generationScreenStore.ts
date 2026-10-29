/**
 * Whether the proof screen on the Proof stack is holding the review of a new
 * request.
 *
 * App.tsx keeps a newly arrived request's review closed while a proof screen
 * is on the stack, so a new request never takes over a running proof's
 * callback. A screen whose attempt has ENDED (failed or cancelled, showing
 * "try again") is not running anything; holding the review there left the
 * new request invisible underneath it until the person happened to go back
 * (seen on a Galaxy A23, 2026-10-29). So the screen says when it is idle:
 *
 *   busy  a relay request was accepted and is about to start, or an attempt
 *         is running: the review waits (the existing queue policy).
 *   idle  an in-app screen nobody has started, or an attempt that ended:
 *         a new request comes to the front, and accepting it replaces the
 *         screen with a fresh one.
 *
 * The default is busy, so a screen that never reports is held as before.
 */
let idle = false;
let owner: object | null = null;
const listeners = new Set<() => void>();

/**
 * A proof screen mounted: it owns the state until another one mounts. Its
 * release is ignored once a newer screen has taken over, so an old screen
 * unmounting after its replacement mounted cannot overwrite the new state.
 */
export function claimGenerationScreen(screen: object, busy: boolean): void {
  owner = screen;
  if (busy) markGenerationScreenBusy();
  else markGenerationScreenIdle();
}

export function releaseGenerationScreen(screen: object): void {
  if (owner !== screen) return;
  owner = null;
  idle = false;
}

/** The screen's attempt ended, or it has not started one; a waiting review may open. */
export function markGenerationScreenIdle(): void {
  idle = true;
  for (const listener of [...listeners]) listener();
}

/** An attempt is starting or a request was handed to the screen. */
export function markGenerationScreenBusy(): void {
  idle = false;
}

export function isGenerationScreenIdle(): boolean {
  return idle;
}

/** Called each time the screen becomes idle. Returns the unsubscribe. */
export function onGenerationScreenIdle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
