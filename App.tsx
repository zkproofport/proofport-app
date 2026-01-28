// AppKit config must be imported first
import './src/config/AppKitConfig';

import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Linking} from 'react-native';
import {
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppKitProvider, AppKit} from '@reown/appkit-react-native';
import {PrivyProvider} from '@privy-io/expo';
import type {Storage} from '@privy-io/js-sdk-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {appKit, PRIVY_APP_ID, PRIVY_CLIENT_ID} from './src/config';

// Custom storage adapter using AsyncStorage instead of SecureStore
// This avoids keychain access issues on simulator without code signing
const PRIVY_STORAGE_PREFIX = '@privy:';

const privyStorage: Storage = {
  get: async (key: string) => {
    try {
      const value = await AsyncStorage.getItem(PRIVY_STORAGE_PREFIX + key);
      if (value === null) return undefined;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.warn('[Privy Storage] get error:', error);
      return undefined;
    }
  },
  put: async (key: string, value: unknown) => {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await AsyncStorage.setItem(PRIVY_STORAGE_PREFIX + key, serialized);
    } catch (error) {
      console.warn('[Privy Storage] put error:', error);
    }
  },
  del: async (key: string) => {
    try {
      await AsyncStorage.removeItem(PRIVY_STORAGE_PREFIX + key);
    } catch (error) {
      console.warn('[Privy Storage] del error:', error);
    }
  },
  getKeys: async () => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      return allKeys
        .filter(k => k.startsWith(PRIVY_STORAGE_PREFIX))
        .map(k => k.slice(PRIVY_STORAGE_PREFIX.length));
    } catch (error) {
      console.warn('[Privy Storage] getKeys error:', error);
      return [];
    }
  },
};
import {
  MainScreen,
  AgeVerifierScreen,
  CoinbaseKycScreen,
  PrivyWalletScreen,
  LoadingScreen,
} from './src/screens';
import {ProofRequestModal} from './src/components';
import {DeepLinkProvider} from './src/context';
import {
  parseProofRequestUrl,
  validateProofRequest,
  sendProofResponse,
  isProofPortDeepLink,
} from './src/utils/deeplink';
import type {RootStackParamList, ProofRequest} from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRequest, setPendingRequest] = useState<ProofRequest | null>(
    null,
  );
  const [showRequestModal, setShowRequestModal] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  // Track currently active request to prevent processing while modal is open
  const activeRequestId = useRef<string | null>(null);

  const handleDeepLink = useCallback((url: string | null) => {
    if (!url) {
      console.log('[App] handleDeepLink called with null URL');
      return;
    }

    console.log('[App] Received deep link:', url.substring(0, 100) + '...');
    console.log('[App] Current active requestId:', activeRequestId.current);

    if (!isProofPortDeepLink(url)) {
      console.log('[App] Not a ProofPort deep link');
      return;
    }

    const request = parseProofRequestUrl(url);
    if (!request) {
      console.error('[App] Failed to parse proof request');
      return;
    }

    console.log('[App] Parsed requestId:', request.requestId);

    // Only skip if we're currently processing this exact request
    if (activeRequestId.current === request.requestId) {
      console.log('[App] Same request is currently being processed, skipping');
      return;
    }

    const validation = validateProofRequest(request);
    if (!validation.valid) {
      console.error('[App] Invalid request:', validation.error);
      sendProofResponse(
        {
          requestId: request.requestId,
          circuit: request.circuit,
          status: 'error',
          error: validation.error,
        },
        request.callbackUrl,
      );
      return;
    }

    // Mark this as the active request
    activeRequestId.current = request.requestId;

    console.log('[App] Valid proof request, showing modal:', request.requestId);
    setPendingRequest(request);
    setShowRequestModal(true);
  }, []);

  // Listen for deep links
  useEffect(() => {
    // Handle initial URL
    const getInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        console.log('[App] Initial URL:', url.substring(0, 50) + '...');
        // Delay to ensure navigation is ready
        setTimeout(() => handleDeepLink(url), 500);
      }
    };

    getInitialURL();

    // Listen for incoming links
    const subscription = Linking.addEventListener('url', event => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  const handleAcceptRequest = useCallback(() => {
    if (!pendingRequest) return;

    console.log('[App] Accepting request:', pendingRequest.requestId);
    setShowRequestModal(false);

    // Reset navigation stack and navigate to appropriate screen
    // This ensures fresh state even when coming from the same screen
    if (pendingRequest.circuit === 'age_verifier') {
      navigationRef.current?.reset({
        index: 1,
        routes: [
          {name: 'Main'},
          {name: 'AgeVerifier', params: {proofRequest: pendingRequest}},
        ],
      });
    } else if (pendingRequest.circuit === 'coinbase_attestation') {
      navigationRef.current?.reset({
        index: 1,
        routes: [
          {name: 'Main'},
          {name: 'CoinbaseKyc', params: {proofRequest: pendingRequest}},
        ],
      });
    }

    // Clear active request after navigation so new requests can come in
    // Note: The request data is passed via navigation params
    activeRequestId.current = null;
    setPendingRequest(null);
  }, [pendingRequest]);

  const handleRejectRequest = useCallback(async () => {
    if (!pendingRequest) return;

    console.log('[App] Rejecting request:', pendingRequest.requestId);
    setShowRequestModal(false);

    await sendProofResponse(
      {
        requestId: pendingRequest.requestId,
        circuit: pendingRequest.circuit,
        status: 'cancelled',
        error: 'User rejected the request',
      },
      pendingRequest.callbackUrl,
    );

    // Clear active request so new requests can be processed
    activeRequestId.current = null;
    setPendingRequest(null);
  }, [pendingRequest]);

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <LoadingScreen onReady={() => setIsLoading(false)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <DeepLinkProvider>
        <PrivyProvider
          appId={PRIVY_APP_ID}
          clientId={PRIVY_CLIENT_ID}
          storage={privyStorage}
        >
          <AppKitProvider instance={appKit}>
            <NavigationContainer ref={navigationRef}>
              <Stack.Navigator
                initialRouteName="Main"
                screenOptions={{
                  headerStyle: {
                    backgroundColor: '#F5F5F5',
                  },
                  headerTintColor: '#333',
                  headerTitleStyle: {
                    fontWeight: '600',
                  },
                }}>
                <Stack.Screen
                  name="Main"
                  component={MainScreen}
                  options={{headerShown: false}}
                />
                <Stack.Screen
                  name="AgeVerifier"
                  component={AgeVerifierScreen}
                  options={{title: 'Age Verifier'}}
                />
                <Stack.Screen
                  name="CoinbaseKyc"
                  component={CoinbaseKycScreen}
                  options={{title: 'Coinbase KYC'}}
                />
                <Stack.Screen
                  name="PrivyWallet"
                  component={PrivyWalletScreen}
                  options={{title: 'Wallet'}}
                />
              </Stack.Navigator>
            </NavigationContainer>
            <AppKit />
            <ProofRequestModal
              visible={showRequestModal}
              request={pendingRequest}
              onAccept={handleAcceptRequest}
              onReject={handleRejectRequest}
            />
          </AppKitProvider>
        </PrivyProvider>
      </DeepLinkProvider>
    </SafeAreaProvider>
  );
};

export default App;
