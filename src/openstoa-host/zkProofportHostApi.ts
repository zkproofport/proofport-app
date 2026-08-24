// Use AsyncStorage instead of expo-secure-store on the host because the
// iOS simulator does not have the keychain entitlements that SecureStore
// requires.
import AsyncStorage from '@react-native-async-storage/async-storage';
// Secure storage for the mini-app's E2EE chat MLS state (iOS Keychain /
// Android Keystore). Unlike the token (kept in AsyncStorage), MLS leaf state is
// sensitive key material, so it goes in the platform secure store. The
// keychain-access-groups entitlement (ProofportApp.entitlements) makes this
// work on the simulator too — verified storing 8KB values round-trip on both
// iOS sim and Android emulator.
import * as SecureStore from 'expo-secure-store';
// Phase 6 push (design §13): expo-notifications fronts BOTH APNs + FCM through
// Expo push tokens; expo-device gates on a physical device (simulators have no
// push token); expo-crypto mints the stable opaque routing handle; expo-constants
// reads the EAS projectId needed to obtain an Expo push token.
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import i18n, { getLanguage } from '../i18n';
import { OPENSTOA_ENABLED } from '../config';
import {
  startPushTapBridge,
  subscribeHostPushTap,
  subscribeHostPushReceived,
} from './pushTapBridge';
import { registerForPushWithDeps } from './pushRegistration';
import { clearDeliveredForTopic } from './pushClearing';
import { fetchWithDeadline } from './fetchWithDeadline';
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
// Phase 6 push (design §13): the stable, client-generated opaque routing handle
// the near-blind gateway maps to this device's push token. Generated once and
// persisted; NO rotation in Phase A.
const PUSH_HANDLE_KEY = 'openstoa.push.handle.v1';

