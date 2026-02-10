import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {triggerDeepLink} from '../../utils/deepLinkBridge';
import {useThemeColors} from '../../context';

const QRScanScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
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
          // Pass URL directly to App.tsx's handleDeepLink via bridge (no URL mangling)
          // This shows the confirmation modal, same flow as mobile deep link
          if (navigation.canGoBack()) {
            navigation.goBack();
          }
          setTimeout(() => {
            triggerDeepLink(value);
          }, 300);
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
      <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={[styles.permissionTitle, {color: themeColors.text.primary}]}>Camera Access Required</Text>
          <Text style={[styles.permissionText, {color: themeColors.text.secondary}]}>
            Allow camera access to scan QR codes for proof requests
          </Text>
          <TouchableOpacity
            style={[styles.permissionButton, {backgroundColor: themeColors.info[500]}]}
            onPress={handleRequestPermission}
            activeOpacity={0.8}>
            <Text style={[styles.permissionButtonText, {color: themeColors.text.primary}]}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={[styles.container, {backgroundColor: themeColors.background.primary}]}>
        <View style={styles.permissionContainer}>
          <Text style={[styles.permissionTitle, {color: themeColors.text.primary}]}>No Camera Available</Text>
          <Text style={[styles.permissionText, {color: themeColors.text.secondary}]}>
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
        {...(Platform.OS === 'android' && {photo: true})}
      />
      <SafeAreaView style={styles.overlay}>
        <Text style={[styles.overlayTitle, {color: themeColors.text.primary}]}>Scan QR Code</Text>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTL, {borderColor: themeColors.info[500]}]} />
          <View style={[styles.corner, styles.cornerTR, {borderColor: themeColors.info[500]}]} />
          <View style={[styles.corner, styles.cornerBL, {borderColor: themeColors.info[500]}]} />
          <View style={[styles.corner, styles.cornerBR, {borderColor: themeColors.info[500]}]} />
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
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
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
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  permissionButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default QRScanScreen;
