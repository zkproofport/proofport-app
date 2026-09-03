/**
 * Holds a navigation until there is somewhere to navigate to.
 *
 * A deep link can arrive before the navigator exists. On a cold start the
 * launch URL is handled ~500 ms in, while LoadingScreen still owns the screen
 * (it holds for at least SPLASH_DURATION = 3 s, longer while circuit files are
 * downloading) — and LoadingScreen is an early return in App, so
 * <NavigationContainer> is not mounted and its ref is still null. Dispatching
 * into that null ref is silently dropped: the app opens, the request validates
 * against the relay, and then nothing happens.
 *
 * Reproduced 2026-09-03 on the emulator with a relay-registered Korea mobile ID
 * link. Killed app: the log printed "navigating directly" and the screen never
 * left Verify home, so the document-type sheet never mounted. The same link
 * with the app already open reached the proof screen and raised the sheet.
 *
 * Only that path was affected: every other proof request travels as React state
 * (the confirmation modal), which survives the loading gate and renders once
 * the tree is up. Imperative navigation does not survive, so it is parked here
 * and replayed from the container's onReady.
 */

export interface NavigationQueueOptions<Action> {
  /** Hand the action to the navigator. Only called when isReady() is true. */
  dispatch: (action: Action) => void;
  /**
   * Record a request as being handled. Called only after dispatch, never
   * before — claiming a request whose navigation was dropped makes the loss
   * permanent, because reopening the same link is then skipped as "already
   * being processed".
   */
  claimRequest: (requestId: string) => void;
  /** Whether the navigator is mounted and accepting actions. */
  isReady: () => boolean;
  log?: (message: string) => void;
}

export interface NavigationQueue<Action> {
  /** Dispatch now if the navigator is up, otherwise park until flush(). */
  navigate: (action: Action, requestId: string | null) => void;
  /** Replay a parked navigation. Returns whether one was waiting. */
  flush: () => boolean;
  /** Whether a navigation is currently parked. */
  hasPending: () => boolean;
}

export function createNavigationQueue<Action>(
  options: NavigationQueueOptions<Action>,
): NavigationQueue<Action> {
  const {dispatch, claimRequest, isReady, log} = options;

  let pending: {action: Action; requestId: string | null} | null = null;

  const run = (item: {action: Action; requestId: string | null}) => {
    dispatch(item.action);
    if (item.requestId) {
      claimRequest(item.requestId);
    }
  };

  return {
    navigate(action, requestId) {
      if (isReady()) {
        run({action, requestId});
        return;
      }
      // Only the newest destination is worth keeping: there is one screen to
      // land on, and replaying a superseded one would bounce the user through
      // a screen they never asked for.
      log?.('[App] Navigation not ready — queueing until container is up');
      pending = {action, requestId};
    },

    flush() {
      if (!pending) {
        return false;
      }
      const item = pending;
      // Cleared before running so a dispatch that throws cannot leave the
      // entry behind to be replayed on the next flush.
      pending = null;
      log?.('[App] Navigation ready — replaying queued navigation');
      run(item);
      return true;
    },

    hasPending() {
      return pending !== null;
    },
  };
}
