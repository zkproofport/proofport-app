/**
 * Bridge for the "your proof was delivered — switch back yourself" notice.
 *
 * Mirrors `errorBridge.ts`. The notice is raised from `deeplink.ts`, a plain
 * utility module with no React in scope, so it cannot call a hook or a context.
 * `ReturnNoticeModal` registers itself as the handler once, at mount, and the
 * utility layer calls `showReturnNotice()` without knowing anything about the
 * component tree.
 *
 * This is NOT an error, so it deliberately does not go through the ErrorModal /
 * error-code system: the proof succeeded and was delivered. It is a success
 * notice whose only job is to stop the user waiting for an app switch that is
 * never going to come, because on iOS outside Chrome there is no public way to
 * make one happen.
 */

/**
 * Which ending the user is being told about.
 *
 * `declined` exists so the reject path cannot claim a proof was delivered when
 * the user just refused to make one.
 */
export type ReturnNoticeKind = 'delivered' | 'declined';

type ReturnNoticeHandler = (kind: ReturnNoticeKind) => void;

let _returnNoticeHandler: ReturnNoticeHandler | null = null;

export function registerReturnNoticeHandler(handler: ReturnNoticeHandler): void {
  _returnNoticeHandler = handler;
}

/**
 * Show the notice. Safe to call before any handler is registered — it logs and
 * moves on, because a missing modal must never break the proof success path.
 */
export function showReturnNotice(kind: ReturnNoticeKind = 'delivered'): void {
  if (_returnNoticeHandler) {
    _returnNoticeHandler(kind);
  } else {
    console.log(`[DeepLink] Return notice (${kind}) raised with no handler registered`);
  }
}

/** Test seam: drop the handler so suites do not leak into one another. */
export function resetReturnNoticeHandler(): void {
  _returnNoticeHandler = null;
}
