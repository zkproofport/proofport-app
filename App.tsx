// AppKit config must be imported first
import './src/config/AppKitConfig';

import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Linking} from 'react-native';
import {
  NavigationContainer,
  NavigationContainerRef,
  CommonActions,
  StackActions,
} from '@react-navigation/native';
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
import {LoadingScreen} from './src/screens';
import {TabNavigator} from './src/navigation';
import type {TabParamList} from './src/navigation/types';
import {ProofRequestModal, ErrorModal} from './src/components';
import {DeepLinkProvider, ErrorProvider, ThemeProvider} from './src/context';
import {showGlobalError} from './src/utils/errorBridge';
import {
  parseProofRequestUrl,
  validateProofRequest,
  validateRequestWithRelay,
  sendProofResponse,
  isProofportDeepLink,
} from './src/utils/deeplink';
import type {ProofRequest} from './src/types';
import {setActiveProofRequest, clearActiveProofRequest} from './src/stores/activeProofRequestStore';
import {registerDeepLinkHandler} from './src/utils/deepLinkBridge';
import {useAppStateReset} from './src/hooks';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRequest, setPendingRequest] = useState<ProofRequest | null>(
    null,
  );
  const [showRequestModal, setShowRequestModal] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<TabParamList>>(null);
  // Track currently active request to prevent processing while modal is open
  const activeRequestId = useRef<string | null>(null);

  // Reset handler for when app returns from background after timeout
  const handleAppReset = useCallback(() => {
    console.log('[App] Resetting app state due to background timeout...');

    // Clear any pending proof request
    setPendingRequest(null);
    setShowRequestModal(false);
    activeRequestId.current = null;
    clearActiveProofRequest();
  }, []);

  // Auto-reset when app returns from background after 10 minutes
  useAppStateReset({onReset: handleAppReset});

  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) {
      console.log('[App] handleDeepLink called with null URL');
      return;
    }

    console.log('[App] Received deep link:', url);
    console.log('[App] Current active requestId:', activeRequestId.current);

    if (!isProofportDeepLink(url)) {
      console.log('[App] Not a Proofport deep link');
      return;
    }

    const request = parseProofRequestUrl(url);
    if (!request) {
      showGlobalError('E1001', 'Failed to parse deep link URL');
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
      showGlobalError('E1002', validation.error);
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

    // Validate requestId with relay server — reject unregistered requests
    const relayValidation = await validateRequestWithRelay(request.requestId, request.callbackUrl);
    if (!relayValidation.valid) {
      showGlobalError('E1006', relayValidation.error);
      sendProofResponse(
        {
          requestId: request.requestId,
          circuit: request.circuit,
          status: 'error',
          error: 'Unregistered proof request: ' + (relayValidation.error || 'requestId not found in relay'),
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
    // Register bridge so QRScanScreen can trigger handleDeepLink directly
    registerDeepLinkHandler(handleDeepLink);

    // Handle initial URL
    const getInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        console.log('[App] Initial URL:', url);
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
    console.log('[App] Request callbackUrl:', pendingRequest.callbackUrl);
    setShowRequestModal(false);

    // Set active request in store before navigation
    setActiveProofRequest(pendingRequest);

    // Navigate to proof generation with stack reset to avoid stacking on ProofComplete
    const circuitId = pendingRequest.circuit === 'coinbase_attestation'
      ? 'coinbase-kyc'
      : pendingRequest.circuit === 'coinbase_country_attestation'
        ? 'coinbase-country'
        : pendingRequest.circuit;

    // First navigate to ProofTab and pop stack to root
    navigationRef.current?.dispatch(
      CommonActions.navigate({name: 'ProofTab'}),
    );
    navigationRef.current?.dispatch(StackActions.popToTop());
    // Then push ProofGeneration fresh
    navigationRef.current?.dispatch(
      StackActions.push('ProofGeneration', {
        circuitId,
        proofRequest: pendingRequest,
      }),
    );

    // Clear active request after navigation
    activeRequestId.current = null;
    setPendingRequest(null);
    // Note: activeProofRequest is cleared by ProofGenerationScreen after proof is sent
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
        <ThemeProvider>
          <LoadingScreen onReady={() => setIsLoading(false)} />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorProvider>
          <DeepLinkProvider>
            <PrivyProvider
              appId={PRIVY_APP_ID}
              clientId={PRIVY_CLIENT_ID}
              storage={privyStorage}
            >
              <AppKitProvider instance={appKit}>
                <NavigationContainer ref={navigationRef}>
                  <TabNavigator />
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
          <ErrorModal />
        </ErrorProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;
