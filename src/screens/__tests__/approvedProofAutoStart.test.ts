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
let mockParsedProof: {proofHex: string; publicInputsHex: string[]; numPublicInputs: number} | null = null;
const mockT = (key: string) => key;
const mockNavigate = {navigate: jest.fn()};
const mockRequest: ProofRequest = {requestId: 'approved', circuit: 'oidc_domain_attestation', createdAt: 1,
  callbackUrl: 'https://relay.example/callback', inputs: {scope: 'scope', provider: 'google'}};
const mockRoute: {params: ProofStackParamList['ProofGeneration']} = {params: {circuitId: 'oidc_domain_attestation', proofRequest: mockRequest}};
const mockSteps: unknown[] = [];
const mockProofHook = () => ({proofSteps: mockSteps, parsedProof: mockParsedProof, isGenerating: false,
  generateProofWithSteps: mockGenerate, resetProofCache: mockReset});

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {create: (styles: unknown) => styles}, Alert: {alert: jest.fn()},
  Animated: {View: 'AnimatedView', Value: class {interpolate() {return 0;}},
    timing: () => ({}), loop: () => ({start() {}, stop() {}})},
}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('../../components/MobileIdTypeSheet', () => ({MobileIdTypeSheet: 'MobileIdTypeSheet'}));
jest.mock('../../components/ui', () => ({Button: 'Button', Card: 'Card', StepIndicator: 'StepIndicator', LiveLogsPanel: 'LiveLogsPanel'}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigate, useRoute: () => mockRoute}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors})}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(),
  useGoogleAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useMicrosoftAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useWallet: () => ({account: null, isReady: false, getProvider: mockNoop, connect: mockNoop, disconnect: mockNoop}),
  useLogs: () => ({logs: [], addLog: mockNoop, clearLogs: mockNoop}),
  useDeepLink: jest.requireActual('../../hooks/useDeepLink').useDeepLink,
  useSettings: () => ({settings: {confirmBeforeGenerate: false}}),
}));
jest.mock('../../hooks/useMdlKr', () => ({useMdlKr: () => mockProofHook()}));
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
}));
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

let tree: ReactTestRenderer;
let errors: jest.SpyInstance;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  clearActiveProofRequest();
  mockAutoSave = false;
  mockParsedProof = null;
  mockRoute.params = {circuitId: 'oidc_domain_attestation', proofRequest: mockRequest};
  mockSignIn.mockResolvedValue({token: 'approved-token'});
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
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: 'approved-token', scopeString: 'scope', domain: '', provider: 'google'}, mockNoop);
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
  mockParsedProof = {proofHex: '0x1234', publicInputsHex: ['0x01'], numPublicInputs: 1};
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
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: 'approved-token', scopeString: 'manual-scope', domain: '', provider: 'google'}, mockNoop);
  await publishProof();
  expect(mockDeliver).not.toHaveBeenCalled();
  expect(mockNavigate.navigate).toHaveBeenCalledWith('ProofComplete', expect.objectContaining({proofHex: '0x1234'}));
  expect(mockHistoryAdd).not.toHaveBeenCalled();
  expect(mockHistoryUpdate).not.toHaveBeenCalled();
});

it('uses its approved route request when another request is already in the active store', async () => {
  const next = {...mockRequest, requestId: 'next', callbackUrl: 'https://relay.example/next',
    inputs: {scope: 'next-scope', provider: 'google'}};
  setActiveProofRequest(next);
  await mountAndWait();
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: 'approved-token', scopeString: 'scope', domain: '', provider: 'google'}, mockNoop);
  await publishProof();
  expect(mockDeliver).toHaveBeenCalledWith(expect.objectContaining({requestId: 'approved', proof: '0x1234'}), mockRequest);
  expect(getActiveProofRequest()).toBe(next);
});

it.each(['delivered', 'failed', 'rejected'] as const)('retains a newer request when earlier delivery is %s', async outcome => {
  let finish!: (value: boolean) => void;
  let fail!: (reason: Error) => void;
  mockDeliver.mockReturnValue(new Promise<boolean>((resolve, reject) => {finish = resolve; fail = reject;}));
  setActiveProofRequest(mockRequest);
  await mountAndWait();
  await publishProof();
  const next = {...mockRequest, requestId: 'next', callbackUrl: 'https://relay.example/next'};
  setActiveProofRequest(next);
  await act(async () => {tree.update(React.createElement(ProofGenerationScreen));});
  const deliveryError = new Error('Callback unavailable');
  if (outcome === 'rejected') errors.mockImplementation(() => {});
  await act(async () => {
    if (outcome === 'rejected') fail(deliveryError);
    else finish(outcome === 'delivered');
  });
  expect(mockDeliver).toHaveBeenCalledTimes(1);
  expect(mockDeliver).toHaveBeenCalledWith(expect.objectContaining({requestId: 'approved'}), mockRequest);
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
  expect(mockHistoryAdd).toHaveBeenCalledWith(expect.objectContaining({source: 'deeplink', requestId: 'approved',
    review: {version: 1, inputs: {scope: 'scope', provider: 'google'}, action},
  }));
  expect(JSON.stringify(mockHistoryAdd.mock.calls[0][0])).not.toMatch(/private-jwt|private-transaction|jwtToken|rawTransaction/);
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
  expect(mockGenerate).toHaveBeenCalledWith({jwtToken: 'approved-token', scopeString: 'manual-scope', domain: '', provider: 'google'}, mockNoop);
});
