import {bootstrapCircuits} from '../utils/circuitBootstrap';
import {showGlobalError} from '../utils/errorBridge';
import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, Text, StyleSheet, Image, Animated, ActivityIndicator} from 'react-native';
import {useTranslation} from 'react-i18next';

import {
  downloadCircuitFiles,
  type DownloadProgress,
} from '../utils/circuitDownload';
import {getEnvironment, initDeployments} from '../config';
import {PLANNED_CIRCUIT_IDS, SUPPORTED_CIRCUIT_IDS} from '../config/circuitIds';
import {useThemeColors} from '../context';
import {settingsStore} from '../stores';

/*
 * What the app warms up at launch, split exactly the way the SDK splits it:
 * `supported` circuits for everyone, `planned` ones only under Developer Mode.
 *
 * Both lists used to be written out here, and the second one held only
 * `giwa_attestation` — so the three `mdl_kr_*` circuits were prefetched by
 * nobody. That was NOT deliberate; nothing recorded a reason, and they meet
 * the same description GIWA does: reachable only from a developer-only network
 * in the Verify tab, and served off `circuits@main` (checked 2026-09-04: each
 * circuit json under `mdl/kr-<variant>/target` answers 200 there, and
 * `circuitDownload.ts` pins every `planned` circuit to `main` regardless of
 * environment, so the release-tag 404 warned about below cannot reach them).
 * The effect was a first mDL proof that stalled on a cold download instead of
 * starting.
 *
 * The original warning still holds and is why the split exists at all: a
 * circuit absent from the production release tag 404s when prefetched, and
 * `bootstrapCircuits` turns that into a "Download Failed" modal on a launch
 * nobody asked anything of. Developer Mode works in release builds too, so
 * this is not the same condition as `__DEV__`.
 */
const BASE_CIRCUITS: ReadonlyArray<string> = SUPPORTED_CIRCUIT_IDS;
const DEV_ONLY_CIRCUITS: ReadonlyArray<string> = PLANNED_CIRCUIT_IDS;
const SPLASH_DURATION = 3000;
const MAX_LOADING_DURATION = 5000;

interface LoadingScreenProps {
  onReady: () => void;
}

export function LoadingScreen({onReady}: LoadingScreenProps): React.ReactElement {
  const {t} = useTranslation();
  const {mode, colors: themeColors} = useThemeColors();
  const isDark = mode === 'dark';
  const [showSplash, setShowSplash] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pulseAnim] = useState(new Animated.Value(1));
  const splashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const readyCalledRef = useRef(false);

  const finishLoading = useCallback(() => {
    if (readyCalledRef.current) return;
    readyCalledRef.current = true;
    setLoading(false);
    setTimeout(() => onReady(), 300);
  }, [onReady]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulseAnim]);

  const handleProgress = useCallback((_prog: DownloadProgress) => {
    // progress tracked internally for download logic
  }, []);

  const checkAndDownloadCircuits = useCallback(async () => {
    const env = getEnvironment();

    // Sync deployments (non-blocking for loading)
    try {
      const updated = await initDeployments();
      console.log(
        updated
          ? 'Deployment sync: addresses updated'
          : 'Deployment sync: using cached addresses',
      );
    } catch (deployError) {
      console.warn('Deployment sync failed, using fallback addresses:', deployError);
    }

    // GIWA only downloads when in-app Developer Mode is enabled, since it is
    // absent from the production release tag and would otherwise 404.
    const {developerMode} = await settingsStore.get();
    const circuits = developerMode
      ? [...BASE_CIRCUITS, ...DEV_ONLY_CIRCUITS]
      : BASE_CIRCUITS;

    // Start all circuit downloads in parallel
    const downloadPromise = Promise.allSettled(
      circuits.map((circuitName) =>
        downloadCircuitFiles(circuitName, env, handleProgress, (msg) => {
          console.log(msg);
        }),
      ),
    );

    await bootstrapCircuits({
      downloads: downloadPromise,
      maxLoadingMs: MAX_LOADING_DURATION,
      wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      finishLoading,
      /*
       * The modal, not `Alert.alert` — every user-facing error in this app goes
       * through one place. It is raised through the bridge because
       * `ErrorProvider` wraps the MAIN tree and this screen returns before it;
       * the bridge holds the error until the modal exists.
       */
      onFailed: (reasons) => showGlobalError('E3005', reasons.join('; ')),
      log: (m) => console.log(m),
    });
  }, [handleProgress, finishLoading]);

  useEffect(() => {
    splashTimerRef.current = setTimeout(() => {
      setShowSplash(false);
      checkAndDownloadCircuits().catch((error) => {
        console.error('Circuit initialization error:', error);
        finishLoading();
      });
    }, SPLASH_DURATION);

    return () => {
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
      }
    };
  }, [checkAndDownloadCircuits, finishLoading]);

  if (showSplash) {
    return (
      <View style={[styles.splashContainer, {backgroundColor: themeColors.background.primary}]}>
        <Animated.View style={[styles.splashLogoContainer, {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
          transform: [{scale: pulseAnim}],
        }]}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
      <Animated.View style={[styles.logoContainer, {
        backgroundColor: themeColors.background.secondary,
        transform: [{scale: pulseAnim}],
      }]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      <Text style={[styles.appName, {color: themeColors.text.primary}]}>ZKProofport</Text>
      <Text style={[styles.tagline, {color: themeColors.text.secondary}]}>{t('host.loading.tagline')}</Text>

      {loading && (
        <ActivityIndicator size="large" color={isDark ? '#FFFFFF' : '#999999'} style={styles.spinner} />
      )}

      <Text style={[styles.footer, {color: themeColors.text.tertiary}]}>Powered by Masse Labs</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogoContainer: {
    width: 140,
    height: 140,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  splashLogo: {
    width: 100,
    height: 100,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    width: 120,
    height: 120,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 20,
  },
  appName: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    marginBottom: 48,
  },
  spinner: {
    marginTop: 32,
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    fontSize: 12,
  },
});
