import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Platform } from 'react-native';
import { useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { HostProvider, OpenStoaApp } from 'openstoa-mobile';
import { createZkProofportHostApi } from '../../openstoa-host/zkProofportHostApi';
import { useThemeColors } from '../../context';
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
  if (env === 'production') return 'https://www.openstoa.xyz';
  if (env === 'staging') return 'https://stg-community.zkproofport.app';
  // development → local docker community. Use 127.0.0.1 (not "localhost") on
  // iOS so the request goes over IPv4 — Docker's port publish binds IPv4 only,
  // and "localhost" resolves to IPv6 ::1 first (connection refused) on the sim.
  return Platform.OS === 'android' ? 'http://10.0.2.2:3200' : 'http://127.0.0.1:3200';
}
const OPENSTOA_BASE_URL = resolveOpenStoaBaseUrl();

const OpenStoaRootScreen: React.FC = () => {
  const navigation = useNavigation();
  const rootRef = useNavigationContainerRef();
  const { mode, colors } = useThemeColors();
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
          // Proxy to the host's ErrorContext when wired; fall back to console.
          // eslint-disable-next-line no-console
          console.warn('[openstoa]', code, details);
        },
        getTheme: () => modeRef.current,
        subscribeTheme,
        getDeveloperMode: () => developerModeRef.current,
        subscribeDeveloperMode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, subscribeTheme, subscribeDeveloperMode],
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
