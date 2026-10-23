import {useState, useCallback} from 'react';
import {signedIn, signInFailed, type SignInResult} from './signInResult';
import {isOidcNonce} from '../oidc/oidcNonce';
import {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_AUTHORITY,
} from '../config/MicrosoftAuthConfig';

/**
 * Microsoft Entra ID Sign-In via expo-auth-session.
 *
 * Uses implicit flow to obtain id_token (JWT).
 * The JWT contains tid (tenant ID), email, and xms_edov claims
 * needed for organizational domain attestation.
 *
 * Returns raw id_token JWT string directly (not parsed claims).
 *
 * The nonce is the caller's, derived for this proof request
 * (src/oidc/oidcNonce.ts); the caller checks the token carries it. It used to
 * be Math.random(), which bound the token to nothing anyone could check.
 */

export interface UseMicrosoftAuthReturn {
  idToken: string | null;
  isReady: boolean;
  error: string | null;
  promptSignIn: (nonce: string) => Promise<SignInResult>;
  reset: () => void;
}

export const useMicrosoftAuth = (): UseMicrosoftAuthReturn => {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptSignIn = useCallback(async (nonce: string): Promise<SignInResult> => {
    setError(null);
    setIdToken(null);

    if (!isOidcNonce(nonce)) {
      const msg = `Microsoft sign-in needs a 64-hex nonce, got ${JSON.stringify(nonce)}.`;
      setError(msg);
      return signInFailed(msg);
    }

    try {
      // Lazy import expo-auth-session to avoid module-level crash in Release builds
      const AuthSession = require('expo-auth-session');

      // Use explicit native redirect URI — same in Debug and Release
      const redirectUri = `msal${MICROSOFT_CLIENT_ID}://auth`;
      console.log('[MicrosoftAuth] redirectUri:', redirectUri);

      const discovery = {
        authorizationEndpoint: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize`,
        tokenEndpoint: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`,
      };

      const authRequest = new AuthSession.AuthRequest({
        clientId: MICROSOFT_CLIENT_ID,
        scopes: ['openid', 'email', 'profile'],
        redirectUri,
        responseType: AuthSession.ResponseType.IdToken,
        extraParams: {
          nonce,
          prompt: 'select_account',
        },
      });

      const result = await authRequest.promptAsync(discovery);
      // Key names only: the params carry the ID token, a bearer credential.
      console.log('[MicrosoftAuth] result type:', result.type, 'param keys:', Object.keys(result.params ?? {}).join(','));

      if (result.type === 'success' && result.params?.id_token) {
        const token = result.params.id_token;
        setIdToken(token);
        return signedIn(token);
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        const message = 'Microsoft sign-in was cancelled';
        setError(message);
        return signInFailed(message, true);
      }

      if (result.type === 'error') {
        const msg = result.params?.error_description || result.params?.error || 'Microsoft sign-in failed';
        setError(msg);
        return signInFailed(msg);
      }

      const noToken =
        'Microsoft Sign-In returned without an id_token. Check the Azure AD app registration.';
      setError(noToken);
      return signInFailed(noToken);
    } catch (e: unknown) {
      // Returned, not thrown. A thrown error and a returned one were handled by
      // two different branches in the proof screen, and only one of them showed
      // the reason.
      const err = e as {message?: string};
      const msg = err.message || String(e);
      console.error('[MicrosoftAuth] Error:', msg);
      setError(msg);
      return signInFailed(msg);
    }
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
