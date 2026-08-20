import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Platform } from 'react-native';
import { useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { HostProvider, OpenStoaApp } from 'openstoa-mobile';
import { createZkProofportHostApi } from '../../openstoa-host/zkProofportHostApi';
import { useError, useThemeColors } from '../../context';
import { getEnvironment } from '../../config';
import { useSettings } from '../../hooks';

// Mirror the host's 3-way environment split so the mini-app and the host
// always point at the same backend tier:
//   development → LOCAL community (docker on the dev machine) so in-app chat
//                 exercises the code currently being developed. iOS simulator
//                 reaches the host via localhost; the Android emulator reaches
//                 it via the special 10.0.2.2 alias. (A physical device would
//                 need the host LAN IP instead.)
//   staging     → staging community
//   production  → canonical openstoa.xyz
function resolveOpenStoaBaseUrl(): string {
  const env = getEnvironment();
  // A Metro-connected debug build (__DEV__) ALWAYS targets the LOCAL community
  // backend so in-app chat / key-recovery exercises the code under development —
  // even on a physical device, where getEnvironment() reports 'production'. We
  // derive the dev machine's address from Metro's bundle URL: on a physical
  // device that host is the Mac's LAN IP (127.0.0.1 would be the phone itself);
  // the Android emulator uses the 10.0.2.2 alias; the iOS simulator is 127.0.0.1.
  if (__DEV__) {
    if (Platform.OS === 'android') return 'http://10.0.2.2:3200';
    // RN 0.81 New Architecture (bridgeless): NativeModules.SourceCode is
    // unreliable/undefined, so use getDevServer() (TurboModule-backed) to learn
    // the Metro host. On a physical device that is the Mac's LAN IP; 127.0.0.1
    // only works on the simulator.
    let host = '127.0.0.1';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer').default;
      const url: string | undefined = getDevServer?.()?.url;
      const m = url ? url.match(/^https?:\/\/([^:/]+)/) : null;
      if (m && m[1] && m[1] !== 'localhost') host = m[1];
    } catch {
      // fall back to 127.0.0.1 (simulator)
    }
    return `http://${host}:3200`;
  }
  if (env === 'production') return 'https://www.openstoa.xyz';
  if (env === 'staging') return 'https://stg-community.zkproofport.app';
  return Platform.OS === 'android' ? 'http://10.0.2.2:3200' : 'http://127.0.0.1:3200';
}
const OPENSTOA_BASE_URL = resolveOpenStoaBaseUrl();

/**
 * The one line of technical text the error modal shows, out of the mini-app's
 * free-form `details` record.
 *
 * `detail` is the key every mini-app call site uses today, and it holds the
 * thing worth reading — usually the server's own sentence. Anything else is
 * JSON-encoded rather than discarded: a detail nobody anticipated is still
 * better in front of the person than gone.
 */
function describeErrorDetails(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const {detail} = details;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const keys = Object.keys(details);
  if (keys.length === 0) return undefined;
  try {
    return JSON.stringify(details);
  } catch {
    // A cyclic or otherwise unserialisable payload must not replace the modal
    // with a crash — the modal is what the user is waiting for.
    return keys.join(', ');
  }
}

const OpenStoaRootScreen: React.FC = () => {
  const navigation = useNavigation();
  const rootRef = useNavigationContainerRef();
  const { mode, colors } = useThemeColors();
  // The host's real error modal. This screen sits inside <ErrorProvider> (see
  // App.tsx), so the mini-app's failures can reach the same modal every native
  // screen already uses, instead of the console.
  const { showError } = useError();
  const { settings } = useSettings();
  const developerMode = settings?.developerMode ?? false;

  // Keep a stable ref to the current mode so getTheme() is always synchronous.
  const modeRef = useRef<'light' | 'dark'>(mode);
  // Set of listeners subscribed via onThemeChange.
  const themeListenersRef = useRef<Set<(m: 'light' | 'dark') => void>>(new Set());

  // Notify subscribers whenever the host mode changes.
  useEffect(() => {
    modeRef.current = mode;
    themeListenersRef.current.forEach((cb) => cb(mode));
  }, [mode]);

  const subscribeTheme = useCallback((cb: (m: 'light' | 'dark') => void) => {
    themeListenersRef.current.add(cb);
    return () => {
      themeListenersRef.current.delete(cb);
    };
  }, []);

  // Same pattern for Developer Mode — mini-app uses it to gate experimental
  // affordances (e.g. mDL sign-in) so they only appear when the host user
  // has explicitly opted in.
  const developerModeRef = useRef<boolean>(developerMode);
  const developerModeListenersRef = useRef<Set<(enabled: boolean) => void>>(new Set());

  useEffect(() => {
    developerModeRef.current = developerMode;
    developerModeListenersRef.current.forEach((cb) => cb(developerMode));
  }, [developerMode]);

  const subscribeDeveloperMode = useCallback((cb: (enabled: boolean) => void) => {
    developerModeListenersRef.current.add(cb);
    return () => {
      developerModeListenersRef.current.delete(cb);
    };
  }, []);

  const hostApi = useMemo(
    () =>
      createZkProofportHostApi({
        baseUrl: OPENSTOA_BASE_URL,
        // exitToHost calls navigation.navigate; using navigation here is
        // sufficient because navigate() bubbles up through the parent
        // tab navigator.
        getNavigation: () => navigation as any,
        showError: (code, details) => {
          /*
           * This was a `console.warn` with a comment promising it would be
           * wired to the ErrorContext "when wired", and it never was. Every
           * failure the mini-app reported — a nickname it refused to save, a
           * photo that would not upload, an account that would not delete —
           * went to a log nobody on a device can read, so the app looked like
           * it was ignoring the button. It is the single reason a whole family
           * of errors was invisible in the product.
           *
           * `details` is the host contract's free-form record; the modal shows
           * one line of technical text, so anything the mini-app put under
           * `detail` is preferred and the rest is serialised rather than
           * dropped — a reason the server gave ("That name is reserved.") is
           * exactly what the person needs and must not be swallowed here.
           */
          showError(code, describeErrorDetails(details));
        },
        getTheme: () => modeRef.current,
        subscribeTheme,
        getDeveloperMode: () => developerModeRef.current,
        subscribeDeveloperMode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, subscribeTheme, subscribeDeveloperMode, showError],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background.primary }]}>
      <HostProvider api={hostApi}>
        <OpenStoaApp />
      </HostProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export default OpenStoaRootScreen;
