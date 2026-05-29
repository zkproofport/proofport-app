/**
 * OacxResultBus — in-memory single-use promise bridge between
 * OacxWebViewScreen (publisher) and useMdlKr (awaiter).
 *
 * React Navigation does not serialise function callbacks in route params,
 * so we cannot pass a resolve/reject directly. Instead the screen calls
 * publishResult() and the hook calls awaitNextResult() before navigating.
 *
 * Usage pattern:
 *   // hook side (before navigate):
 *   const resultPromise = oacxResultBus.awaitNextResult(5 * 60 * 1000);
 *   navigation.navigate('OacxWebView', { provider, scope });
 *   const result = await resultPromise;
 *
 *   // screen side (in onMessage handler):
 *   oacxResultBus.publishResult(parsedPayload);
 */

import type {OacxParsedToken} from './oacxClient';

export type OacxBusResult =
  | {ok: true; payload: OacxParsedToken}
  | {ok: false; error: string};

type Resolver = (result: OacxBusResult) => void;

let pending: Resolver | null = null;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns a promise that resolves when publishResult() is called.
 * Only one awaiter is active at a time; calling awaitNextResult() while
 * one is already waiting cancels the previous one with an error.
 *
 * @param timeoutMs Maximum wait time (default 5 minutes).
 */
export function awaitNextResult(timeoutMs = 300_000): Promise<OacxBusResult> {
  // Cancel any stale awaiter
  if (pending !== null) {
    const stale = pending;
    pending = null;
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    stale({ok: false, error: 'OacxResultBus: superseded by new awaiter'});
  }

  return new Promise<OacxBusResult>((resolve) => {
    pending = resolve;
    timeoutHandle = setTimeout(() => {
      if (pending === resolve) {
        pending = null;
        timeoutHandle = null;
        resolve({ok: false, error: 'OacxResultBus: timed out waiting for WebView result'});
      }
    }, timeoutMs);
  });
}

/**
 * Called by OacxWebViewScreen when the OACX widget posts a result via
 * window.ReactNativeWebView.postMessage.
 */
export function publishResult(result: OacxBusResult): void {
  if (pending !== null) {
    const resolver = pending;
    pending = null;
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    resolver(result);
  }
}

/**
 * Cancel any pending awaiter without resolving it (e.g., on app background).
 */
export function cancelPending(reason = 'OacxResultBus: cancelled'): void {
  if (pending !== null) {
    const resolver = pending;
    pending = null;
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    resolver({ok: false, error: reason});
  }
}