// Notification tap routing (design §13, P-O gap 5) lives in ./pushTapBridge so
// it can be unit-tested without a react-native runtime. Started at import time
// rather than on mini-app mount: this module is reached from the host's tab
// navigator (TabNavigator -> OpenStoaStackNavigator -> OpenStoaRootScreen),
// which RN evaluates during startup even though the tab itself mounts lazily,
// so a tap is never missed for want of a listener. Gated on OPENSTOA_ENABLED so
// a build without the mini-app registers no OS listener at all.
if (OPENSTOA_ENABLED) startPushTapBridge(Notifications);

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

  /** Returns the host's current Developer Mode toggle synchronously. */
  getDeveloperMode: () => boolean;

  /**
   * Subscribe to host Developer Mode toggle changes. Returns an
   * unsubscribe function.
   */
  subscribeDeveloperMode: (cb: (enabled: boolean) => void) => () => void;
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
  const {
    getNavigation,
    baseUrl,
    showError,
    haptic,
    getTheme,
    subscribeTheme,
    getDeveloperMode,
    subscribeDeveloperMode,
  } = opts;

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

  // Dev-only shortcut: skip the real OIDC ZK-proof login (which needs Google
  // sign-in + relay + on-chain) and mint a local session via the community's
  // /api/auth/dev-login endpoint (available only when APP_ENV !== production).
  // Lets the mini-app authenticate against the LOCAL backend on a simulator /
  // emulator so in-app chat can be exercised end-to-end.
  async function devLogin(): Promise<AuthResult> {
    let res: Response;
    try {
      res = await fetchWithDeadline(
        `${baseUrl}/api/auth/dev-login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        { label: 'dev-login' },
      );
    } catch (e) {
      // Surface the exact URL we tried so a network failure is diagnosable on
      // the device (RN 0.81 moved JS console logs to DevTools).
      throw new Error(
        `dev-login network error → ${baseUrl}/api/auth/dev-login : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      throw new Error(`dev-login failed: HTTP ${res.status} against ${baseUrl}`);
    }
    const data = (await res.json()) as { token: string; userId: string };
    await writeAuth({ token: data.token, userId: data.userId, needsNickname: false });
    await AsyncStorage.removeItem(LOGGED_OUT_KEY);
    return { token: data.token, userId: data.userId, needsNickname: false };
  }

  // Self-relay proof flow: get a proof-request from the OpenStoa server,
  // self-trigger the resulting deep link to drive the host's existing
  // ProofGenerationScreen pipeline (same code path as a 3rd-party dapp
  // request), then poll for the resulting JWT.
  async function runSelfRelayLogin(
    method: 'oidc' | 'mdl' = 'oidc',
  ): Promise<AuthResult> {
    // Map the high-level method to the circuit-type the relay accepts.
    // Both branches converge in the same proof-request -> deeplink -> poll
    // pipeline; only the circuit changes.
    // For mDL login we use the ownership predicate in anonymous mode
    // (disclose_flags = 0). The resulting nullifier is the user's
    // sybil-resistant identity for the openstoa:login scope.
    const circuitType =
      method === 'mdl' ? 'mdl_kr_ownership' : 'oidc_domain_attestation';

    // Match the web ProofGate behavior for login: only specify circuitType.
    // Do NOT send `provider`/`domain` — the web's `<ProofGate circuitType=
    // "oidc_domain_attestation" mode="login" />` (openstoa/src/app/page.tsx)
    // sends just { circuitType } so the relay accepts any verified Google
    // (or Microsoft) identity instead of forcing a Workspace-affiliation
    // proof. Sending `provider: 'google'` here previously caused the relay
    // to compose a "Verify Google Workspace affiliation" message which made
    // the modal demand a Workspace-bound account.
    const reqRes = await fetchWithDeadline(
      `${baseUrl}/api/auth/proof-request`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitType,
        }),
        // Skip the iOS shared cookie store — we authenticate via headers
        // (or no auth at all). Sending stale cookies caused the server to
        // treat logged-out users as still-signed-in.
        credentials: 'omit',
      },
      { label: 'proof-request' },
    );
    if (!reqRes.ok) {
      throw new Error(`proof-request failed (${reqRes.status}): ${await reqRes.text()}`);
    }
    const reqData = (await reqRes.json()) as { requestId: string; deepLink: string };
    if (!reqData.requestId || !reqData.deepLink) {
      throw new Error('proof-request response missing requestId or deepLink');
    }

    // Self-trigger the deep link via the in-process bridge — this avoids
    // bouncing through Linking.openURL and keeps the URL exactly as issued.
    //
    // 'self' is load-bearing, not documentation: the request that comes back
    // out of this pipeline finishes by handing the user back to "the
    // requester", and the requester is this app. On Android that used to mean
    // moveTaskToBack() the moment the proof was delivered — the app dropped
    // out from under the user mid-login, and only re-entering it revealed that
    // the poll below had carried on and succeeded.
    triggerDeepLink(reqData.deepLink, 'self');

    // Poll the OpenStoa server for completion. The server polls its relay
    // and verifies the proof on-chain before returning a session token.
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 240; // ≈ 6 minutes total
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      let pollRes: Response;
      try {
        /*
         * DEADLINED, and this is the important one.
         *
         * It was a bare `await fetch(...)`, and `fetch` has no timeout — so a
         * single request the server accepted and never answered stopped this
         * loop where it stood. Not for six minutes: forever. `i` never
         * advanced, the "timed out waiting for relay" throw below was never
         * reached, and `loginToOpenStoa` never settled — which is exactly what
         * the mini-app cannot recover from with a `catch`, and exactly what
         * left a device on "Preparing your anonymous identity…" until it was
         * force-quit.
         *
         * With a deadline the same stall costs one attempt out of 240, because
         * the `catch` below already treats a failed attempt as "keep trying".
         */
        pollRes = await fetchWithDeadline(
          `${baseUrl}/api/auth/poll/${encodeURIComponent(reqData.requestId)}?format=token`,
          { credentials: 'omit' },
          { label: 'auth-poll' },
        );
      } catch {
        // transient network, or an attempt that ran out of time — keep retrying
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
        if (!('token' in data) || !data.token) {
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

    getOpenStoaToken: async () => {
      // If the user explicitly logged out, ignore any token still sitting
      // in AsyncStorage (paranoid defence — clearAuth() removes it, but a
      // crash between removeItem and setItem could leave the token alive).
      // The mini-app treats a null return as "no auth", forcing Welcome.
      const loggedOut = await AsyncStorage.getItem(LOGGED_OUT_KEY);
      if (loggedOut === '1') return null;
      return readToken();
    },

    loginToOpenStoa: async ({
      force,
      method,
    }: { force?: boolean; method?: 'oidc' | 'mdl' } = {}) => {
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

      // Explicit Sign-in (force=true). In __DEV__ skip the real OIDC ZK-proof
      // flow (Google sign-in + relay) and mint a local session via dev-login,
      // so in-app chat can be tested against the local backend on a
      // simulator/emulator. Production/staging builds always use the real flow.
      if (__DEV__) {
        return devLogin();
      }
      return runSelfRelayLogin(method ?? 'oidc');
    },

    logoutFromOpenStoa: async () => {
      await clearAuth();
      // Mark as explicitly logged out so the next OpenStoa tab entry
      // does not silently re-authenticate via the dev shortcut.
      await AsyncStorage.setItem(LOGGED_OUT_KEY, '1');
    },

    setOpenStoaToken: async (token: string) => {
      // Replace the cached Bearer with a freshly-reissued JWT (e.g. after
      // a nickname change). Clears the logged-out flag because possessing a
      // fresh token implies the user is logged in. Does NOT touch userId /
      // nickname / expiresAt caches — those are derived from API responses
      // by the mini-app and refreshed via /api/auth/session as usual.
      await AsyncStorage.setItem(TOKEN_KEY, token);
      await AsyncStorage.removeItem(LOGGED_OUT_KEY);
    },

    // Secure KV used by the mini-app to persist E2EE chat MLS state across
    // restarts. Keys are `mls.state.<identity>.<topicId>` (only chars in
    // [A-Za-z0-9._-], which expo-secure-store requires).
    secureStore: {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    },

    // Non-secure bulk KV (AsyncStorage) for the mini-app's decrypted chat
    // message cache — many rows, plaintext already on-device, so NOT Keychain.
    localStore: {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
    },

    // WebAuthn PRF (hmac-secret) for Phase 4 E2EE key recovery. Registers/asserts
    // a synced passkey and evaluates PRF with the mini-app's salt, returning a
    // deterministic 32-byte output the mini-app derives a master_key wrapping key
    // from. rpId MUST be the Associated-Domains entitlement domain
    // (`webcredentials:stg-community.zkproofport.app`, ProofportApp.entitlements)
    // that serves the AASA — it is independent of the OpenStoa API base URL.
    // Bypasses the react-native-passkeys 0.4.0 default-export bug (loses native
    // methods on Expo 54) by calling the Expo native module directly, matching
    // the Phase 0 PoC (src/poc/passkeyPrf.ts).
    passkeyPrf: async ({ mode, saltB64, credentialId }) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { requireNativeModule } = require('expo-modules-core');
      const passkeys = requireNativeModule('ReactNativePasskeys');
      const RP_ID = 'stg-community.zkproofport.app';

      const toB64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const saltB64url = toB64url(saltB64);
      const rand = (n: number): string => {
        const b = new Uint8Array(n);
        (globalThis as unknown as { crypto: { getRandomValues: (a: Uint8Array) => void } }).crypto.getRandomValues(b);
        let s = '';
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return toB64url(btoa(s));
      };
      // Normalize a PRF result (base64url string or ArrayBuffer) → standard base64
      // so the mini-app's kb.unb64() (atob) decodes it to the raw 32 bytes.
      const toStdB64 = (r: unknown): string | null => {
        if (r == null) return null;
        if (typeof r === 'string') {
          const b64 = r.replace(/-/g, '+').replace(/_/g, '/');
          return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        }
        try {
          const u = new Uint8Array(r as ArrayBuffer);
          let s = '';
          for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
          return btoa(s);
        } catch {
          return null;
        }
      };
      const readPrf = (res: { clientExtensionResults?: { prf?: { results?: { first?: unknown } } } }) =>
        toStdB64(res?.clientExtensionResults?.prf?.results?.first);

      if (mode === 'create') {
        const reg = await passkeys.create({
          rp: { id: RP_ID, name: 'OpenStoa' },
          user: { id: rand(16), name: 'openstoa-user', displayName: 'OpenStoa' },
          challenge: rand(32),
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          extensions: { prf: { eval: { first: saltB64url } } },
        });
        const credId: string | undefined = reg?.id;
        let prf = readPrf(reg);
        if (!prf && credId) {
          // Some authenticators don't return PRF on create → assert to obtain it.
          const g = await passkeys.get({
            rpId: RP_ID,
            challenge: rand(32),
            allowCredentials: [{ type: 'public-key', id: credId }],
            userVerification: 'required',
            extensions: { prf: { eval: { first: saltB64url } } },
          });
          prf = readPrf(g);
        }
        if (!credId || !prf) throw new Error('passkey create returned no credential/PRF');
        return { credentialId: credId, prfOutputB64: prf };
      }

      const g = await passkeys.get({
        rpId: RP_ID,
        challenge: rand(32),
        allowCredentials: credentialId ? [{ type: 'public-key', id: credentialId }] : undefined,
        userVerification: 'required',
        extensions: { prf: { eval: { first: saltB64url } } },
      });
      const prf = readPrf(g);
      if (!prf) throw new Error('passkey get returned no PRF (hmac-secret unsupported or cancelled)');
      return { credentialId: g?.id ?? credentialId ?? '', prfOutputB64: prf };
    },

    // Phase 6 push (design §13, D12-D14): register this device for content-free
    // chat notifications. Requests notification permission, obtains an Expo push
    // token (Expo fronts BOTH APNs + FCM), and returns it alongside a stable
    // client-generated opaque routing handle (persisted; NO rotation in Phase A).
    // Returns null — graceful skip — on a simulator, when permission is denied,
    // when no EAS projectId is configured, or on any error, so push registration
    // never disrupts chat. The server only ever sends a content-free "New
    // message" (Phase A) or the already-sealed opaque ciphertext (Phase B); no
    // plaintext leaves the device unencrypted (SI-1).
    //
    // The decision logic lives in ./pushRegistration so the host's plain-node
    // jest config can reach the failure paths, which are otherwise only
    // reachable on a physical device. Every exit there emits one greppable
    // `[openstoa-push] registerForPush outcome=...` line; this wrapper only
    // supplies the expo/react-native bindings.
    registerForPush: () =>
      registerForPushWithDeps({
        isDevice: Device.isDevice,
        getPermissions: () => Notifications.getPermissionsAsync(),
        requestPermissions: () => Notifications.requestPermissionsAsync(),
        provisionalIosStatus: Notifications.IosAuthorizationStatus.PROVISIONAL,
        projectId:
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
            ?.eas?.projectId ??
          (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId,
        getExpoPushToken: (projectId) => Notifications.getExpoPushTokenAsync({ projectId }),
        readHandle: () => AsyncStorage.getItem(PUSH_HANDLE_KEY),
        writeHandle: (handle) => AsyncStorage.setItem(PUSH_HANDLE_KEY, handle),
        newUuid: () => Crypto.randomUUID(),
        platform: Platform.OS === 'android' ? 'android' : 'ios',
      }),

    // Read the OS notification permission WITHOUT prompting, so the mini-app's
    // notification settings screen can say "blocked in system settings" up
    // front instead of only discovering it after the user flips the switch.
    // Deliberately never calls requestPermissionsAsync — registerForPush owns
    // the prompt; this is a pure read.
    getPushPermissionStatus: async () => {
      try {
        // No APNs/FCM token exists on a simulator, and without the EAS project
        // id no token can be minted — in both cases the OS answer is moot.
        if (!Device.isDevice) return 'unavailable';
        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
            ?.eas?.projectId ??
          (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
        if (!projectId) return 'unavailable';

        const perms = await Notifications.getPermissionsAsync();
        // iOS provisional delivers quietly but DOES deliver, so it counts as
        // granted — matching the isGranted() check in registerForPush.
        if (
          perms.granted ||
          perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
        ) {
          return 'granted';
        }
        return perms.status === 'undetermined' ? 'undetermined' : 'denied';
      } catch {
        return 'unavailable';
      }
    },

    // Phase 6 push (design §13, P-O gap 5): hand notification TAPS to the
    // mini-app so it can open the chat room the push came from. The OS listener
    // and the cold-start query live in ./pushTapBridge at module scope, because
    // they must outlive — and pre-date — this mini-app instance; all that
    // happens here is attaching the mini-app as the subscriber and replaying
    // whatever was latched while it was not mounted.
    onPushNotificationTap: (listener) => subscribeHostPushTap(listener),

    // Notifications that were DELIVERED but not tapped. The mini-app uses this
    // for `key-needed`: a device holding a scoped topic's keys can hand them to
    // whoever just joined without its owner doing anything, which is the point
    // of sending that notification at all. It never navigates.
    onPushNotificationReceived: (listener) => subscribeHostPushReceived(listener),

    // Remove the notifications a conversation already delivered, now that the
    // user is reading it. Nothing cleared these before: a chat push sat in
    // Notification Center until its own banner was tapped, so opening the app
    // — or the very room the push came from — left the tray full of messages
    // already read.
    //
    // Scoped to ONE conversation on purpose. Clearing the whole tray on
    // foreground would take room B's unread banner away because the user
    // opened room A, and that banner is their only record that B is waiting.
    // The decision logic and its edge cases live in ./pushClearing.
    clearTopicNotifications: async (topicId: string) => {
      await clearDeliveredForTopic(Notifications, topicId);
    },

    // Phase 7 push previews (design §13.6 strategy A): mirror one topic's Topic
    // Archive Key into storage this platform's BACKGROUND notification handler can
    // read, so it can decrypt the preview without touching the MLS ratchet.
    //
    // Android only. On iOS the mini-app already writes the key itself, straight
    // into the shared Keychain access group via expo-secure-store — the NSE is a
    // separate process and that group is the only thing both targets can see. On
    // Android the FCM service runs in this very package but reads a Keystore-
    // encrypted store of our own (`OpenStoaTakStore`), because parsing
    // expo-secure-store's private Android envelope format from Kotlin would break
    // on any upgrade of that package. `OpenStoaTak` is the write-only door into it.
    //
    // Resolves false rather than throwing on every failure: the preview is an
    // optimisation, and the recipient still gets the content-free "New message".
    mirrorTopicArchiveKey: async (topicId, takVersion, takB64) => {
      if (Platform.OS !== 'android') return false;
      try {
        const native = NativeModules.OpenStoaTak as
          | { mirrorTopicArchiveKey(t: string, v: number, k: string): Promise<boolean> }
          | undefined;
        // Host binary predating the module (an OTA-updated JS bundle on an older
        // native build) — nothing to write to.
        if (!native || typeof native.mirrorTopicArchiveKey !== 'function') return false;
        return (await native.mirrorTopicArchiveKey(topicId, takVersion, takB64)) === true;
      } catch {
        return false;
      }
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

    getDeveloperMode: () => getDeveloperMode(),

    onDeveloperModeChange: (listener: (enabled: boolean) => void) => subscribeDeveloperMode(listener),
  };
}

export const __INTERNAL_KEYS = {
  TOKEN_KEY,
  USER_ID_KEY,
  NICKNAME_KEY,
  EXPIRES_AT_KEY,
};
