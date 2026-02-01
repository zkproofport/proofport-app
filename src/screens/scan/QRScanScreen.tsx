import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import {useNavigation, useFocusEffect, CommonActions} from '@react-navigation/native';
import {parseProofRequestUrl} from '../../utils/deeplink';

const QRScanScreen: React.FC = () => {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('back');
  const [isActive, setIsActive] = useState(true);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      setIsActive(true);
      setScannedData(null);
      return () => {
        setIsActive(false);
      };
    }, []),
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (codes.length > 0 && codes[0].value && !scannedData) {
        const value = codes[0].value;
        setScannedData(value);
        setIsActive(false);

        if (value.startsWith('zkproofport://')) {
          const request = parseProofRequestUrl(value);
          if (request) {
            navigation.dispatch(
              CommonActions.navigate({
                name: 'ProofTab',
                params: {
                  screen: 'ProofGeneration',
                  params: {
                    circuitId: request.circuit === 'coinbase_attestation' ? 'coinbase-kyc'
                      : request.circuit === 'coinbase_country_attestation' ? 'coinbase-country'
                      : request.circuit,
                    proofRequest: request,
                  },
                },
              })
            );
          } else {
            Alert.alert(
              'Invalid QR Code',
              'Failed to parse proof request URL',
              [
                {
                  text: 'OK',
                  onPress: resetScanner,
                },
              ],
            );
          }
        } else if (value.startsWith('http://') || value.startsWith('https://')) {
          Alert.alert(
            'Link Scanned',
            value,
            [
              {
                text: 'Open in Browser',
                onPress: () => {
                  Linking.openURL(value);
                  resetScanner();
                },
              },
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: resetScanner,
              },
            ],
          );
        } else {
          Alert.alert(
            'QR Code Scanned',
            value,
            [
              {
                text: 'OK',
                onPress: resetScanner,
              },
            ],
          );
        }
      }
    },
  });

  const resetScanner = () => {
    setScannedData(null);
    setIsActive(true);
  };

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (!granted) {
      Alert.alert(
        'Camera Permission Required',
        'Please enable camera access in Settings to scan QR codes.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Open Settings', onPress: () => Linking.openSettings()},
        ],
      );
    }
  };

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            Allow camera access to scan QR codes for proof requests
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={handleRequestPermission}
            activeOpacity={0.8}>
            <Text style={styles.permissionButtonText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>No Camera Available</Text>
          <Text style={styles.permissionText}>
            This device does not have a camera
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        codeScanner={codeScanner}
      />
      <SafeAreaView style={styles.overlay}>
        <Text style={styles.overlayTitle}>Scan QR Code</Text>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Text style={styles.overlayHint}>
          Point your camera at a QR code{'\n'}to scan a proof request
        </Text>
      </SafeAreaView>
    </View>
  );
};

const FRAME_SIZE = 250;
const CORNER_SIZE = 30;
const CORNER_WIDTH = 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1419',
  },
  cameraContainer: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  overlayTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 32,
  },
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#3B82F6',
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#3B82F6',
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#3B82F6',
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#3B82F6',
    borderBottomRightRadius: 8,
  },
  overlayHint: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 20,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default QRScanScreen;
