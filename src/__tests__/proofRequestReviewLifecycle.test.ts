import React from 'react';
import {Platform} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import type {ProofRequest} from '../utils/deeplink';
import {execFileSync} from 'node:child_process';

const mockDispatch = jest.fn();
const mockValidateRelay = jest.fn();
const mockSend = jest.fn();
const mockReturn = jest.fn();
const mockError = jest.fn();
let mockHandler: (url: string, origin: string) => Promise<void>;
let mockReady: () => void;
let mockReset: () => void;
let mockNavigationChanged: (() => void) | undefined;
let mockNavigationState: any;
let mockHoldReviewDismissal = false;
let mockModal: {
  visible: boolean;
  request: ProofRequest | null;
  onAccept: (request: ProofRequest) => boolean;
  onReject: () => Promise<void>;
  onDismiss: () => void;
};
let mockParsed: ProofRequest;

jest.mock('../config/AppKitConfig', () => ({}));
jest.mock('react-native-gesture-handler', () => ({GestureHandlerRootView: 'Root'}));
jest.mock('react-native-keyboard-controller', () => ({KeyboardProvider: 'Keyboard'}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaProvider: 'SafeArea'}));
jest.mock('react-native', () => ({
  Platform: {OS: 'ios'}, Modal: 'Modal', View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: {create: (styles: unknown) => styles},
  Linking: {
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({remove: jest.fn()})),
}}));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({remove: jest.fn()})),
}));
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    CommonActions: {navigate: (payload: unknown) => ({type: 'NAVIGATE', payload})},
    NavigationContainer: R.forwardRef((props: any, ref: any) => {
      R.useImperativeHandle(ref, () => ({dispatch: mockDispatch, getRootState: () => mockNavigationState}));
      mockNavigationChanged = props.onStateChange;
      R.useEffect(() => { props.onReady(); }, []);
      return props.children;
    }),
  };
});
jest.mock('@reown/appkit-react-native', () => ({AppKitProvider: 'AppKitProvider', AppKit: () => null}));
jest.mock('../config', () => ({appKit: {}}));
jest.mock('../screens', () => ({LoadingScreen: (props: any) => {mockReady = props.onReady; return null;}}));
jest.mock('../navigation', () => ({TabNavigator: () => null}));
jest.mock('../components', () => ({
  ProofRequestModal: (props: any) => {
    const R = require('react');
    const wasVisible = R.useRef(false);
    mockModal = props;
    R.useEffect(() => {
      if (wasVisible.current && !props.visible && !mockHoldReviewDismissal) props.onDismiss?.();
      wasVisible.current = props.visible;
    }, [props.visible]);
    return null;
  },
  ErrorModal: () => null,
  ReturnNoticeModal: jest.requireActual('../components/ReturnNoticeModal').ReturnNoticeModal,
}));
jest.mock('../components/ui', () => ({Icon: 'Icon'}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
jest.mock('../context', () => ({
  DeepLinkProvider: 'DeepLink', ErrorProvider: 'Errors', ThemeProvider: 'Theme',
  useThemeColors: () => ({colors: jest.requireActual('../theme').darkColors}),
}));
jest.mock('../utils/errorBridge', () => ({showGlobalError: (...args: unknown[]) => mockError(...args)}));
jest.mock('../utils/deepLinkBridge', () => ({registerDeepLinkHandler: (handler: typeof mockHandler) => {mockHandler = handler;}}));
jest.mock('../hooks', () => ({useAppStateReset: ({onReset}: {onReset: () => void}) => {mockReset = onReset;}}));
// Fresh per test: requests left open by one test would otherwise be answered
// at the next test's launch and consume its stubbed POSTs.
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {mockStorage.set(key, value);},
  removeItem: async (key: string) => {mockStorage.delete(key);},
}}));
jest.mock('../utils/deeplink', () => ({
  parseProofRequestUrl: () => mockParsed,
  isProofportDeepLink: () => true,
  validateProofRequest: jest.requireActual('../utils/deeplink').validateProofRequest,
  validateRequestWithRelay: (...args: unknown[]) => mockValidateRelay(...args),
  // The answer goes through the real once-only responder (src/utils/relayAnswer.ts);
  // only the POST itself and the host check are stubbed.
  postRelayCallback: (...args: unknown[]) => mockSend(...args),
  checkRelayCallbackUrl: () => ({trusted: true, relayBaseUrl: 'https://relay.zkproofport.app'}),
  returnToRequester: (...args: unknown[]) => mockReturn(...args),
  requesterIsAnotherApp: (origin: string) => origin === 'link',
}));

