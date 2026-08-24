// Bridge to pass deep link URLs into App.tsx's handleDeepLink without going
// through Linking.openURL (which may mangle the URL). Two callers use it:
// QRScanScreen, and the OpenStoa mini-app's self-relay login.
import type {ProofRequestOrigin} from './deeplink';

type DeepLinkHandler = (url: string, origin: ProofRequestOrigin) => void;

let _handler: DeepLinkHandler | null = null;

export function registerDeepLinkHandler(handler: DeepLinkHandler) {
  _handler = handler;
}

/**
 * Feed a deep link into the app's own pipeline.
 *
 * `origin` is required, and never `'link'`: a URL that arrives here did not
 * come from another app opening our scheme, so there is nothing behind us to
 * hand the user back to when the proof completes. Making it explicit at the
 * call site is what keeps a future third caller from silently inheriting the
 * wrong answer. See `ProofRequestOrigin`.
 */
export function triggerDeepLink(
  url: string,
  origin: Exclude<ProofRequestOrigin, 'link'>,
) {
  _handler?.(url, origin);
}
