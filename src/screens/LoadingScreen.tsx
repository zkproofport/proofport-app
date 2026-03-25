import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, Text, StyleSheet, Image, Animated, ActivityIndicator, Alert} from 'react-native';

import {
  downloadCircuitFiles,
  type DownloadProgress,
} from '../utils/circuitDownload';
import {getEnvironment, initDeployments} from '../config';
import {useThemeColors} from '../context';

const CIRCUITS = ['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation'];
const SPLASH_DURATION = 3000;
const MAX_LOADING_DURATION = 5000;

interface LoadingScreenProps {
  onReady: () => void;
}

export function LoadingScreen({onReady}: LoadingScreenProps): React.ReactElement {
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

    // Start all circuit downloads in parallel
    const downloadPromise = Promise.allSettled(
      CIRCUITS.map((circuitName) =>
        downloadCircuitFiles(circuitName, env, handleProgress, (msg) => {
          console.log(msg);
        }),
      ),
    );

    // Race: all downloads complete OR max loading timeout
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), MAX_LOADING_DURATION),
    );

    const result = await Promise.race([
      downloadPromise.then(() => 'done' as const),
      timeoutPromise,
    ]);

    if (result === 'timeout') {
      console.log('Loading timeout reached, entering app. Downloads continue in background.');
      finishLoading();

      // Continue downloads in background, handle errors
      downloadPromise.then((results) => {
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          const reasons = failed.map((r) => (r as PromiseRejectedResult).reason?.message || 'Unknown error');
          console.error('Background circuit download failed:', reasons);
          Alert.alert(
            'Download Failed',
            'Some circuit files could not be downloaded. Please check your network connection and restart the app to retry.',
            [{text: 'OK'}],
          );
        } else {
          console.log('Background circuit downloads completed successfully.');
        }
      });
    } else {
      finishLoading();
    }
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
      <Text style={[styles.tagline, {color: themeColors.text.secondary}]}>Privacy-Preserving Identity Proofs</Text>

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