import App from '../../App';
import {resetRelayAnswersForTests} from '../utils/relayAnswer';
import {clearActiveProofRequest, getActiveProofRequest} from '../stores/activeProofRequestStore';
import {showReturnNotice, resetReturnNoticeHandler} from '../utils/returnNoticeBridge';

function request(circuit = 'giwa_attestation', requestId = 'request-1'): ProofRequest {
  const value = {
    requestId, circuit, origin: 'scan', createdAt: Date.now(),
    callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback',
    inputs: {scope: 'topic-access', action: {
      domain: {name: 'Forum', version: '1', chainId: 91342, verifyingContract: `0x${'1'.repeat(40)}`},
      primaryType: 'Permission', types: {Permission: [{name: 'topicId', type: 'string'}]},
      message: {topicId: '한국어 topic', permissions: ['read', 'write']},
    }},
  } as ProofRequest;
  if (circuit !== 'giwa_attestation') value.inputs = {scope: 'topic-access'};
  return value;
}

let tree: ReactTestRenderer;
let consoleError: jest.SpyInstance;
let consoleLog: jest.SpyInstance;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  mockHoldReviewDismissal = false;
  (Platform as {OS: string}).OS = 'ios';
  resetReturnNoticeHandler();
  clearActiveProofRequest();
  mockNavigationChanged = undefined;
  mockNavigationState = {index: 0, routes: [{name: 'ProofTab', state: {index: 0, routes: [{name: 'CircuitSelection'}]}}]};
  mockValidateRelay.mockResolvedValue({valid: true});
  mockStorage.clear();
  resetRelayAnswersForTests();
  mockSend.mockResolvedValue({kind: 'delivered', status: 200});
  mockReturn.mockResolvedValue(undefined);
  consoleError = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    throw new Error([message, ...args].join(' '));
  });
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  await act(async () => {tree = create(React.createElement(App));});
});
afterEach(async () => {
  await act(async () => tree.unmount());
  consoleError.mockRestore();
  consoleLog.mockRestore();
});

async function receive(value: ProofRequest) {
  mockParsed = value;
  await act(async () => {await mockHandler('zkproofport://proof-request', value.origin!);});
}
async function ready() {await act(async () => mockReady());}

