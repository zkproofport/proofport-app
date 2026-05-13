// Use AsyncStorage instead of expo-secure-store on the host because the
// iOS simulator does not have the keychain entitlements that SecureStore
// requires; host's existing Privy adapter follows the same pattern.
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { getLanguage } from '../i18n';
import type { NavigationContainerRef } from '@react-navigation/native';
import type {
  HostApi,
  HostEnvironmentInfo,
  ProofInputs,
  ProofResult,
  AuthResult,
} from '@openstoa/miniapp-bridge';
import type { TabParamList } from '../navigation/types';
import { triggerDeepLink } from '../utils/deepLinkBridge';

const TOKEN_KEY = 'openstoa.token.v1';
const USER_ID_KEY = 'openstoa.userId.v1';
const NICKNAME_KEY = 'openstoa.nickname.v1';
const EXPIRES_AT_KEY = 'openstoa.expiresAt.v1';
// Set to '1' on explicit logout so the convenience auto-login in __DEV__
// stays suppressed across OpenStoa tab re-entries until the user explicitly
// logs in again. Cleared by login.
const LOGGED_OUT_KEY = 'openstoa.loggedOut.v1';

export interface CreateZkProofportHostApiOptions {
  /**
   * Reference to the root navigation container so exitToHost() can jump
   * the user back to a host tab (Verify by default).
   */
  getNavigation: () => NavigationContainerRef<TabParamList> | null;

  /** OpenStoa server base URL (no trailing slash). */
  baseUrl: string;

  /** Show errors using the host's error UX. */
  showError: (code: string, details?: Record<string, unknown>) => void;

  /** Optional haptic hook. */
  haptic?: (type: 'light' | 'medium' | 'heavy' | 'selection') => void;

  /** Returns the current host theme mode synchronously. */
  getTheme: () => 'light' | 'dark';

  /**
   * Subscribe to host theme changes. Returns an unsubscribe function.
   */
  subscribeTheme: (cb: (mode: 'light' | 'dark') => void) => () => void;
}

/**
 * Implements the HostApi contract for ZKProofport (the embedding host).
 * The mobile mini-app (openstoa-mobile) calls into this API via
 * <HostProvider api={...}>; nothing in openstoa-mobile imports React Native
 * native modules directly — they all flow through here.
 */
