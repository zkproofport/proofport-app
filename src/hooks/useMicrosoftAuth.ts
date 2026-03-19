import {useState, useCallback} from 'react';
import * as AuthSession from 'expo-auth-session';
import {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_AUTHORITY,
} from '../config/MicrosoftAuthConfig';

/**
 * Microsoft Entra ID Sign-In via expo-auth-session.
 *
 * Uses Authorization Code + PKCE flow with useAuthRequest to obtain id_token (JWT).
 * The JWT contains tid (tenant ID), email, and xms_edov claims
 * needed for organizational domain attestation.
 *
 * Returns raw id_token JWT string directly (not parsed claims).
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${MICROSOFT_AUTHORITY}/oauth2/v2.0/token`,
};

export interface UseMicrosoftAuthReturn {
  idToken: string | null;
  isReady: boolean;
  error: string | null;
  promptSignIn: () => Promise<string | null>;
  reset: () => void;
}

const redirectUri = AuthSession.makeRedirectUri({
  scheme: `msal${MICROSOFT_CLIENT_ID}`,
  path: 'auth',
});

export const useMicrosoftAuth = (): UseMicrosoftAuthReturn => {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptSignIn = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIdToken(null);

    try {
      // Use implicit flow to get id_token directly (no token exchange needed)
      const authRequest = new AuthSession.AuthRequest({
        clientId: MICROSOFT_CLIENT_ID,
        scopes: ['openid', 'email', 'profile'],
        redirectUri,
        responseType: AuthSession.ResponseType.IdToken,
        extraParams: {
          nonce: Math.random().toString(36).substring(2),
          prompt: 'select_account',
        },
      });

      const result = await authRequest.promptAsync(discovery);

      if (result.type === 'success' && result.params?.id_token) {
        const token = result.params.id_token;
        setIdToken(token);
        return token;
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setError('Microsoft sign-in was cancelled');
        return null;
      }

      if (result.type === 'error') {
        const msg = result.params?.error_description || result.params?.error || 'Microsoft sign-in failed';
        setError(msg);
        return null;
      }

      throw new Error('Microsoft Sign-In succeeded but no id_token returned. Check Azure AD app registration.');
    } catch (e: unknown) {
      const err = e as {message?: string};
      const msg = err.message || String(e);
      setError(msg);
      return null;
    }
  }, [redirectUri]);

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