it('waits for an active return notice to dismiss natively before opening the newest request', async () => {
  await ready();
  await act(async () => showReturnNotice('declined'));
  const notice = () => tree.root.findByType('Modal' as never);
  expect(notice().props.visible).toBe(true);
  await receive(request('oidc_domain_attestation', 'next'));
  expect(notice().props.visible).toBe(false);
  expect(mockModal.visible).toBe(false);
  const newest = request('giwa_attestation', 'newest');
  await receive(newest);
  await act(async () => mockNavigationChanged?.());
  expect(mockModal.visible).toBe(false);
  await act(async () => notice().props.onDismiss());
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(newest);
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('does not present the return notice until native proof review dismissal completes', async () => {
  await ready();
  mockHoldReviewDismissal = true;
  mockReturn.mockImplementation(async () => showReturnNotice('declined'));
  await receive({...request(), origin: 'link'} as ProofRequest);
  await act(async () => {await mockModal.onReject();});
  expect(mockModal.visible).toBe(false);
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(false);
  expect(mockReturn).not.toHaveBeenCalled();
  await act(async () => mockModal.onDismiss());
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(true);
  expect(mockReturn).toHaveBeenCalledTimes(1);
});

it('keeps an arriving request queued during proof dismissal and discards the older return notice', async () => {
  await ready();
  mockHoldReviewDismissal = true;
  mockReturn.mockImplementation(async () => showReturnNotice('declined'));
  await receive({...request(), origin: 'link'} as ProofRequest);
  await act(async () => {await mockModal.onReject();});
  const newest = request('giwa_attestation', 'newest');
  await receive(newest);
  expect(mockModal.visible).toBe(false);
  await act(async () => mockModal.onDismiss());
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(newest);
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(false);
  expect(mockReturn).not.toHaveBeenCalled();
});

it('does not wait for the iOS-only dismissal event on Android', async () => {
  (Platform as {OS: string}).OS = 'android';
  await ready();
  mockHoldReviewDismissal = true;
  mockReturn.mockImplementation(async () => showReturnNotice('declined'));
  await receive({...request(), origin: 'link'} as ProofRequest);
  await act(async () => {await mockModal.onReject();});
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(true);
  const next = request('giwa_attestation', 'android-next');
  await receive(next);
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(false);
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(next);
});

it('rechecks generation ownership after a return notice finishes dismissing', async () => {
  await ready();
  await act(async () => showReturnNotice('delivered'));
  const next = request('giwa_attestation', 'next');
  await receive(next);
  await proofStackState([{name: 'ProofGeneration'}]);
  await act(async () => tree.root.findByType('Modal' as never).props.onDismiss());
  expect(mockModal.visible).toBe(false);
  await proofStackState([{name: 'ProofComplete'}]);
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(next);
});

it('ignores a delayed return suggestion after a newer proof review has opened', async () => {
  await ready();
  mockHoldReviewDismissal = true;
  let finishReturn!: () => void;
  mockReturn.mockImplementation(() => new Promise<void>(resolve => {
    finishReturn = () => {showReturnNotice('declined'); resolve();};
  }));
  await receive({...request(), origin: 'link'} as ProofRequest);
  await act(async () => {await mockModal.onReject();});
  await act(async () => mockModal.onDismiss());
  const next = request('giwa_attestation', 'newest');
  await receive(next);
  await act(async () => finishReturn());
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(next);
  expect(tree.root.findByType('Modal' as never).props.visible).toBe(false);
});

async function receiveAwaitingRelay(value: ProofRequest) {
  let resolveRelay!: (result: {valid: boolean}) => void;
  mockValidateRelay.mockImplementationOnce(() => new Promise(resolve => {resolveRelay = resolve;}));
  mockParsed = value;
  let receiving!: Promise<void>;
  await act(async () => {receiving = mockHandler('zkproofport://proof-request', value.origin!);});
  return async () => {
    await act(async () => {resolveRelay({valid: true}); await receiving;});
  };
}

it.each(['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region', 'giwa_attestation', 'oidc_domain_attestation'])(
  '%s waits for explicit review on cold start', async circuit => {
    const incoming = request(circuit);
    await receive(incoming);
    expect(mockDispatch).not.toHaveBeenCalled();
    await ready();
    expect(mockModal.visible).toBe(true);
    expect(mockModal.request).toBe(incoming);
    expect(getActiveProofRequest()).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(async () => {mockModal.onAccept(incoming);});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const params = mockDispatch.mock.calls[0][0].payload.params;
    const generation = params.state?.routes.find((route: any) => route.name === 'ProofGeneration');
    expect((generation?.params ?? params.params).proofRequest).toBe(incoming);
  },
);

it('preserves the displayed action without adding defaults or editing it', async () => {
  await ready();
  const incoming = request();
  const original = JSON.stringify(incoming);
  await receive(incoming);
  await act(async () => {mockModal.onAccept(incoming);});
  expect(getActiveProofRequest()).toBe(incoming);
  expect(JSON.stringify(incoming)).toBe(original);
});

it('refuses a request that expires during review', async () => {
  await ready();
  const incoming = {...request(), expiresAt: Date.now() + 1000};
  await receive(incoming);
  const now = jest.spyOn(Date, 'now').mockReturnValue(incoming.expiresAt + 1);
  await act(async () => {mockModal.onAccept(incoming);});
  now.mockRestore();
  expect(mockDispatch).not.toHaveBeenCalled();
  // The modal and the relay answer carry the same code.
  expect(mockError).toHaveBeenCalledWith('E1003', 'Request has expired');
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({requestId: incoming.requestId, status: 'error', errorCode: 'E1003'}), incoming.callbackUrl);
});

it('refuses acceptance exactly at expiry and leaves cancellation available', async () => {
  await ready();
  const incoming = {...request(), expiresAt: Date.now() + 1000};
  await receive(incoming);
  const now = jest.spyOn(Date, 'now').mockReturnValue(incoming.expiresAt);
  let accepted: boolean | undefined;
  await act(async () => {accepted = mockModal.onAccept(incoming);});
  now.mockRestore();
  expect(accepted).toBe(false);
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(getActiveProofRequest()).toBeNull();
  expect(mockModal.visible).toBe(true);
  // The refused acceptance already answered the dApp (expired). Rejecting the
  // card still closes it, but the request has had its one answer.
  await act(async () => {await mockModal.onReject();});
  expect(mockModal.visible).toBe(false);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({status: 'error', errorCode: 'E1003'}), incoming.callbackUrl);
});

