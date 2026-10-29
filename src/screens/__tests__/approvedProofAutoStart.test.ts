import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import type {ProofStackParamList} from '../../navigation/types';
import type {ProofRequest} from '../../utils/deeplink';

const mockGenerate = jest.fn();
const mockSignIn = jest.fn();
const mockReset = jest.fn();
const mockNoop = jest.fn();
const mockDeliver = jest.fn();
const mockHistoryAdd = jest.fn();
const mockHistoryUpdate = jest.fn();
const mockSettingsGet = jest.fn();
const mockShowError = jest.fn();
let mockAutoSave = false;
let mockParsedProof: {proofHex: string; publicInputsHex: string[]; numPublicInputs: number; signerVariant: string} | null = null;
const mockT = (key: string) => key;
const mockNavigate = {navigate: jest.fn()};
// The relay mints uuidv4 ids; an OIDC request's nonce is derived from one.
const APPROVED = '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b';
const NEXT = '00000000-0000-4000-8000-000000000001';
const mockRequest: ProofRequest = {requestId: APPROVED, circuit: 'oidc_domain_attestation', createdAt: 1,
  callbackUrl: 'https://relay.example/callback', inputs: {scope: 'scope', provider: 'google'}};
const mockRoute: {params: ProofStackParamList['ProofGeneration']} = {params: {circuitId: 'oidc_domain_attestation', proofRequest: mockRequest}};
const mockSteps: unknown[] = [];
const mockProofHook = () => ({proofSteps: mockSteps, parsedProof: mockParsedProof, isGenerating: false,
  generateProofWithSteps: mockGenerate, resetProofCache: mockReset});

jest.mock('react-native', () => ({
  NativeModules: {}, AppState: {addEventListener: () => ({remove: () => {}})},
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {create: (styles: unknown) => styles}, Alert: {alert: jest.fn()},
  Animated: {View: 'AnimatedView', Value: class {interpolate() {return 0;}},
    timing: () => ({}), loop: () => ({start() {}, stop() {}})},
}));
jest.mock('../../components/ProofProgressCard', () => ({ProofProgressCard: 'ProofProgressCard'}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('../../components/ui', () => ({Button: 'Button', Card: 'Card', StepIndicator: 'StepIndicator', LiveLogsPanel: 'LiveLogsPanel'}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigate, useRoute: () => mockRoute}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors})}));
// The OIDC provider-key signer (App Attest; no native module here). Its own
// refusals are in everyRelayRequestGetsOneAnswer and oidc/__tests__.
jest.mock('../../oidc/oidcAppSigner', () => ({
  prepareOidcAppSigner: async () => async () => ({}),
}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(), useDojangPlayground: () => mockProofHook(),
  useGoogleAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useMicrosoftAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useWallet: () => ({account: null, isReady: false, getProvider: mockNoop, connect: mockNoop, disconnect: mockNoop}),
  useLogs: () => ({logs: [], addLog: mockNoop, clearLogs: mockNoop}),
  useDeepLink: jest.requireActual('../../hooks/useDeepLink').useDeepLink,
  useSettings: () => ({settings: {confirmBeforeGenerate: false}}),
}));
// Real hooks return fresh wrapper objects around memoized methods. Preserve
// that shape so an accidental dependency on the wrapper cancels the timer.
jest.mock('../../hooks/useCircuitWalletGate', () => ({useCircuitWalletGate: () => ({
  runGate: mockNoop, recordLookupFailure: mockNoop, wasFailedAddress: mockNoop, isPostPicker: false,
})}));
jest.mock('../../utils', () => ({computeScope: mockNoop, computeNullifier: mockNoop}));
jest.mock('../../utils/errorBridge', () => ({showGlobalError: (...args: unknown[]) => mockShowError(...args)}));
jest.mock('../../utils/deeplink', () => ({
  sendProofResponseAndReturn: (...args: unknown[]) => mockDeliver(...args),
  sendProofResponse: jest.fn().mockResolvedValue(true),
  postRelayCallback: jest.fn().mockResolvedValue({kind: 'delivered', status: 200}),
  checkRelayCallbackUrl: () => ({trusted: true, relayBaseUrl: 'https://relay.example'}),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {
  getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined,
}}));
jest.mock('../../stores', () => ({
  settingsStore: {get: () => mockSettingsGet()},
  proofHistoryStore: {
    add: (...args: unknown[]) => mockHistoryAdd(...args),
    update: (...args: unknown[]) => mockHistoryUpdate(...args),
  },
}));
jest.mock('../../stores/circuitWalletStore', () => ({getCircuitWallet: mockNoop, walletGroupKey: mockNoop}));
jest.mock('../../config', () => ({
  canonicalCircuitId: (id: string) => id,
  getNetworkConfigForCircuit: () => ({name: 'Test', chainId: 1}),
  getVerifierAddressSync: () => '0x1111111111111111111111111111111111111111',
}));
jest.mock('../../utils/circuit', () => ({getCircuitDisplayName: () => 'OIDC Domain'}));