export function createZkProofportHostApi(
  opts: CreateZkProofportHostApiOptions,
): HostApi {
  const { getNavigation, baseUrl, showError, haptic, getTheme, subscribeTheme } = opts;

  const env: HostEnvironmentInfo = {
    isEmbedded: true,
    hostName: 'zkproofport',
    platform: undefined,
    openstoaBaseUrl: baseUrl,
  };

  async function readToken(): Promise<string | null> {
    return (await AsyncStorage.getItem(TOKEN_KEY)) ?? null;
  }

  async function writeAuth(auth: AuthResult & { expiresAt?: number }): Promise<void> {
    await AsyncStorage.setItem(TOKEN_KEY, auth.token);
    await AsyncStorage.setItem(USER_ID_KEY, auth.userId);
    if (auth.expiresAt) {
      await AsyncStorage.setItem(EXPIRES_AT_KEY, String(auth.expiresAt));
    }
  }

  async function clearAuth(): Promise<void> {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_ID_KEY);
    await AsyncStorage.removeItem(NICKNAME_KEY);
    await AsyncStorage.removeItem(EXPIRES_AT_KEY);
  }

  // Self-relay proof flow: get a proof-request from the OpenStoa server,
  // self-trigger the resulting deep link to drive the host's existing
  // ProofGenerationScreen pipeline (same code path as a 3rd-party dapp
  // request), then poll for the resulting JWT.
  async function runSelfRelayLogin(): Promise<AuthResult> {
    // Match the web ProofGate behavior for login: only specify circuitType.
    // Do NOT send `provider`/`domain` — the web's `<ProofGate circuitType=
    // "oidc_domain_attestation" mode="login" />` (openstoa/src/app/page.tsx)
    // sends just { circuitType } so the relay accepts any verified Google
    // (or Microsoft) identity instead of forcing a Workspace-affiliation
    // proof. Sending `provider: 'google'` here previously caused the relay
    // to compose a "Verify Google Workspace affiliation" message which made
    // the modal demand a Workspace-bound account.
    const reqRes = await fetch(`${baseUrl}/api/auth/proof-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        circuitType: 'oidc_domain_attestation',
      }),
    });
    if (!reqRes.ok) {
      throw new Error(`proof-request failed (${reqRes.status}): ${await reqRes.text()}`);
    }
    const reqData = (await reqRes.json()) as { requestId: string; deepLink: string };
    if (!reqData.requestId || !reqData.deepLink) {
      throw new Error('proof-request response missing requestId or deepLink');
    }

    // Self-trigger the deep link via the in-process bridge — this avoids
    // bouncing through Linking.openURL and keeps the URL exactly as issued.
    triggerDeepLink(reqData.deepLink);

    // Poll the OpenStoa server for completion. The server polls its relay
    // and verifies the proof on-chain before returning a session token.
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 240; // ≈ 6 minutes total
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      let pollRes: Response;
      try {
        pollRes = await fetch(
          `${baseUrl}/api/auth/poll/${encodeURIComponent(reqData.requestId)}?format=token`,
        );
      } catch (e) {
        // transient network — keep retrying
        continue;
      }
      if (pollRes.status === 404) {
        throw new Error('Proof request expired or not found');
      }
      if (!pollRes.ok) {
        // 5xx etc — keep retrying
        continue;
      }
      const data = (await pollRes.json()) as
        | { status: 'pending' | 'failed' }
        | {
            status: 'completed';
            userId: string;
            needsNickname?: boolean;
            token?: string;
          };
      if (data.status === 'failed') {
        throw new Error('Proof generation failed');
      }
      if (data.status === 'completed') {
        if (!data.token) {
          throw new Error('Poll completed but token missing in response');
        }
        const auth: AuthResult = {
          token: data.token,
          userId: data.userId,
          needsNickname: !!data.needsNickname,
        };
        await writeAuth({
          ...auth,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        await AsyncStorage.removeItem(LOGGED_OUT_KEY);
        // Return the user back to the OpenStoa tab once login completes.
        const nav = getNavigation();
        try {
          nav?.navigate('OpenStoaTab' as never);
        } catch {
          // navigation may not be ready yet; the OpenStoaApp re-render will
          // pick up the token regardless.
        }
        return auth;
      }
      // pending — keep polling
    }
    throw new Error('Proof generation timed out waiting for relay');
  }

  return {
    getEnvironment: () => env,

    getOpenStoaToken: async () => readToken(),

    loginToOpenStoa: async ({ force }: { force?: boolean } = {}) => {
      if (!force) {
        const existing = await readToken();
        if (existing) {
          const userId = (await AsyncStorage.getItem(USER_ID_KEY)) ?? '';
          return { token: existing, userId, needsNickname: false };
        }
        // No token on first entry: surface the logged-out screen so the user
        // explicitly taps "Sign in" before any proof flow runs.
        throw new Error('LOGGED_OUT');
      }

      // Explicit Sign-in (force=true): drive the real self-relay ZK proof
      // flow via the host's existing ProofGenerationScreen pipeline.
      return runSelfRelayLogin();
    },

    logoutFromOpenStoa: async () => {
      await clearAuth();
      // Mark as explicitly logged out so the next OpenStoa tab entry
      // does not silently re-authenticate via the dev shortcut.
      await AsyncStorage.setItem(LOGGED_OUT_KEY, '1');
    },

    generateProof: async (_inputs: ProofInputs): Promise<ProofResult> => {
      // TODO: bridge into the existing host proof-generation hooks
      // (useCoinbaseKyc, useCoinbaseCountry, useOidcDomain) so that the
      // OpenStoa mini-app can request topic-level proofs (country, domain).
      throw new Error('HostApi.generateProof: not yet wired to mopro');
    },

    exitToHost: (targetTab) => {
      const nav = getNavigation();
      if (!nav) return;
      const target = (targetTab ?? 'ProofTab') as keyof TabParamList;
      try {
        nav.navigate(target as never);
      } catch (err) {
        showError('E5_OPENSTOA_EXIT', { reason: err instanceof Error ? err.message : String(err) });
      }
    },

    showError,
    haptic,

    getLanguage: () => getLanguage(),

    onLanguageChange: (listener: (lang: 'en' | 'ko') => void) => {
      const handler = (lang: string) => {
        const coerced: 'en' | 'ko' = lang === 'ko' ? 'ko' : 'en';
        listener(coerced);
      };
      i18n.on('languageChanged', handler);
      return () => i18n.off('languageChanged', handler);
    },

    getTheme: () => getTheme(),

    onThemeChange: (listener: (mode: 'light' | 'dark') => void) => subscribeTheme(listener),
  };
}

export const __INTERNAL_KEYS = {
  TOKEN_KEY,
  USER_ID_KEY,
  NICKNAME_KEY,
  EXPIRES_AT_KEY,
};