it('accepts a reviewed request only once even before React rerenders', async () => {
  await ready();
  const incoming = request();
  await receive(incoming);
  const accept = mockModal.onAccept;
  await act(async () => {accept(incoming); accept(incoming);});
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

it('cannot use the previous card acceptance for a newer request', async () => {
  await ready();
  const first = request();
  await receive(first);
  const staleAccept = mockModal.onAccept;
  const second = request('giwa_attestation', 'request-2');
  await receive(second);
  await act(async () => {staleAccept(first);});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockModal.request).toBe(second);
});

it('ignores an older relay response arriving after the new request', async () => {
  await ready();
  let finishFirst!: (value: {valid: boolean}) => void;
  mockValidateRelay.mockImplementationOnce(() => new Promise(resolve => {finishFirst = resolve;}));
  mockParsed = request();
  let first!: Promise<void>;
  await act(async () => {first = mockHandler('zkproofport://proof-request', 'scan');});
  const second = request('giwa_attestation', 'request-2');
  await receive(second);
  await act(async () => {finishFirst({valid: true}); await first;});
  expect(mockModal.request).toBe(second);
});

it('cancels without navigating and preserves the external return flow', async () => {
  await ready();
  const incoming = {...request(), origin: 'link', returnScheme: 'example://'} as ProofRequest;
  await receive(incoming);
  await act(async () => {await mockModal.onReject();});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({requestId: incoming.requestId, status: 'cancelled'}), incoming.callbackUrl);
  expect(mockReturn).toHaveBeenCalledWith('example://', 'declined');
  expect(mockModal.visible).toBe(false);
});

async function proofStackState(routes: {name: string; params?: unknown}[], selectedTab = 'ProofTab') {
  mockNavigationState = {
    index: selectedTab === 'ProofTab' ? 0 : 1,
    routes: [
      {name: 'ProofTab', state: {index: routes.length - 1, routes}},
      {name: 'WalletTab'},
    ],
  };
  await act(async () => mockNavigationChanged?.());
}

it('keeps a newer in-flight relay request when the displayed request is accepted, then releases it after generation', async () => {
  await ready();
  const first = request('giwa_attestation', 'first');
  const next = request('giwa_attestation', 'next');
  await receive(first);
  const finishNext = await receiveAwaitingRelay(next);
  await act(async () => {expect(mockModal.onAccept(first)).toBe(true);});
  await proofStackState([{name: 'CircuitSelection'}, {name: 'ProofGeneration', params: {proofRequest: first}}]);
  await finishNext();
  expect(mockModal.request).toBe(next);
  expect(mockModal.visible).toBe(false);
  expect(getActiveProofRequest()).toBe(first);
  await proofStackState([{name: 'ProofComplete'}]);
  expect(mockModal.request).toBe(next);
  expect(mockModal.visible).toBe(true);
  await act(async () => {expect(mockModal.onAccept(next)).toBe(true);});
  expect(getActiveProofRequest()).toBe(next);
});

