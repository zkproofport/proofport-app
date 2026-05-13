import {useState, useCallback} from 'react';
import {Platform} from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID} from '../config/GoogleAuthConfig';

/**
 * Google Sign-In via @react-native-google-signin/google-signin.
 *
 * Uses native platform sign-in (Credential Manager on Android, Google Sign-In SDK on iOS).
 * No client_secret, no redirect URI needed — only webClientId for id_token.
 *
 * Returns id_token (JWT with email, email_verified, sub) directly.
 */

// Configure at module level — runs once when the module is imported.
// This ensures isReady is always true by the time any hook consumer renders.
GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
});

export interface UseGoogleAuthReturn {
  idToken: string | null;
  isReady: boolean;
  error: string | null;
  promptSignIn: () => Promise<string | null>;
  reset: () => void;
}

export const useGoogleAuth = (): UseGoogleAuthReturn => {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptSignIn = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIdToken(null);

    const attempt = async (): Promise<string | null> => {
      // hasPlayServices is Android-only — skip on iOS
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices();
      }
      const response = await GoogleSignin.signIn();
      if (isSuccessResponse(response)) {
        const token = response.data.idToken;
        if (token) return token;
        throw new Error('Google Sign-In succeeded but no id_token returned. Ensure webClientId is configured.');
      }
      throw new Error('Google Sign-In failed: unexpected response');
    };

    try {
      const token = await attempt();
      if (token) {
        setIdToken(token);
        return token;
      }
      return null;
    } catch (e: unknown) {
      const err = e as {code?: string; message?: string};
      console.log('[GoogleAuth] signIn error (attempt 1)', {code: err.code, message: err.message});

      // GIDSignInErrorCode.keychain (-2): the SDK could not read/write its
      // keychain entry. This is a known iOS-simulator issue when the bundle's
      // keychain-access-groups entitlement can't be resolved without a
      // provisioning profile. Recover by signing out (which clears any
      // stale partial keychain record the SDK left behind) and retrying once.
      if (err.code === '-2' || err.message?.toLowerCase().includes('keychain')) {
        try {
          await GoogleSignin.signOut();
        } catch (_signOutErr) {
          // best-effort — even if signOut fails, the retry can still succeed
        }
        try {
          const token = await attempt();
          if (token) {
            setIdToken(token);
            return token;
          }
        } catch (e2: unknown) {
          const err2 = e2 as {code?: string; message?: string};
          console.log('[GoogleAuth] signIn error (attempt 2)', {code: err2.code, message: err2.message});
          setError(
            `Google Sign-In keychain error persisted after retry (code=${err2.code ?? 'unknown'}, msg=${err2.message ?? 'none'}). ` +
              `This typically requires rebuilding the app with a valid keychain-access-groups entitlement.`,
          );
          return null;
        }
      }

      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        setError(`Google sign-in was cancelled (code=${err.code}, msg=${err.message ?? 'none'})`);
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError('Google sign-in already in progress');
      } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services not available');
      } else {
        const msg = err.message || String(e);
        setError(`${msg} (code=${err.code ?? 'unknown'})`);
      }

      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setIdToken(null);
    setError(null);
    GoogleSignin.signOut().catch(() => {});
  }, []);

  return {
    idToken,
    isReady: true, // Always ready — configured at module level
    error,
    promptSignIn,
    reset,
  };
};
