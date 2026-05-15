import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { HostProvider, OpenStoaApp } from 'openstoa-mobile';
import { createZkProofportHostApi } from '../../openstoa-host/zkProofportHostApi';
import { useThemeColors } from '../../context';
import { getEnvironment } from '../../config';

// Mirror the host's 3-way environment split so the mini-app and the host
// always point at the same backend tier:
//   development → staging community (devs hit staging APIs)
//   staging     → staging community
//   production  → canonical openstoa.xyz
function resolveOpenStoaBaseUrl(): string {
  const env = getEnvironment();
  if (env === 'production') return 'https://www.openstoa.xyz';
  return 'https://stg-community.zkproofport.app';
}
const OPENSTOA_BASE_URL = resolveOpenStoaBaseUrl();

const OpenStoaRootScreen: React.FC = () => {
  const navigation = useNavigation();
  const rootRef = useNavigationContainerRef();
  const { mode, colors } = useThemeColors();

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
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, subscribeTheme],
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
