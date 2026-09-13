/**
 * What a sign-in returns: a token, or the reason there is none.
 *
 * Both identity hooks used to answer `string | null` and keep the reason in
 * their own `error` state. A caller reading that state immediately after
 * `await promptSignIn()` gets the value from the render still in flight —
 * which is `null`, because the hook clears it when sign-in starts. So the
 * proof screen reported "Sign-In was cancelled" for everything: a dismissed
 * sheet, a keychain failure, a missing id_token. Seen on 2026-09-12, where an
 * 18-second keychain retry read exactly like a person tapping Close.
 *
 * The reason travels WITH the answer now. Nothing can read it too early
 * because there is nothing else to read.
 */
export type SignInResult =
  | {token: string}
  | {
      /** Why there is no token, in words a person can act on. */
      error: string;
      /** True only when the person themselves dismissed the sheet. */
      cancelled: boolean;
    };

export const signedIn = (token: string): SignInResult => ({token});

export const signInFailed = (error: string, cancelled = false): SignInResult => ({
  error,
  cancelled,
});
