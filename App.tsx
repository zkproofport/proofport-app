// AppKit config must be imported first
import './src/config/AppKitConfig';

import 'react-native-gesture-handler';
import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Linking} from 'react-native';
// Phase 6 push (design §13): a tapped chat notification deep-links into the
// OpenStoa chat room for `data.topicId`. The payload is content-free / near-blind
// (only the topic id) so nothing here handles message content (SI-1).
import * as Notifications from 'expo-notifications';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {
  NavigationContainer,
  NavigationContainerRef,
  CommonActions,
} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppKitProvider, AppKit} from '@reown/appkit-react-native';
import {appKit} from './src/config';
import {LoadingScreen} from './src/screens';
import {TabNavigator} from './src/navigation';
import type {TabParamList} from './src/navigation/types';
import {ProofRequestModal, ErrorModal, ReturnNoticeModal} from './src/components';
import {DeepLinkProvider, ErrorProvider, ThemeProvider} from './src/context';
import {showGlobalError} from './src/utils/errorBridge';
import {
  parseProofRequestUrl,
  validateProofRequest,
  validateRequestWithRelay,
  sendProofResponse,
  returnToRequester,
  requesterIsAnotherApp,
  isProofportDeepLink,
  type ProofRequestOrigin,
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

  const handleDeepLink = useCallback(async (
    url: string | null,
    origin: ProofRequestOrigin,
  ) => {
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

    const request = parseProofRequestUrl(url, origin);
    if (!request) {
      showGlobalError('E1001', 'Failed to parse deep link URL');
      return;
    }

    console.log('[App] Parsed requestId:', request.requestId, 'origin:', origin);

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
    const relayValidation = await validateRequestWithRelay(request.requestId, request.callbackUrl, request.inputs as Record<string, unknown>);
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

    // mDL: skip the generic confirmation modal. The mobile-ID-type bottom
    // sheet inside ProofGenerationScreen is the confirmation + entry point;
    // the modal's wallet / Coinbase-shaped UI does not apply to the on-device
    // mDL flow. Navigate straight to proof generation.
    if (request.circuit.startsWith('mdl_kr_')) {
      console.log('[App] mDL request — navigating directly:', request.requestId);
      setActiveProofRequest(request);
      navigationRef.current?.dispatch(
        CommonActions.navigate({
          name: 'ProofTab',
          params: {
            screen: 'ProofGeneration',
            params: {circuitId: request.circuit, proofRequest: request},
          },
        }),
      );
      setPendingRequest(null);
      return;
    }

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
        setTimeout(() => handleDeepLink(url, 'link'), 500);
      }
    };

    getInitialURL();

    // Listen for incoming links
    const subscription = Linking.addEventListener('url', event => {
      handleDeepLink(event.url, 'link');
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  // Deep-link a tapped push into the OpenStoa chat room. The nested payload
  // mirrors the ProofTab example above: the mini-app's ChatRoom lives at
  // OpenStoaTab → OpenStoaRoot → ChatTab → ChatRoom, so a flat navigate to the
  // root tab navigator would not reach it.
  const openOpenStoaChat = useCallback((topicId: string) => {
    if (!topicId) return;
    navigationRef.current?.dispatch(
      CommonActions.navigate({
        name: 'OpenStoaTab',
        params: {
          screen: 'OpenStoaRoot',
          params: {
            screen: 'ChatTab',
            params: {
              screen: 'ChatRoom',
              params: {topicId},
            },
          },
        },
      }),
    );
  }, []);

  // Notification-tap handler (Phase 6). The push carries only { topicId } — no
  // message content — so this handler is a pure router. For Phase B (ciphertext)
  // the iOS NSE / Android FCM handler decrypts the preview natively; this JS
  // handler still only routes on tap.
  useEffect(() => {
    const extractTopicId = (
      resp: Notifications.NotificationResponse | null,
    ): string | null => {
      const data = resp?.notification?.request?.content?.data as
        | {topicId?: unknown}
        | undefined;
      return typeof data?.topicId === 'string' && data.topicId
        ? data.topicId
        : null;
    };

    // Cold start: the app was launched by tapping a push.
    Notifications.getLastNotificationResponseAsync()
      .then(resp => {
        const topicId = extractTopicId(resp);
        // Delay so the navigation container is mounted before we dispatch.
        if (topicId) setTimeout(() => openOpenStoaChat(topicId), 500);
      })
      .catch(() => {});

    // Warm: tapped while the app is running/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      const topicId = extractTopicId(resp);
      if (topicId) openOpenStoaChat(topicId);
    });
    return () => sub.remove();
  }, [openOpenStoaChat]);

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

    // Use nested-navigation form so the inner ProofStack receives the screen.
    // `StackActions.push('ProofGeneration', ...)` against the root tab navigator
    // silently no-ops because the screen lives inside ProofStack, not the
    // root TabNavigator — that left the user stranded on Verify home after
    // accepting the proof request modal.
    navigationRef.current?.dispatch(
      CommonActions.navigate({
        name: 'ProofTab',
        params: {
          screen: 'ProofGeneration',
          params: {
            circuitId,
            proofRequest: pendingRequest,
          },
        },
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

    // The user has explicitly said "not now" and we show them nothing further,
    // so hand them straight back to where they came from. Best effort, and it
    // now has three endings: open the requester's scheme, background ourselves
    // on Android so the previous app resumes, or — when neither is possible —
    // raise the notice telling them to switch back themselves.
    //
    // Only when they actually came from somewhere. Declining the OpenStoa
    // mini-app's own login request has the same shape as declining a dapp's,
    // and backgrounding the app on that path is the same defect as on the
    // success path.
    if (requesterIsAnotherApp(pendingRequest.origin)) {
      await returnToRequester(pendingRequest.returnScheme, 'declined');
    }

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

  const inner = (
    <NavigationContainer ref={navigationRef}>
      <TabNavigator />
    </NavigationContainer>
  );

  const tree = (
    <AppKitProvider instance={appKit}>
      {inner}
      <AppKit />
      <ProofRequestModal
        visible={showRequestModal}
        request={pendingRequest}
        onAccept={handleAcceptRequest}
        onReject={handleRejectRequest}
      />
    </AppKitProvider>
  );

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <ErrorProvider>
              <DeepLinkProvider>
                {tree}
              </DeepLinkProvider>
              <ErrorModal />
              {/* Success-side sibling of ErrorModal: shown when the proof was
                  delivered but the app could not hand the user back on its own.
                  Mounted here, inside ThemeProvider, so it can be raised from
                  the utility layer at any point in the deep-link flow. */}
              <ReturnNoticeModal />
            </ErrorProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
};

export default App;
