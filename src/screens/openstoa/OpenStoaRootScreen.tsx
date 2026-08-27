import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Platform } from 'react-native';
import { useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { HostProvider, OpenStoaApp } from 'openstoa-mobile';
import { createZkProofportHostApi } from '../../openstoa-host/zkProofportHostApi';
import { resolveOpenStoaBaseUrl } from '../../openstoa-host/openStoaBaseUrl';
import { useError, useThemeColors } from '../../context';
import { getEnvironment } from '../../config';
import { useSettings } from '../../hooks';

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
