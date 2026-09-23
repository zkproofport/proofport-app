// AppKit config must be imported first
import './src/config/AppKitConfig';

import 'react-native-gesture-handler';
import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {Linking, Platform} from 'react-native';
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
  type NavigationAction,
  type NavigationState,
} from '@react-navigation/native';
import {createNavigationQueue} from './src/utils/navigationQueue';
import {reviewBlockReason} from './src/utils/requestReview';
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
import {registerReturnNoticeHandler, type ReturnNoticeKind} from './src/utils/returnNoticeBridge';
import {useAppStateReset} from './src/hooks';

/** A proof may keep running while the user visits another tab or its ID WebView. */
function hasGenerationScreen(state: NavigationState | undefined): boolean {
  const proofStack = state?.routes.find(route => route.name === 'ProofTab')?.state;
  if (!proofStack) return false;
  let generating = false;
  const currentIndex = proofStack.index ?? 0;
  for (let index = 0; index <= currentIndex; index++) {
    const screen = proofStack.routes[index]?.name;
    if (screen === 'ProofGeneration' || screen === 'OacxWebView') generating = true;
    if (screen === 'ProofComplete') generating = false;
  }
  return generating;
}

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRequest, setPendingRequest] = useState<ProofRequest | null>(
    null,
  );
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [returnNotice, setReturnNotice] = useState<{kind: ReturnNoticeKind; visible: boolean} | null>(null);
  // UIKit cannot present a sibling native Modal until the previous one has
  // actually dismissed. False React visibility alone is not that boundary.
  const modalOwner = useRef<'review' | 'reviewClosing' | 'notice' | 'noticeClosing' | null>(null);
  const queuedReturnNotice = useRef<ReturnNoticeKind | null>(null);
  const returnAfterDismissal = useRef<(() => Promise<void>) | null>(null);
  const pendingRequestRef = useRef<ProofRequest | null>(null);
  // Incoming relay validation is superseded only by another arrival or reset.
  // Consuming the displayed review must not discard a newer in-flight request.
  const relaySequence = useRef(0);
  const pendingRelaySequence = useRef(0);
  // Review/arrival activity separately invalidates a delayed external return.
  const requestSequence = useRef(0);
  const generationNavigationPending = useRef(false);
  const navigationRef = useRef<NavigationContainerRef<TabParamList>>(null);
  // Track currently active request to prevent processing while modal is open
  const activeRequestId = useRef<string | null>(null);

  // A deep link can arrive before there is anywhere to navigate to — see
  // src/utils/navigationQueue.ts for the cold-start window and how it was
  // reproduced. Every imperative navigation in this file goes through the
  // queue so none of them can be dropped on the floor.
  const navigationReadyRef = useRef(false);
  const navigationQueue = useMemo(
    () =>
      createNavigationQueue<NavigationAction>({
        dispatch: (action) => navigationRef.current?.dispatch(action),
        claimRequest: (requestId) => {
          activeRequestId.current = requestId;
        },
        isReady: () => navigationReadyRef.current && navigationRef.current !== null,
        log: (message) => console.log(message),
      }),
    [],
  );

  const navigateOrQueue = useCallback(
    (action: NavigationAction, requestId: string | null) => {
      navigationQueue.navigate(action, requestId);
    },
    [navigationQueue],
  );

  const showPendingReview = useCallback(() => {
    if (!pendingRequestRef.current || generationNavigationPending.current ||
        hasGenerationScreen(navigationRef.current?.getRootState())) return;
    queuedReturnNotice.current = null;
    if (modalOwner.current === 'notice') {
      modalOwner.current = Platform.OS === 'ios' ? 'noticeClosing' : null;
      setReturnNotice(notice => notice && {...notice, visible: false});
    }
    if (modalOwner.current === 'noticeClosing' || modalOwner.current === 'reviewClosing') return;
    modalOwner.current = 'review';
    setShowRequestModal(true);
  }, []);

  const closeReview = useCallback(() => {
    if (modalOwner.current === 'review') {
      modalOwner.current = Platform.OS === 'ios' ? 'reviewClosing' : null;
    }
    setShowRequestModal(false);
  }, []);

  const presentReturnNotice = useCallback((kind: ReturnNoticeKind) => {
    // An incoming request takes precedence over an older return suggestion.
    if (pendingRequestRef.current) return;
    if (modalOwner.current === 'reviewClosing' || modalOwner.current === 'noticeClosing') {
      queuedReturnNotice.current = kind;
      return;
    }
    if (modalOwner.current === 'review') return;
    modalOwner.current = 'notice';
    setReturnNotice({kind, visible: true});
  }, []);

  useEffect(() => registerReturnNoticeHandler(presentReturnNotice), [presentReturnNotice]);

  const handleReviewDismissed = useCallback(() => {
    if (modalOwner.current !== 'reviewClosing') return;
    modalOwner.current = null;
    showPendingReview();
    const notice = queuedReturnNotice.current;
    queuedReturnNotice.current = null;
    if (notice) presentReturnNotice(notice);
    const returnToApp = returnAfterDismissal.current;
    returnAfterDismissal.current = null;
    if (returnToApp) void returnToApp();
  }, [showPendingReview, presentReturnNotice]);

  const finishReturnAfterReview = useCallback(async (returnToApp: () => Promise<void>) => {
    if (modalOwner.current === 'reviewClosing') returnAfterDismissal.current = returnToApp;
    else await returnToApp();
  }, []);

  const handleNoticeDismissed = useCallback(() => {
    if (modalOwner.current !== 'noticeClosing') return;
    modalOwner.current = null;
    setReturnNotice(null);
    showPendingReview();
    const notice = queuedReturnNotice.current;
    queuedReturnNotice.current = null;
    if (notice) presentReturnNotice(notice);
  }, [showPendingReview, presentReturnNotice]);

  const dismissReturnNotice = useCallback(() => {
    if (modalOwner.current !== 'notice') return;
    modalOwner.current = 'noticeClosing';
    setReturnNotice(notice => notice && {...notice, visible: false});
    // React Native exposes onDismiss only on iOS; Android uses a Dialog.
    if (Platform.OS !== 'ios') handleNoticeDismissed();
  }, [handleNoticeDismissed]);

  const handleNavigationStateChange = useCallback(() => {
    const generating = hasGenerationScreen(navigationRef.current?.getRootState());
    if (generating) generationNavigationPending.current = false;
    showPendingReview();
  }, [showPendingReview]);

  const handleNavigationReady = useCallback(() => {
    navigationReadyRef.current = true;
    navigationQueue.flush();
    handleNavigationStateChange();
  }, [navigationQueue, handleNavigationStateChange]);

  // Reset handler for when app returns from background after timeout
  const handleAppReset = useCallback(() => {
    console.log('[App] Resetting app state due to background timeout...');

    // Clear any pending proof request
    requestSequence.current += 1;
    relaySequence.current += 1;
    pendingRelaySequence.current = 0;
    generationNavigationPending.current = false;
    pendingRequestRef.current = null;
    setPendingRequest(null);
    closeReview();
    if (isLoading) modalOwner.current = null;
    queuedReturnNotice.current = null;
    returnAfterDismissal.current = null;
    activeRequestId.current = null;
    clearActiveProofRequest();
  }, [closeReview, isLoading]);

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

    // Only the latest incoming request may replace the review card.
    const sequence = ++relaySequence.current;
    requestSequence.current += 1;
    // Validate requestId with relay server — reject unregistered requests
    const relayValidation = await validateRequestWithRelay(request.requestId, request.callbackUrl, request.inputs as Record<string, unknown>);
    if (sequence !== relaySequence.current) return;
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

    // Mark this as the active request. Safe to claim here for the modal path:
    // it is React state, so it renders whenever the tree comes up.
    activeRequestId.current = request.requestId;

    console.log('[App] Valid proof request, waiting for review:', request.requestId);
    pendingRequestRef.current = request;
    pendingRelaySequence.current = sequence;
    setPendingRequest(request);
    // Preserve the active request until its generation screen has left. A
    // newly reviewed request must never replace a running proof's callback.
    showPendingReview();
  }, [showPendingReview]);

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
  // Queued for the same reason as the mDL deep link: tapping a push wakes the
  // app from cold, and this fires while LoadingScreen still owns the screen.
  const openOpenStoaChat = useCallback((topicId: string) => {
    if (!topicId) return;
    navigateOrQueue(
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
      null,
    );
  }, [navigateOrQueue]);

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

  const handleAcceptRequest = useCallback((reviewedRequest: ProofRequest) => {
    if (!pendingRequest || reviewedRequest !== pendingRequest ||
        pendingRequestRef.current !== reviewedRequest || modalOwner.current !== 'review') return false;
    if (generationNavigationPending.current ||
        hasGenerationScreen(navigationRef.current?.getRootState())) return false;

    const validation = validateProofRequest(reviewedRequest);
    const expired = reviewBlockReason(reviewedRequest) === 'expired';
    if (!validation.valid || expired) {
      showGlobalError('E1002', validation.error ?? 'Request has expired');
      return false;
    }

    // Consume this review synchronously, before a second press can navigate.
    pendingRequestRef.current = null;
    requestSequence.current += 1;
    generationNavigationPending.current = true;

    console.log('[App] Accepting request:', pendingRequest.requestId);
    console.log('[App] Request callbackUrl:', pendingRequest.callbackUrl);
    closeReview();

    // Set active request in store before navigation
    setActiveProofRequest(pendingRequest);

    // Navigate to proof generation with stack reset to avoid stacking on ProofComplete
    //
    // The canonical id is passed straight through. This used to rewrite two of
    // the seven circuits into the app's legacy hyphenated route ids, because
    // the generation screen once only recognised those — which is why five
    // other circuits arrived spelled one way and two the other, and why every
    // table downstream had to carry both spellings. The screen resolves route
    // ids itself now (`canonicalCircuitId`), so nothing has to be translated
    // on the way in.
    const circuitId = pendingRequest.circuit;

    // Reset the nested proof stack to fresh route keys. Plain NAVIGATE reuses
    // a current ProofGeneration instance, including its auto-start/cache refs.
    // The nested state also removes an earlier generation below ProofComplete.
    navigateOrQueue(
      CommonActions.navigate({
        name: 'ProofTab',
        params: {
          state: {
            index: 1,
            routes: [
              {name: 'CircuitSelection'},
              {name: 'ProofGeneration', params: {circuitId, proofRequest: pendingRequest}},
            ],
          },
        },
      }),
      null,
    );

    // Clear active request after navigation
    activeRequestId.current = null;
    setPendingRequest(null);
    // Note: activeProofRequest is cleared by ProofGenerationScreen after proof is sent
    return true;
  }, [pendingRequest, navigateOrQueue, closeReview]);

  const handleRejectRequest = useCallback(async () => {
    if (!pendingRequest || pendingRequestRef.current !== pendingRequest || modalOwner.current !== 'review') return;

    console.log('[App] Rejecting request:', pendingRequest.requestId);
    // A newer request may already be awaiting relay validation while this
    // older card remains visible. Stay here to review that incoming request.
    const wasLatestIncoming = pendingRelaySequence.current === relaySequence.current;
    pendingRequestRef.current = null;
    const sequence = ++requestSequence.current;
    closeReview();
    activeRequestId.current = null;
    setPendingRequest(null);

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
    const returnIfCurrent = async () => {
      if (wasLatestIncoming && sequence === requestSequence.current && requesterIsAnotherApp(pendingRequest.origin)) {
        await returnToRequester(pendingRequest.returnScheme, 'declined');
      }
    };
    await finishReturnAfterReview(returnIfCurrent);
  }, [pendingRequest, closeReview, finishReturnAfterReview]);

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
    <NavigationContainer ref={navigationRef} onReady={handleNavigationReady}
      onStateChange={handleNavigationStateChange}>
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
        onDismiss={handleReviewDismissed}
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
              <ReturnNoticeModal kind={returnNotice?.kind ?? null} visible={returnNotice?.visible ?? false}
                onRequestClose={dismissReturnNotice} onDismiss={handleNoticeDismissed} />
            </ErrorProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
};

export default App;