it('keeps a newer in-flight relay request when rejecting the displayed request and stays in this app', async () => {
  await ready();
  const first = {...request('giwa_attestation', 'first'), origin: 'link', returnScheme: 'first://'} as ProofRequest;
  const next = request('giwa_attestation', 'next');
  await receive(first);
  const finishNext = await receiveAwaitingRelay(next);
  await act(async () => {await mockModal.onReject();});
  expect(mockReturn).not.toHaveBeenCalled();
  await finishNext();
  expect(mockModal.request).toBe(next);
  expect(mockModal.visible).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('does not return to a rejected requester when another request arrives during cancellation delivery', async () => {
  await ready();
  const first = {...request('giwa_attestation', 'first'), origin: 'link', returnScheme: 'first://'} as ProofRequest;
  await receive(first);
  let finishCancellation!: () => void;
  mockSend.mockImplementationOnce(() => new Promise(resolve => {finishCancellation = () => resolve({kind: 'delivered', status: 200});}));
  let rejecting!: Promise<void>;
  await act(async () => {rejecting = mockModal.onReject();});
  const next = request('giwa_attestation', 'next');
  const finishNext = await receiveAwaitingRelay(next);
  await act(async () => {finishCancellation(); await rejecting;});
  expect(mockReturn).not.toHaveBeenCalled();
  await finishNext();
  expect(mockModal.request).toBe(next);
  expect(mockModal.visible).toBe(true);
});

it('invalidates pending relay responses on app reset', async () => {
  await ready();
  const finishIncoming = await receiveAwaitingRelay(request());
  await act(async () => mockReset());
  await finishIncoming();
  expect(mockModal.request).toBeNull();
  expect(mockModal.visible).toBe(false);
  expect(getActiveProofRequest()).toBeNull();
  expect(mockDispatch).not.toHaveBeenCalled();
});

it.each(['ProofGeneration', 'OacxWebView'])('defers a new review while %s owns a proof, even on another tab', async current => {
  await ready();
  const first = request('giwa_attestation', 'first');
  await receive(first);
  await act(async () => {mockModal.onAccept(first);});
  const routes = [{name: 'CircuitSelection'}, {name: 'ProofGeneration', params: {proofRequest: first}}];
  if (current === 'OacxWebView') routes.push({name: current});
  await proofStackState(routes, 'WalletTab');
  const next = request('giwa_attestation', 'next');
  await receive(next);
  expect(mockModal.visible).toBe(false);
  expect(getActiveProofRequest()).toBe(first);
  let accepted: boolean | undefined;
  await act(async () => {accepted = mockModal.onAccept(next);});
  expect(accepted).toBe(false);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(getActiveProofRequest()).toBe(first);
});

it.each(['ProofComplete', 'CircuitSelection'])('releases the newest deferred review after %s without waiting on a stale active-store entry', async destination => {
  await ready();
  const first = request('giwa_attestation', 'first');
  await receive(first);
  await act(async () => {mockModal.onAccept(first);});
  await proofStackState([{name: 'CircuitSelection'}, {name: 'ProofGeneration', params: {proofRequest: first}}]);
  await receive(request('giwa_attestation', 'superseded'));
  const newest = request('giwa_attestation', 'newest');
  await receive(newest);
  await proofStackState([{name: destination}]);
  expect(mockModal.visible).toBe(true);
  expect(mockModal.request).toBe(newest);
  expect(getActiveProofRequest()).toBe(first);
  let accepted: boolean | undefined;
  await act(async () => {accepted = mockModal.onAccept(newest);});
  expect(accepted).toBe(true);
  expect(getActiveProofRequest()).toBe(newest);

  // Exercise the installed router with the actual state emitted by App.
  // A bare NAVIGATE would retain the first route key and all its React refs.
  const navigation = mockDispatch.mock.calls[1][0];
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {StackRouter, CommonActions} from '@react-navigation/routers';
    import {readFileSync} from 'node:fs';
    const action = JSON.parse(readFileSync(0, 'utf8'));
    const router = StackRouter({initialRouteName: 'CircuitSelection'});
    const options = {routeNames: ['CircuitSelection', 'ProofGeneration', 'ProofComplete'], routeParamList: {}, routeGetIdList: {}};
    const initial = router.getInitialState(options);
    const active = router.getStateForAction(initial, CommonActions.navigate('ProofGeneration', {proofRequest: {requestId: 'first'}}), options);
    const previousKey = active.routes.at(-1).key;
    const params = action.payload.params;
    const nextAction = params.state ? CommonActions.reset(params.state) : CommonActions.navigate(params.screen, params.params);
    const next = router.getRehydratedState(router.getStateForAction(active, nextAction, options), options);
    process.stdout.write(JSON.stringify({previousKey, routes: next.routes}));
  `], {input: JSON.stringify(navigation), encoding: 'utf8'}));
  expect(result.routes.map((route: any) => route.name)).toEqual(['CircuitSelection', 'ProofGeneration']);
  expect(result.routes.some((route: any) => route.key === result.previousKey)).toBe(false);
  expect(result.routes[1].params.proofRequest.requestId).toBe('newest');
});

it('reports stale, expired, and duplicate acceptance as false', async () => {
  await ready();
  const incoming = {...request(), expiresAt: Date.now() + 1000};
  await receive(incoming);
  expect(mockModal.onAccept({...incoming})).toBe(false);
  const now = jest.spyOn(Date, 'now').mockReturnValue(incoming.expiresAt + 1);
  expect(mockModal.onAccept(incoming)).toBe(false);
  now.mockRestore();
  let accepted: boolean | undefined;
  const accept = mockModal.onAccept;
  await act(async () => {accepted = accept(incoming);});
  expect(accepted).toBe(true);
  expect(accept(incoming)).toBe(false);
});

it('a delayed completion clears only the request that owned the callback', async () => {
  await ready();
  const first = request('giwa_attestation', 'first');
  await receive(first);
  await act(async () => {mockModal.onAccept(first);});
  await proofStackState([{name: 'ProofGeneration', params: {proofRequest: first}}]);
  const second = request('giwa_attestation', 'second');
  await receive(second);
  let finishCallback!: () => void;
  const completion = new Promise<void>(resolve => {finishCallback = resolve;})
    .then(() => clearActiveProofRequest(first));
  await proofStackState([{name: 'ProofComplete'}]);
  await act(async () => {mockModal.onAccept(second);});
  finishCallback();
  await completion;
  expect(getActiveProofRequest()).toBe(second);
  clearActiveProofRequest(second);
  expect(getActiveProofRequest()).toBeNull();
});

// ---------------------------------------------------------------------------
// Every relay request gets one answer, including the ones this screen drops
// before they are approved (zkproofport/proofport-app#2). The responder itself
// is covered in src/utils/__tests__/relayAnswer.test.ts.
// ---------------------------------------------------------------------------
describe('requests dropped before approval are answered', () => {
  function sent() {
    return mockSend.mock.calls.map(call => call[0] as Record<string, unknown>);
  }

  it('a newer request replacing a waiting review answers the older one cancelled, once', async () => {
    await ready();
    const first = request('giwa_attestation', 'first');
    await receive(first);
    await receive(request('giwa_attestation', 'second'));
    await receive(request('giwa_attestation', 'third'));
    expect(sent().filter(body => body.requestId === 'first')).toEqual([
      expect.objectContaining({status: 'cancelled', error: 'Replaced by a newer proof request.'}),
    ]);
    expect(sent().filter(body => body.requestId === 'second')).toHaveLength(1);
    expect(sent().filter(body => body.requestId === 'third')).toHaveLength(0);
  });

  // One QR scan reached the relay five times within 8 ms on 2026-10-15; the
  // duplicates read as newer requests and cancelled the real one (E1007).
  it.each([2, 5])('the same request arriving %i times during its relay check is checked once and not cancelled', async times => {
    await ready();
    const same = request('giwa_attestation', 'same');
    const finish = await receiveAwaitingRelay(same);
    for (let i = 1; i < times; i++) await receive({...same});
    await finish();
    expect(mockValidateRelay).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([]);
    expect(mockModal.visible).toBe(true);
    expect(mockModal.request).toBe(same);
    await receive({...same});
    expect(mockValidateRelay).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([]);
  });

  it('a different request during the relay check still replaces it', async () => {
    await ready();
    const finish = await receiveAwaitingRelay(request('giwa_attestation', 'slow'));
    await receive(request('giwa_attestation', 'slow'));
    await receive(request('giwa_attestation', 'other'));
    await finish();
    expect(sent()).toEqual([expect.objectContaining({requestId: 'slow', status: 'cancelled'})]);
    expect(mockModal.request?.requestId).toBe('other');
  });

  it('a request superseded while its relay check was running is answered cancelled', async () => {
    await ready();
    const finishFirst = await receiveAwaitingRelay(request('giwa_attestation', 'slow'));
    await receive(request('giwa_attestation', 'fast'));
    await finishFirst();
    expect(sent()).toEqual([expect.objectContaining({requestId: 'slow', status: 'cancelled'})]);
  });

  it('an app reset answers the waiting review cancelled', async () => {
    await ready();
    await receive(request('giwa_attestation', 'waiting'));
    await act(async () => mockReset());
    expect(sent()).toEqual([expect.objectContaining({requestId: 'waiting', status: 'cancelled'})]);
  });

  it('a link that fails validation shows E1002 and answers E1002', async () => {
    await ready();
    await receive({...request('giwa_attestation', 'stale'), expiresAt: Date.now() - 1});
    expect(mockError).toHaveBeenCalledWith('E1002', 'Request has expired');
    expect(sent()).toEqual([expect.objectContaining({requestId: 'stale', status: 'error', errorCode: 'E1002'})]);
  });

  it('an unregistered request shows E1006 and answers E1006', async () => {
    await ready();
    mockValidateRelay.mockResolvedValueOnce({valid: false, error: 'requestId not found'});
    await receive(request('giwa_attestation', 'unregistered'));
    expect(mockError).toHaveBeenCalledWith('E1006', 'requestId not found');
    expect(sent()).toEqual([expect.objectContaining({requestId: 'unregistered', status: 'error', errorCode: 'E1006'})]);
  });

  it('a request that passed the relay check is remembered until answered', async () => {
    await ready();
    await receive(request('giwa_attestation', 'open'));
    await act(async () => {await new Promise(resolve => setImmediate(resolve));});
    expect(JSON.parse(mockStorage.get('@zkproofport:relay:openRequests') ?? '[]'))
      .toEqual([expect.objectContaining({requestId: 'open'})]);
    await act(async () => {await mockModal.onReject();});
    await act(async () => {await new Promise(resolve => setImmediate(resolve));});
    expect(JSON.parse(mockStorage.get('@zkproofport:relay:openRequests') ?? '[]')).toEqual([]);
  });

  it('a request left open by a killed run is answered cancelled at the next launch', async () => {
    await act(async () => tree.unmount());
    mockStorage.set('@zkproofport:relay:openRequests', JSON.stringify([{
      requestId: 'killed', circuit: 'giwa_attestation',
      callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback', openedAt: 1, attempts: 0,
    }]));
    await act(async () => {tree = create(React.createElement(App));});
    await act(async () => {await new Promise(resolve => setImmediate(resolve));});
    expect(sent()).toEqual([expect.objectContaining({requestId: 'killed', status: 'cancelled'})]);
  });
});
