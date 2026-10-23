import {useState, useCallback} from 'react';
import {signedIn, signInFailed, type SignInResult} from './signInResult';
import {signInWithGoogleNonce} from '../oidc/googleIdToken';

/**
 * Google sign-in for an OIDC proof, through the app's own native module
 * (`src/oidc/googleIdToken.ts`), so the ID token carries the nonce the caller
 * derived for this request. The caller checks the returned token's nonce.
 */

export interface UseGoogleAuthReturn {
  idToken: string | null;
  isReady: boolean;
  error: string | null;
  promptSignIn: (nonce: string) => Promise<SignInResult>;
  reset: () => void;
}

export const useGoogleAuth = (): UseGoogleAuthReturn => {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptSignIn = useCallback(async (nonce: string): Promise<SignInResult> => {
    setError(null);
    setIdToken(null);
    let result: Awaited<ReturnType<typeof signInWithGoogleNonce>>;
    try {
      result = await signInWithGoogleNonce(nonce);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return signInFailed(message);
    }
    if ('idToken' in result) {
      setIdToken(result.idToken);
      return signedIn(result.idToken);
    }
    console.log('[GoogleAuth] signIn failed', {code: result.code, message: result.error});
    const message = result.cancelled
      ? `Google sign-in was cancelled (${result.error})`
      : result.code === 'KEYCHAIN'
        ? `${result.error}. On a simulator this is the missing keychain-access-groups entitlement; use a device.`
        : result.error;
    setError(message);
    return signInFailed(message, result.cancelled);
  }, []);

  const reset = useCallback(() => {
    setIdToken(null);
    setError(null);
  }, []);

  return {
    idToken,
    isReady: true,
    error,
    promptSignIn,
    reset,
  };
};
