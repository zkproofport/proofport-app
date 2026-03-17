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

    try {
      // hasPlayServices is Android-only — skip on iOS
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices();
      }

      const response = await GoogleSignin.signIn();

      if (isSuccessResponse(response)) {
        const token = response.data.idToken;
        if (token) {
          setIdToken(token);
          return token;
        }
        throw new Error('Google Sign-In succeeded but no id_token returned. Ensure webClientId is configured.');
      }

      throw new Error('Google Sign-In failed: unexpected response');
    } catch (e: unknown) {
      const err = e as {code?: string; message?: string};

      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        setError('Google sign-in was cancelled');
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError('Google sign-in already in progress');
      } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services not available');
      } else {
        const msg = err.message || String(e);
        setError(msg);
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
