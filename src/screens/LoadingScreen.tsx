import React, {useEffect, useState, useCallback, useRef} from 'react';
import {View, Text, StyleSheet, Image, Animated} from 'react-native';

import {
  downloadCircuitFiles,
  type DownloadProgress,
} from '../utils/circuitDownload';
import {getEnvironment, initDeployments} from '../config';

const CIRCUITS = ['coinbase_attestation', 'coinbase_country_attestation'];
const SPLASH_DURATION = 3000;

interface LoadingScreenProps {
  onReady: () => void;
}

export function LoadingScreen({onReady}: LoadingScreenProps): React.ReactElement {
  const [showSplash, setShowSplash] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [currentFile, setCurrentFile] = useState('');
  const [progress, setProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
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

  const handleProgress = useCallback((prog: DownloadProgress) => {
    setCurrentFile(prog.fileName);
    setProgress(prog.percent);
  }, []);

  const checkAndDownloadCircuits = useCallback(async () => {
    try {
      const env = getEnvironment();

      setStatus('Syncing deployments...');
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
        setStatus(`Checking ${circuitName}...`);

        await downloadCircuitFiles(circuitName, env, handleProgress, (msg) => {
          console.log(msg);
        });

        completedCircuits++;
        setOverallProgress((completedCircuits / CIRCUITS.length) * 100);
      }

      setStatus('Ready!');
      setProgress(100);
      setOverallProgress(100);

      setTimeout(() => onReady(), 500);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${errorMsg}`);
      console.error('Circuit download error:', error);
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
      <View style={styles.splashContainer}>
        <Animated.View style={[styles.splashLogoContainer, {transform: [{scale: pulseAnim}]}]}>
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
    <View style={styles.container}>
      <Animated.View style={[styles.logoContainer, {transform: [{scale: pulseAnim}]}]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      <Text style={styles.appName}>ZKProofPort</Text>
      <Text style={styles.tagline}>Privacy-Preserving Identity Proofs</Text>

      <View style={styles.progressSection}>
        <Text style={styles.status}>{status}</Text>
        {currentFile ? <Text style={styles.currentFile}>{currentFile}</Text> : null}

        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, {width: `${overallProgress}%`}]} />
          </View>
          <Text style={styles.progressText}>{Math.round(overallProgress)}%</Text>
        </View>

        {progress > 0 && progress < 100 && currentFile && (
          <View style={styles.fileProgressContainer}>
            <View style={styles.fileProgressBarBackground}>
              <View style={[styles.fileProgressBarFill, {width: `${progress}%`}]} />
            </View>
            <Text style={styles.fileProgressText}>{progress}%</Text>
          </View>
        )}
      </View>

      <Text style={styles.footer}>Powered by mopro & Noir</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#1A2332',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogoContainer: {
    width: 140,
    height: 140,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  splashLogo: {
    width: 100,
    height: 100,
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    width: 120,
    height: 120,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
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
    color: '#25292E',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 48,
  },
  progressSection: {
    width: '100%',
    alignItems: 'center',
  },
  status: {
    fontSize: 16,
    color: '#25292E',
    marginBottom: 8,
  },
  currentFile: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 16,
    fontFamily: 'Menlo',
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  progressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0E76FD',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: '#6B7280',
    width: 40,
    textAlign: 'right',
  },
  fileProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '80%',
    marginTop: 12,
    gap: 8,
  },
  fileProgressBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fileProgressBarFill: {
    height: '100%',
    backgroundColor: '#30E000',
    borderRadius: 2,
  },
  fileProgressText: {
    fontSize: 11,
    color: '#9CA3AF',
    width: 32,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    fontSize: 12,
    color: '#9CA3AF',
  },
});