import {ProofGenerationScreen} from '../proof/ProofGenerationScreen';
import {clearActiveProofRequest, getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';
import {resetRelayAnswersForTests} from '../../utils/relayAnswer';
import {deriveOidcNonce} from '../../oidc/oidcNonce';
import {jwt} from '../../oidc/__tests__/jwt';

/** The token a provider returns for a nonce: it carries that nonce. */
const tokenFor = (nonce: string) => jwt({nonce, email: 'a@corp.com'});

/** An in-app proof mints its own UUID; the nonce asked for is bound to it and the token proved carries it. */
function expectStandaloneProof(scope: string) {
  const nonce = mockSignIn.mock.calls[mockSignIn.mock.calls.length - 1][0];
  expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  expect(nonce).not.toBe(deriveOidcNonce(scope, APPROVED));
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: tokenFor(nonce), scopeString: scope, domain: '', provider: 'google', nonce, providerKeySigner: expect.any(Function)}, mockNoop);
}

let tree: ReactTestRenderer;
let errors: jest.SpyInstance;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  clearActiveProofRequest();
  // Each test reuses requestId APPROVED; one test's answer must not make the
  // next test's request look already answered.
  resetRelayAnswersForTests();
  mockAutoSave = false;
  mockParsedProof = null;
  mockRoute.params = {circuitId: 'oidc_domain_attestation', proofRequest: mockRequest};
  mockSignIn.mockImplementation(async (nonce: string) => ({token: tokenFor(nonce)}));
  mockGenerate.mockResolvedValue(undefined);
  mockDeliver.mockResolvedValue(true);
  mockHistoryAdd.mockResolvedValue({id: 'history-1'});
  mockHistoryUpdate.mockResolvedValue(undefined);
  mockSettingsGet.mockImplementation(async () => ({autoSaveProofs: mockAutoSave}));
  const originalError = console.error;
  errors = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    originalError(...args);
  });
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  clearActiveProofRequest();
  jest.useRealTimers();
  errors.mockRestore();
});

it('keeps the approved auto-start scheduled across an ordinary rerender', async () => {
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  await act(async () => {tree.update(React.createElement(ProofGenerationScreen));});
  expect(mockSignIn).not.toHaveBeenCalled();
  await act(async () => {await jest.advanceTimersByTimeAsync(500);});
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockSignIn).toHaveBeenCalledWith(deriveOidcNonce('scope', APPROVED));
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: tokenFor(deriveOidcNonce('scope', APPROVED)), scopeString: 'scope', domain: '', provider: 'google', nonce: deriveOidcNonce('scope', APPROVED), providerKeySigner: expect.any(Function)}, mockNoop);
});

it('cancels the scheduled sign-in when the proof screen is removed', async () => {
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  act(() => tree.unmount());
  await act(async () => {await jest.advanceTimersByTimeAsync(500);});
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockGenerate).not.toHaveBeenCalled();
});

async function mountAndWait() {
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  await act(async () => {await jest.advanceTimersByTimeAsync(500);});
}

