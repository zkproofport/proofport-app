import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, Text, StyleSheet, Image, Animated, ActivityIndicator} from 'react-native';

import {
  downloadCircuitFiles,
  type DownloadProgress,
} from '../utils/circuitDownload';
import {getEnvironment, initDeployments} from '../config';
import {useThemeColors} from '../context';

const CIRCUITS = ['coinbase_attestation', 'coinbase_country_attestation', 'oidc_domain_attestation'];
const SPLASH_DURATION = 3000;

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
    try {
      const env = getEnvironment();

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

      let completedCircuits = 0;

      for (const circuitName of CIRCUITS) {
        await downloadCircuitFiles(circuitName, env, handleProgress, (msg) => {
          console.log(msg);
        });

        completedCircuits++;
      }

      setLoading(false);
      setTimeout(() => onReady(), 500);
    } catch (error) {
      console.error('Circuit download error:', error);
      setLoading(false);
    }
  }, [handleProgress, onReady]);

  useEffect(() => {
    splashTimerRef.current = setTimeout(() => {
      setShowSplash(false);
      checkAndDownloadCircuits();
    }, SPLASH_DURATION);

    return () => {
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
      }
    };
  }, [checkAndDownloadCircuits]);

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
