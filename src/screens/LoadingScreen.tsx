import {showGlobalError} from '../utils/errorBridge';
import {syncDeploymentsAtLaunch} from '../utils/launchDeploymentSync';
import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, Text, StyleSheet, Image, Animated, ActivityIndicator} from 'react-native';
import {useTranslation} from 'react-i18next';

import {initDeployments} from '../config';
import {useThemeColors} from '../context';
import {BRAND_SYMBOL, WORDMARK_ASPECT, wordmarkFor} from '../constants/brand';

/*
 * Launch downloads NO circuit files. Each proof downloads its own circuit's
 * files (the variant this phone's signer needs) when it starts, shows the
 * progress on the proving screen, and keeps them for the next proof
 * (circuitDownload.ts). Until 2026-10-29 every launch fetched every circuit
 * -- including a 134 MB Android .srs for a proof the person never asked for,
 * on whatever network the phone happened to be on.
 */
const SPLASH_DURATION = 3000;

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

  const syncAtLaunch = useCallback(async () => {
    // Sync deployments. A production build whose pinned circuits release is
    // missing is told so (E3007); anything else falls back to cached addresses.
    await syncDeploymentsAtLaunch({
      sync: initDeployments,
      showError: showGlobalError,
      log: (m) => console.log(m),
    });
    finishLoading();
  }, [finishLoading]);

  useEffect(() => {
    splashTimerRef.current = setTimeout(() => {
      setShowSplash(false);
      syncAtLaunch().catch((error) => {
        console.error('Launch sync error:', error);
        finishLoading();
      });
    }, SPLASH_DURATION);

    return () => {
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
      }
    };
  }, [syncAtLaunch, finishLoading]);

  if (showSplash) {
    return (
      <View style={[styles.splashContainer, {backgroundColor: themeColors.background.primary}]}>
        <Animated.View style={[styles.splashLogoContainer, {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
          transform: [{scale: pulseAnim}],
        }]}>
          <Image
            source={BRAND_SYMBOL}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </Animated.View>
        <Image
          testID="splash-wordmark"
          source={wordmarkFor(mode)}
          style={styles.splashWordmark}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="ZKProofport"
        />
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
          source={BRAND_SYMBOL}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      <Image
        testID="loading-wordmark"
        source={wordmarkFor(mode)}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="ZKProofport"
      />
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
  // The brand kit's minimum for the wordmark alone is 160 wide.
  splashWordmark: {
    width: 200,
    height: 200 / WORDMARK_ASPECT,
    marginTop: 28,
  },
  wordmark: {
    width: 220,
    height: 220 / WORDMARK_ASPECT,
    marginBottom: 8,
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