async function publishProof() {
  mockParsedProof = {proofHex: '0x1234', publicInputsHex: ['0x01'], numPublicInputs: 1, signerVariant: 'standard'};
  await act(async () => {tree.update(React.createElement(ProofGenerationScreen));});
}

it('does not auto-start or reuse a pending callback when the next proof is standalone', async () => {
  setActiveProofRequest(mockRequest);
  mockRoute.params = {circuitId: 'oidc_domain_attestation',
    domainInput: {provider: 'google', scope: 'manual-scope'}};
  await mountAndWait();
  expect(mockSignIn).not.toHaveBeenCalled();
  const generate = tree.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.generation.signInGoogle')!;
  await act(async () => {await generate.props.onPress();});
  expectStandaloneProof('manual-scope');
  await publishProof();
  expect(mockDeliver).not.toHaveBeenCalled();
  expect(mockNavigate.navigate).toHaveBeenCalledWith('ProofComplete', expect.objectContaining({proofHex: '0x1234'}));
  expect(mockHistoryAdd).not.toHaveBeenCalled();
  expect(mockHistoryUpdate).not.toHaveBeenCalled();
});

it('uses its approved route request when another request is already in the active store', async () => {
  const next = {...mockRequest, requestId: NEXT, callbackUrl: 'https://relay.example/next',
    inputs: {scope: 'next-scope', provider: 'google'}};
  setActiveProofRequest(next);
  await mountAndWait();
  expect(mockSignIn).toHaveBeenCalledWith(deriveOidcNonce('scope', APPROVED));
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: tokenFor(deriveOidcNonce('scope', APPROVED)), scopeString: 'scope', domain: '', provider: 'google', nonce: deriveOidcNonce('scope', APPROVED), providerKeySigner: expect.any(Function)}, mockNoop);
  await publishProof();
  expect(mockDeliver).toHaveBeenCalledWith(expect.objectContaining({requestId: APPROVED, proof: '0x1234'}), mockRequest, expect.any(Function));
  expect(getActiveProofRequest()).toBe(next);
});

it.each(['delivered', 'failed', 'rejected'] as const)('retains a newer request when earlier delivery is %s', async outcome => {
  let finish!: (value: boolean) => void;
  let fail!: (reason: Error) => void;
  mockDeliver.mockReturnValue(new Promise<boolean>((resolve, reject) => {finish = resolve; fail = reject;}));
  setActiveProofRequest(mockRequest);
  await mountAndWait();
  await publishProof();
  const next = {...mockRequest, requestId: NEXT, callbackUrl: 'https://relay.example/next'};
  setActiveProofRequest(next);
  await act(async () => {tree.update(React.createElement(ProofGenerationScreen));});
  const deliveryError = new Error('Callback unavailable');
  if (outcome === 'rejected') errors.mockImplementation(() => {});
  await act(async () => {
    if (outcome === 'rejected') fail(deliveryError);
    else finish(outcome === 'delivered');
  });
  expect(mockDeliver).toHaveBeenCalledTimes(1);
  expect(mockDeliver).toHaveBeenCalledWith(expect.objectContaining({requestId: APPROVED}), mockRequest, expect.any(Function));
  expect(getActiveProofRequest()).toBe(next);
  expect(mockNavigate.navigate).toHaveBeenCalledTimes(1);
  expect(mockHistoryAdd).not.toHaveBeenCalled();
  expect(mockHistoryUpdate).not.toHaveBeenCalled();
  if (outcome === 'rejected') expect(errors).toHaveBeenCalledWith(deliveryError);
});

