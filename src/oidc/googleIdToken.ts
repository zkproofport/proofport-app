import {NativeModules, Platform} from 'react-native';
import {GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID} from '../config/GoogleAuthConfig';
import {isOidcNonce} from './oidcNonce';

/**
 * The app's own Google sign-in, because the library it replaces could not ask
 * for a nonce.
 *
 * `@react-native-google-signin/google-signin` 16.1.2's free ("Original") API
 * passes no nonce on either platform: its `signIn` takes only `loginHint`, iOS
 * calls `signInWithPresentingViewController:hint:additionalScopes:completion:`
 * and Android builds a legacy `GoogleSignInOptions`. A nonce is offered only by
 * its paid Universal Sign-In.
 *
 * Native halves, both `NativeModules.GoogleIdToken.signIn(options)`:
 *  - Android `GoogleIdTokenModule.kt`: Credential Manager,
 *    `GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce)`.
 *  - iOS `GoogleIdTokenModule.m`: GoogleSignIn 9,
 *    `signInWithPresentingViewController:hint:additionalScopes:nonce:completion:`.
 *
 * Both are given the WEB client id as server client id. Android's docs say the
 * token is then for that client; on iOS GoogleSignIn sends it as `audience` on
 * the token request (GIDSignIn.m). So `aud` should be the web client id on
 * both, and `azp` the platform's own client id -- read from source and docs,
 * not yet from a real token (device checklist in app-dev.md).
 *
 * Resolves `{idToken}`; rejects with one of NATIVE_ERROR_CODES.
 */

export const NATIVE_ERROR_CODES = [
  'CANCELLED',
  'IN_PROGRESS',
  'INVALID_INPUT',
  'NO_ACTIVITY',
  'NO_CREDENTIAL',
  'NO_ID_TOKEN',
  'KEYCHAIN',
  'REAUTH_FAILED',
  'SIGN_IN_FAILED',
] as const;
export type GoogleNativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

export type GoogleIdTokenResult =
  | {idToken: string}
  | {error: string; code: GoogleNativeErrorCode | 'UNKNOWN'; cancelled: boolean};

type NativeGoogleIdToken = {
  signIn(options: {nonce: string; serverClientId: string; iosClientId: string}): Promise<unknown>;
};

const isKnownCode = (c: unknown): c is GoogleNativeErrorCode =>
  typeof c === 'string' && (NATIVE_ERROR_CODES as readonly string[]).includes(c);

/**
 * Android only: "[16] Account reauth failed" (code REAUTH_FAILED) is what
 * Credential Manager answers when the person adds the account INSIDE the
 * picker (sign-in, 2-step verification) -- the sheet closes with no token even
 * though the account is now on the phone. Seen 2026-10-28: the same account
 * signed in at once on the next attempt. So it is retried exactly once, and
 * if that fails too it is reported as a failure, never as "cancelled".
 */
export async function signInWithGoogleNonce(nonce: string): Promise<GoogleIdTokenResult> {
  const first = await signInOnce(nonce);
  if ('error' in first && first.code === 'REAUTH_FAILED') return signInOnce(nonce);
  return first;
}

async function signInOnce(nonce: string): Promise<GoogleIdTokenResult> {
  if (!isOidcNonce(nonce)) {
    // A programming error, not something a person can fix: refuse before any sheet opens.
    throw new Error(`Google sign-in needs a 64-hex nonce, got ${JSON.stringify(nonce)}.`);
  }
  const native = NativeModules.GoogleIdToken as NativeGoogleIdToken | undefined;
  if (!native || typeof native.signIn !== 'function') {
    return {
      error: `GoogleIdToken native module is not linked in this ${Platform.OS} build.`,
      code: 'UNKNOWN',
      cancelled: false,
    };
  }
  let value: unknown;
  try {
    value = await native.signIn({
      nonce,
      serverClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
    });
  } catch (e) {
    const err = e as {code?: unknown; message?: unknown};
    const code = isKnownCode(err.code) ? err.code : 'UNKNOWN';
    const message = typeof err.message === 'string' && err.message ? err.message : String(e);
    return {error: `${message} (code=${String(err.code ?? 'none')})`, code, cancelled: code === 'CANCELLED'};
  }
  const idToken = (value as {idToken?: unknown} | null)?.idToken;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return {error: 'Google sign-in finished without an ID token.', code: 'NO_ID_TOKEN', cancelled: false};
  }
  return {idToken};
}
