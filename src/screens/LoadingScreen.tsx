import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Dimensions,
} from 'react-native';
import {
  downloadCircuitFiles,
  allCircuitFilesExist,
  type DownloadProgress,
} from '../utils/circuitDownload';

const {width} = Dimensions.get('window');

// Circuit names to download
const CIRCUITS = ['age_verifier', 'coinbase_attestation'];

interface LoadingScreenProps {
  onReady: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({onReady}) => {
  const [status, setStatus] = useState('Initializing...');
  const [currentFile, setCurrentFile] = useState('');
  const [progress, setProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [pulseAnim] = useState(new Animated.Value(1));

  // Fade in animation
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Pulse animation for logo
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
  }, [fadeAnim, pulseAnim]);

  const handleProgress = useCallback((prog: DownloadProgress) => {
    setCurrentFile(prog.fileName);
    setProgress(prog.percent);
  }, []);

  const checkAndDownloadCircuits = useCallback(async () => {
    try {
      let completedCircuits = 0;

      for (const circuitName of CIRCUITS) {
        setStatus(`Checking ${circuitName}...`);

        const exists = await allCircuitFilesExist(circuitName);

        if (exists) {
          setStatus(`${circuitName} ready`);
          completedCircuits++;
          setOverallProgress((completedCircuits / CIRCUITS.length) * 100);
        } else {
          setStatus(`Downloading ${circuitName}...`);

          await downloadCircuitFiles(circuitName, handleProgress, (msg) => {
            console.log(msg);
          });

          completedCircuits++;
          setOverallProgress((completedCircuits / CIRCUITS.length) * 100);
        }
      }

      setStatus('Ready!');
      setProgress(100);
      setOverallProgress(100);

      // Small delay before transitioning
      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          onReady();
        });
      }, 500);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${errorMsg}`);
      console.error('Circuit download error:', error);
    }
  }, [handleProgress, fadeAnim, onReady]);

  useEffect(() => {
    checkAndDownloadCircuits();
  }, [checkAndDownloadCircuits]);

  return (
    <Animated.View style={[styles.container, {opacity: fadeAnim}]}>
      {/* Logo */}
      <Animated.View style={[styles.logoContainer, {transform: [{scale: pulseAnim}]}]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* App Name */}
      <Text style={styles.appName}>zkProofport</Text>
      <Text style={styles.tagline}>Privacy-Preserving Identity Proofs</Text>

      {/* Progress Section */}
      <View style={styles.progressSection}>
        <Text style={styles.status}>{status}</Text>

        {currentFile ? (
          <Text style={styles.currentFile}>{currentFile}</Text>
        ) : null}

        {/* Overall Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View
              style={[
                styles.progressBarFill,
                {width: `${overallProgress}%`},
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {Math.round(overallProgress)}%
          </Text>
        </View>

        {/* Current File Progress (when downloading) */}
        {progress > 0 && progress < 100 && currentFile && (
          <View style={styles.fileProgressContainer}>
            <View style={styles.fileProgressBarBackground}>
              <View
                style={[
                  styles.fileProgressBarFill,
                  {width: `${progress}%`},
                ]}
              />
            </View>
            <Text style={styles.fileProgressText}>{progress}%</Text>
          </View>
        )}
      </View>

      {/* Footer */}
      <Text style={styles.footer}>Powered by mopro & Noir</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
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