it('saves reviewed conditions and action without authentication material when auto-save is enabled', async () => {
  mockAutoSave = true;
  const action = {domain: {name: 'Forum', version: '1', chainId: 1, verifyingContract: `0x${'1'.repeat(40)}`},
    primaryType: 'Permission', types: {Permission: [{name: 'topicId', type: 'string'}]}, message: {topicId: '한국어 topic'}};
  mockRoute.params.proofRequest = {...mockRequest, inputs: {
    ...mockRequest.inputs, action, jwtToken: 'private-jwt', rawTransaction: 'private-transaction',
  }} as ProofRequest;
  await mountAndWait();
  expect(mockHistoryAdd).toHaveBeenCalledTimes(1);
  expect(mockHistoryAdd).toHaveBeenCalledWith(expect.objectContaining({source: 'deeplink', requestId: APPROVED,
    review: {version: 1, inputs: {scope: 'scope', provider: 'google'}, action},
  }));
  expect(JSON.stringify(mockHistoryAdd.mock.calls[0][0])).not.toMatch(/private-jwt|private-transaction|jwtToken|rawTransaction/);
  // History's stored display text is saved with the record, from the sanitised inputs.
  expect(mockHistoryAdd.mock.calls[0][0].display).toEqual(expect.objectContaining({icon: 'organization'}));
  await publishProof();
  expect(mockHistoryUpdate).toHaveBeenCalledWith('history-1', expect.objectContaining({proofHash: '0x1234'}));
});

it('stops on unreadable settings and retries without proving or delivering stale cached data', async () => {
  // Drive the button directly so a rejected handler is observable instead of
  // becoming an unhandled rejection from the approved auto-start timer.
  mockRoute.params = {circuitId: 'oidc_domain_attestation', domainInput: {provider: 'google', scope: 'manual-scope'}};
  mockSettingsGet.mockRejectedValueOnce(new Error('Settings storage unavailable'));
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  const first = tree.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.generation.signInGoogle')!;
  let rejected: unknown;
  await act(async () => {try {await first.props.onPress();} catch (error) {rejected = error;}});
  expect(rejected).toBeUndefined();
  expect(mockShowError).toHaveBeenCalledWith('E5002', 'Settings storage unavailable');
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(mockHistoryAdd).not.toHaveBeenCalled();
  await publishProof();
  expect(mockNavigate.navigate).not.toHaveBeenCalled();
  expect(mockDeliver).not.toHaveBeenCalled();
  mockParsedProof = null;
  await act(async () => {tree.update(React.createElement(ProofGenerationScreen));});
  const retry = tree.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.generation.retryButton')!;
  expect(retry.props.disabled).toBe(false);
  expect(retry.props.loading).toBe(false);
  await act(async () => {await retry.props.onPress();});
  expect(mockSettingsGet).toHaveBeenCalledTimes(2);
  expectStandaloneProof('manual-scope');
});

it('records the minted request id of an in-app OIDC proof in History, and binds the nonce to it', async () => {
  mockAutoSave = true;
  mockRoute.params = {circuitId: 'oidc_domain_attestation', domainInput: {provider: 'google', scope: '한국어 scope 🚀'}};
  await mountAndWait();
  const generate = tree.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.generation.signInGoogle')!;
  await act(async () => {await generate.props.onPress();});
  const saved = mockHistoryAdd.mock.calls[0][0];
  expect(saved).toEqual(expect.objectContaining({source: 'manual'}));
  expect(saved.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(mockSignIn).toHaveBeenCalledWith(deriveOidcNonce('한국어 scope 🚀', saved.requestId));
  expectStandaloneProof('한국어 scope 🚀');
});

it('mints a different request id, so a different nonce, for each in-app attempt', async () => {
  mockRoute.params = {circuitId: 'oidc_domain_attestation', domainInput: {provider: 'google', scope: 'manual-scope'}};
  mockGenerate.mockRejectedValue(new Error('prover crashed'));
  await mountAndWait();
  const button = (title: string) => tree.root.findAllByType('Button' as never).find(b => b.props.title === title)!;
  await act(async () => {await button('host.proof.generation.signInGoogle').props.onPress();});
  await act(async () => {await button('host.proof.generation.retryButton').props.onPress();});
  expect(mockSignIn).toHaveBeenCalledTimes(2);
  expect(mockSignIn.mock.calls[0][0]).not.toBe(mockSignIn.mock.calls[1][0]);
});
