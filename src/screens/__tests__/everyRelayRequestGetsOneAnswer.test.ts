/**
 * Every proof request a dApp sent through the relay gets exactly one answer
 * from the proof screen: `completed`, `error` (with the ErrorModal code the
 * person saw), or `cancelled` — zkproofport/proofport-app#2.
 *
 * The real screen, the real `useDeepLink`, the real once-only responder
 * (src/utils/relayAnswer.ts) and the real `sendProofResponseAndReturn` run
 * here. Stubbed: the proof hooks (their step list is driven by the test), the
 * wallet, the attestation lookups, the relay POST (`postRelayCallback`) and
 * the ErrorModal bridge.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage here
 *   contract   → each failure path sends ONE error whose errorCode equals the
 *                code shown in the ErrorModal: hook step errors (vk, validate,
 *                sign, storage, proof, OIDC validate), thrown error, no
 *                attestation, Dojang none / lookup failed, no wallet provider,
 *                missing country inputs, unreadable settings,
 *                OIDC sign-in failed / not ready, unknown circuit,
 *                OIDC token without this request's nonce (E2012), OIDC
 *                request with a non-UUID id / unknown provider / no scope (E2004)
 *   cancel     → wallet rejection, dismissed sign-in, leaving the screen
 *   success    → one `completed`, and leaving afterwards sends nothing more
 *   race       → the hook's error step AND the thrown error in one attempt
 *                send one answer; re-renders send nothing more
 *   retry      → after the answer, Retry starts nothing, sends nothing, and
 *                shows E1007
 *   empty      → a standalone proof (no request) that fails sends nothing
 *   409        → timed out shows E1003 after the failure
 *   external   → the callback POST failing does not crash the screen and is
 *                logged
 *   integrity  → every step id any proof hook declares has a code
 *   boundary / UTF-8 / very large / hostile → in relayAnswer.test.ts, where
 *                the payload is built; authz → N/A, no caller identity here
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import type {ProofStackParamList} from '../../navigation/types';
import type {ProofRequest} from '../../utils/deeplink';

type Step = {id: string; label: string; status: string; detail?: string; code?: string; deviceCheckReason?: string};

const mockGenerate = jest.fn();
const mockSignIn = jest.fn();
const mockMsSignIn = jest.fn();
const mockReset = jest.fn();
const mockNoop = jest.fn();
const mockPost = jest.fn();
const mockShowError = jest.fn();
const mockSettingsGet = jest.fn();
const mockRunGate = jest.fn();
const mockGetProvider = jest.fn();
const mockFindAttestation = jest.fn();
const mockFindDojang = jest.fn();
const mockFindPassport = jest.fn();
const mockResolveChain = jest.fn();
const mockStatement = jest.fn();
const mockPrepareOidcSigner = jest.fn();
const mockOidcSigner = jest.fn();
const mockNavigate = {navigate: jest.fn()};
const mockT = (key: string, opts?: {defaultValue?: string}) => opts?.defaultValue ?? key;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
let mockSteps: Step[] = [];
let mockParsedProof: {proofHex: string; publicInputsHex: string[]; numPublicInputs: number; signerVariant: string} | null = null;
let mockAuthReady = true;
const CALLBACK = 'https://relay.zkproofport.app/api/v1/proof/callback';
const mockRoute: {params: ProofStackParamList['ProofGeneration']} = {params: {circuitId: 'coinbase_attestation'}};

const mockProofHook = () => ({proofSteps: mockSteps, parsedProof: mockParsedProof, isLoading: false,
  generateProofWithSteps: mockGenerate, resetProofCache: mockReset, signalHash: null});

jest.mock('react-native', () => ({
  NativeModules: {}, AppState: {addEventListener: () => ({remove: () => {}})},
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}}, Alert: {alert: jest.fn()},
  Animated: {View: 'AnimatedView', Value: class {interpolate() {return 0;}},
    timing: () => ({}), loop: () => ({start() {}, stop() {}})},
}));
jest.mock('../../components/ProofProgressCard', () => ({ProofProgressCard: 'ProofProgressCard'}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('../../components/ui', () => ({Button: 'Button', Card: 'Card', StepIndicator: 'StepIndicator', LiveLogsPanel: 'LiveLogsPanel'}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigate, useRoute: () => mockRoute}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors})}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(), useDojangPlayground: () => mockProofHook(), useHumanPassport: () => mockProofHook(),
  useGoogleAuth: () => ({isReady: mockAuthReady, promptSignIn: mockSignIn}),
  useMicrosoftAuth: () => ({isReady: mockAuthReady, promptSignIn: mockMsSignIn}),
  useWallet: () => ({account: ACCOUNT, isReady: true, getProvider: mockGetProvider, connect: mockNoop, disconnect: mockNoop}),
  useLogs: () => ({logs: [], addLog: mockNoop, clearLogs: mockNoop}),
  useDeepLink: jest.requireActual('../../hooks/useDeepLink').useDeepLink,
  useSettings: () => ({settings: {confirmBeforeGenerate: false}}),
}));
jest.mock('../../hooks/useCircuitWalletGate', () => ({useCircuitWalletGate: () => ({
  runGate: mockRunGate, recordLookupFailure: mockNoop, wasFailedAddress: () => false, isPostPicker: false,
})}));
jest.mock('../../utils', () => {
  class DojangIssuanceError extends Error {
    kind: string;
    constructor(kind: string, message: string) { super(message); this.kind = kind; }
  }
  return {
    findAttestationTransaction: (...args: unknown[]) => mockFindAttestation(...args),
    findGiwaAttestationTransaction: (...args: unknown[]) => mockFindAttestation(...args),
    findDojangPlaygroundIssuance: (...args: unknown[]) => mockFindDojang(...args),
    DojangIssuanceError,
    SELECTOR_ATTEST_ACCOUNT: '0x1', SELECTOR_ATTEST_COUNTRY: '0x2',
    computeScope: () => new Uint8Array(32),
    nullifierForCircuit: () => new Uint8Array(32),
  };
});
jest.mock('../../utils/humanPassport', () => {
  class HumanPassportError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  return {
    findHumanPassportScore: (...args: unknown[]) => mockFindPassport(...args),
    resolvePassportChain: (...args: unknown[]) => mockResolveChain(...args),
    HumanPassportError,
  };
});
jest.mock('../../utils/errorBridge', () => ({showGlobalError: (...args: unknown[]) => mockShowError(...args)}));
jest.mock('../../utils/deeplink', () => ({
  ...jest.requireActual('../../utils/deeplink'),
  postRelayCallback: (...args: unknown[]) => mockPost(...args),
  checkRelayCallbackUrl: () => ({trusted: true, relayBaseUrl: 'https://relay.zkproofport.app'}),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {
  getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined,
}}));
jest.mock('../../stores', () => ({
  settingsStore: {get: () => mockSettingsGet()},
  proofHistoryStore: {add: jest.fn().mockResolvedValue({id: 'h'}), update: jest.fn().mockResolvedValue(undefined)},
}));
jest.mock('../../stores/circuitWalletStore', () => ({
  getCircuitWallet: async () => ACCOUNT, walletGroupKey: () => 'group',
}));
jest.mock('../../config', () => ({
  canonicalCircuitId: jest.requireActual('../../config/circuitIds').canonicalCircuitId,
  getNetworkConfigForCircuit: () => ({name: 'Test', chainId: 1, explorerUrl: ''}),
  getVerifierAddressSync: () => '0x2222222222222222222222222222222222222222',
}));
jest.mock('../../utils/circuit', () => ({getCircuitDisplayName: () => 'Circuit'}));
// Coinbase KYC v2's App Attest statement (the native module is not here).
jest.mock('../../appAttest/coinbaseKycStatement', () => ({
  prepareCoinbaseKycStatement: (...args: unknown[]) => mockStatement(...args),
}));
// The OIDC provider-key signer (App Attest), prepared before the sign-in sheet.
jest.mock('../../oidc/oidcAppSigner', () => ({
  prepareOidcAppSigner: (...args: unknown[]) => mockPrepareOidcSigner(...args),
}));

import {ProofGenerationScreen, STEP_ERROR_CODE} from '../proof/ProofGenerationScreen';
import {WALLET_REJECTED_PREFIX} from '../../utils/walletRejection';
import {resetRelayAnswersForTests} from '../../utils/relayAnswer';
import {clearActiveProofRequest} from '../../stores/activeProofRequestStore';
import {deriveOidcNonce} from '../../oidc/oidcNonce';
import {jwt} from '../../oidc/__tests__/jwt';

function request(circuit: ProofRequest['circuit'], inputs: Record<string, unknown> = {scope: 'scope'}): ProofRequest {
  return {requestId: `req-${circuit}`, circuit, callbackUrl: CALLBACK, createdAt: 1, inputs} as ProofRequest;
}

/** The relay mints uuidv4 request ids; an OIDC request's nonce is derived from one. */
const OIDC_RID = '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b';
function oidcRequest(inputs: Record<string, unknown> = {scope: 's', provider: 'google'}): ProofRequest {
  return {...request('oidc_domain_attestation', inputs), requestId: OIDC_RID};
}

/** A provider that honours the nonce it was asked for. */
const tokenFor = async (nonce: string) => ({token: jwt({nonce, email: 'a@corp.com'})});

let tree: ReactTestRenderer | null;
let errors: jest.SpyInstance;
let logs: jest.SpyInstance;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetRelayAnswersForTests();
  clearActiveProofRequest();
  tree = null;
  mockSteps = [];
  mockParsedProof = null;
  mockAuthReady = true;
  mockPost.mockResolvedValue({kind: 'delivered', status: 200});
  mockSettingsGet.mockResolvedValue({autoSaveProofs: false});
  mockRunGate.mockResolvedValue({address: ACCOUNT});
  mockGetProvider.mockResolvedValue({send: jest.fn()});
  mockFindAttestation.mockResolvedValue({rawTransaction: '0xraw', attestation: {id: `0x${'ab'.repeat(32)}`}});
  mockFindDojang.mockResolvedValue({rawTransaction: '0xraw'});
  mockFindPassport.mockResolvedValue({request: {recipient: ACCOUNT}, head: {score: 300000}});
  mockResolveChain.mockResolvedValue(10);
  mockStatement.mockResolvedValue({clientData: new Uint8Array(225), attestedAt: 1});
  mockPrepareOidcSigner.mockResolvedValue(mockOidcSigner);
  mockGenerate.mockResolvedValue(undefined);
  mockSignIn.mockImplementation(tokenFor);
  mockMsSignIn.mockImplementation(tokenFor);
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  logs = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  // No answer this screen sends names a device-check service or build kind,
  // whatever the failure (user decision 2026-10-30).
  const {namesAService} = jest.requireActual('../../utils/neutralText');
  for (const body of mockPost.mock.calls.map(call => call[0] as {error?: unknown})) {
    if (typeof body.error === 'string') expect([body.error, namesAService(body.error)]).toEqual([body.error, false]);
  }
  if (tree) act(() => tree!.unmount());
  jest.useRealTimers();
  errors.mockRestore();
  logs.mockRestore();
});

/** Bodies the relay received, in order. */
function answers(): Array<Record<string, unknown>> {
  return mockPost.mock.calls.map(call => call[0]);
}

/** A device-check reason that belongs to `code` (src/appAttest/deviceCheckReasons.ts). */
function reasonOf(code: string): string {
  const {DEVICE_CHECK_REASONS} = jest.requireActual('../../appAttest/deviceCheckReasons');
  const r = Object.keys(DEVICE_CHECK_REASONS).find(k => DEVICE_CHECK_REASONS[k] === code);
  if (!r) throw new Error(`No device-check reason for ${code}`);
  return r;
}

async function mount(circuitId: string, proofRequest?: ProofRequest, extra: Partial<ProofStackParamList['ProofGeneration']> = {}) {
  mockRoute.params = {circuitId, proofRequest, ...extra} as ProofStackParamList['ProofGeneration'];
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  // Auto-start waits 500 ms; the wallet-bound check resolves first.
  await act(async () => {await jest.advanceTimersByTimeAsync(600);});
}

async function rerender() {
  await act(async () => {tree!.update(React.createElement(ProofGenerationScreen));});
  await act(async () => {await jest.advanceTimersByTimeAsync(10);});
}

/**
 * The hook reports a failed step the way the real hooks do: its step list
 * gains an `error` entry. Published in its own render, like a proof is in
 * approvedProofAutoStart.test.ts — a state change made inside a fake-timer
 * callback leaves React's passive effects unflushed under jest.
 */
async function failStep(id: string, detail: string) {
  mockSteps = [{id, label: id, status: 'error', detail}];
  await rerender();
}

function expectOneError(code: string) {
  expect(answers()).toHaveLength(1);
  expect(answers()[0]).toMatchObject({status: 'error', errorCode: code});
  // The dApp gets the code the person was shown.
  expect(mockShowError).toHaveBeenCalledWith(code, expect.any(String));
}

function retryButton() {
  return tree!.root.findAllByType('Button' as never)
    .find(button => button.props.title === 'host.proof.generation.retryButton')!;
}

describe('a failed hook step answers once, with its code', () => {
  it.each([
    ['vk', 'E2002'],
    ['validate', 'E2005'],
    ['sign', 'E4002'],
    ['storage', 'E5001'],
    ['proof', 'E2001'],
    ['parse', 'E2001'],
  ])('step %s -> %s', async (step, code) => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await failStep(step, `${step} broke`);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expectOneError(code);
    expect(answers()[0].error).toBe(`${step} broke`);
    // More renders of the same failed step list send nothing more.
    await rerender();
    await rerender();
    expect(answers()).toHaveLength(1);
  });

  it('OIDC validate is a sign-in failure (E2008), not an attestation one', async () => {
    await mount('oidc_domain_attestation', oidcRequest());
    await failStep('validate', 'JWT expired');
    expectOneError('E2008');
  });

  it('a rejection in the wallet answers cancelled, not error', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await failStep('sign', `${WALLET_REJECTED_PREFIX}: User rejected the request.`);
    expect(answers()).toEqual([expect.objectContaining({status: 'cancelled'})]);
    expect(answers()[0]).not.toHaveProperty('errorCode');
  });
});

describe('every inline failure path answers once, with its code', () => {
  it('a thrown error (outer catch) -> E2001', async () => {
    mockGenerate.mockRejectedValue(new Error('prover crashed'));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError('E2001');
    expect(answers()[0].error).toBe('prover crashed');
  });

  it('the hook marking an error step AND throwing in one attempt answers once', async () => {
    mockGenerate.mockRejectedValue(new Error('both'));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await failStep('proof', 'both');
    await rerender();
    expect(answers()).toHaveLength(1);
    expect(mockShowError).toHaveBeenCalledTimes(1);
  });

  it('no attestation -> E2005', async () => {
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError('E2005');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('no Dojang Playground issuance -> E2007', async () => {
    const {DojangIssuanceError} = jest.requireMock('../../utils');
    mockFindDojang.mockRejectedValue(new DojangIssuanceError('none', 'no issuance'));
    await mount('dojang_playground', request('dojang_playground'));
    expectOneError('E2007');
  });

  it('a Dojang lookup that did not finish -> E3002', async () => {
    mockFindDojang.mockRejectedValue(new Error('rpc down'));
    await mount('dojang_playground', request('dojang_playground'));
    expectOneError('E3002');
  });

  it.each([['E2021', 'no score'], ['E2022', 'below'], ['E2023', 'too large'], ['E3001', 'lookup did not finish']])(
    'a Human Passport lookup refused with %s answers once with it', async (code, message) => {
      const {HumanPassportError} = jest.requireMock('../../utils/humanPassport');
      mockFindPassport.mockRejectedValue(new HumanPassportError(code, message));
      await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore: 20}));
      expectOneError(code);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

  it.each([['E2021'], ['E2022'], ['E3001']])('no chain holding a usable score (%s) answers once with it, nothing proved', async code => {
    const {HumanPassportError} = jest.requireMock('../../utils/humanPassport');
    mockResolveChain.mockRejectedValue(new HumanPassportError(code, 'no chain'));
    await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore: 20}));
    expectOneError(code);
    expect(mockFindPassport).not.toHaveBeenCalled();
  });

  it('an in-app proof uses the chain the person picked', async () => {
    await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore: 20}), {passportInputs: {minScore: 20, chainId: 360}});
    expect(mockResolveChain).toHaveBeenCalledWith(ACCOUNT, 360, 200000, expect.any(Number), expect.any(Function));
  });

  it('a Human Passport lookup that threw something else -> E3001', async () => {
    mockFindPassport.mockRejectedValue(new Error('socket hang up'));
    await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore: 20}));
    expectOneError('E3001');
  });

  it.each([[undefined], [0], ['20'], [20.00001]])('a Human Passport request with minScore %p -> E2004, nothing looked up', async minScore => {
    await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore}));
    expectOneError('E2004');
    expect(mockFindPassport).not.toHaveBeenCalled();
  });

  it('a Human Passport request proves with the requested threshold in score units', async () => {
    await mount('human_passport_score', request('human_passport_score', {scope: 's', minScore: 20.5}));
    expect(mockResolveChain).toHaveBeenCalledWith(ACCOUNT, undefined, 205000, expect.any(Number), expect.any(Function));
    expect(mockFindPassport).toHaveBeenCalledWith(ACCOUNT, 10, 205000, expect.any(Number), expect.any(Function));
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({userAddress: ACCOUNT, minScoreUnits: 205000, scopeString: 's'});
    expect(answers()).toHaveLength(0);
  });

  it('no wallet provider -> E4001', async () => {
    mockGetProvider.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError('E4001');
  });

  it('missing country inputs -> E2004', async () => {
    await mount('coinbase_country_attestation', request('coinbase_country_attestation', {scope: 's'}));
    expectOneError('E2004');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('unreadable settings -> E5002', async () => {
    mockSettingsGet.mockRejectedValue(new Error('storage unavailable'));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError('E5002');
  });

  it('OIDC sign-in failed -> E2008', async () => {
    mockSignIn.mockResolvedValue({error: 'keychain error -2', cancelled: false});
    await mount('oidc_domain_attestation', oidcRequest());
    expectOneError('E2008');
  });

  it('OIDC sign-in not ready -> E2008', async () => {
    mockAuthReady = false;
    await mount('oidc_domain_attestation', oidcRequest());
    expectOneError('E2008');
  });

  it('a dismissed OIDC sign-in answers cancelled', async () => {
    mockSignIn.mockResolvedValue({error: 'closed', cancelled: true});
    await mount('oidc_domain_attestation', oidcRequest());
    expect(answers()).toEqual([expect.objectContaining({status: 'cancelled'})]);
  });

  it('OIDC asks the provider for the nonce of THIS request and proves its token', async () => {
    await mount('oidc_domain_attestation', oidcRequest());
    expect(mockSignIn).toHaveBeenCalledWith(deriveOidcNonce('s', OIDC_RID));
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({jwtToken: jwt({nonce: deriveOidcNonce('s', OIDC_RID), email: 'a@corp.com'}), scopeString: 's', nonce: deriveOidcNonce('s', OIDC_RID)}),
      expect.any(Function),
    );
  });

  it('OIDC hands the hook the App Attest signer prepared before sign-in', async () => {
    await mount('oidc_domain_attestation', oidcRequest());
    expect(mockPrepareOidcSigner).toHaveBeenCalledTimes(1);
    expect(mockPrepareOidcSigner.mock.invocationCallOrder[0]).toBeLessThan(mockSignIn.mock.invocationCallOrder[0]);
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({providerKeySigner: mockOidcSigner}), expect.any(Function));
  });

  it.each([
    ['an Android phone or build the circuit does not accept', 'E2015'],
    ['Android attestation data the circuit cannot take', 'E2016'],
    ['a phone or simulator without App Attest', 'E2009'],
    ['a development App Attest key', 'E2014'],
    ['Apple App Attest unreachable', 'E3006'],
  ])('OIDC on %s -> %s before any sign-in, and nothing is proved', async (_label, code) => {
    const {AppAttestError} = jest.requireActual('../../appAttest/appAttestError');
    mockPrepareOidcSigner.mockRejectedValue(new AppAttestError(reasonOf(code), 'refused'));
    await mount('oidc_domain_attestation', oidcRequest());
    expectOneError(code);
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockMsSignIn).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it.each([['E2009'], ['E2014'], ['E2015'], ['E2016'], ['E2017'], ['E3006'], ['E3008']])(
    'a device-check failure (%s) shows the code\'s own text on the screen, never the internal reason', async code => {
      const {AppAttestError} = jest.requireActual('../../appAttest/appAttestError');
      const reason = "This build's App Attest key is a development (sandbox) key; Coinbase KYC v2 accepts production keys only";
      mockPrepareOidcSigner.mockRejectedValue(new AppAttestError(reasonOf(code), reason));
      await mount('oidc_domain_attestation', oidcRequest());
      const shown = tree!.root.findAllByType('Text' as never).map(n => [n.props.children].flat().join(''));
      expect(shown).toContain(`host.errors.${code}.description`);
      expect(shown.some(text => text.includes(reason))).toBe(false);
      // The precise reason still reaches the log and the modal call (where
      // createAppError keeps it off screen, tested in deviceCheckScreensNameNoService).
      expect(mockShowError).toHaveBeenCalledWith(code, expect.stringContaining('sandbox'));
    });

  it('a non-device code still shows its own reason on the screen', async () => {
    mockGenerate.mockRejectedValue(new Error('prover crashed'));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    const shown = tree!.root.findAllByType('Text' as never).map(n => [n.props.children].flat().join(''));
    expect(shown).toContain('prover crashed');
  });

  it.each([['E2014'], ['E3002'], ['E2008']])('an OIDC step failing with its own code %s answers that code', async code => {
    await mount('oidc_domain_attestation', oidcRequest());
    mockSteps = [{id: 'jwks', label: 'jwks', status: 'error', detail: 'refused', code}];
    await rerender();
    expectOneError(code);
  });

  it('OIDC microsoft signs in with Microsoft, with the same nonce rule', async () => {
    await mount('oidc_domain_attestation', oidcRequest({scope: 's', provider: 'microsoft'}));
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockMsSignIn).toHaveBeenCalledWith(deriveOidcNonce('s', OIDC_RID));
  });

  it.each([
    ['no nonce', async () => ({token: jwt({email: 'a@corp.com'})})],
    ['another request’s nonce', async () => ({token: jwt({nonce: deriveOidcNonce('s', '00000000-0000-4000-8000-000000000000')})})],
    ['a Math.random-style nonce', async () => ({token: jwt({nonce: 'k3j4h5g6'})})],
  ])('OIDC token with %s -> E2012, and nothing is proved', async (_label, impl) => {
    mockSignIn.mockImplementation(impl);
    await mount('oidc_domain_attestation', oidcRequest());
    expectOneError('E2012');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it.each([
    ['a request id that is not a UUID', {...oidcRequest(), requestId: 'req-oidc'}],
    ['an unknown provider', oidcRequest({scope: 's', provider: 'Microsoft'})],
    ['no scope', oidcRequest({provider: 'google'})],
  ])('OIDC with %s -> E2004 before any sign-in', async (_label, req) => {
    await mount('oidc_domain_attestation', req);
    expectOneError('E2004');
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockMsSignIn).not.toHaveBeenCalled();
  });

  it.each(['not_a_circuit', 'mdl_kr_age', 'mdl-kr-age'])('an unknown circuit (%s) is refused on arrival -> E2006', async circuit => {
    await mount(circuit, {...request('coinbase_attestation'), requestId: 'req-unknown'});
    expectOneError('E2006');
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('success, leaving, retrying', () => {
  it('a factory-phone proof tells the relay which package made it', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1, signerVariant: 'android_factory'};
    await rerender();
    // Its package's own contract (development build: Base Sepolia), never the
    // iPhone circuit's address the config mock answers for the id.
    expect(answers()).toEqual([expect.objectContaining({
      status: 'completed', signerVariant: 'android_factory', verifierAddress: '0xBFAf9390c36d14D596556e42eb52d984De040Aa1',
    })]);
  });

  it('a Coinbase KYC proof that does not say which package made it answers E2016, never completed', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1} as never;
    await rerender();
    expectOneError('E2016');
  });

  it('a proof answers completed once; leaving afterwards sends nothing', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1, signerVariant: 'standard'};
    await rerender();
    expect(answers()).toEqual([expect.objectContaining({status: 'completed', proof: '0xproof', signerVariant: 'standard'})]);
    act(() => tree!.unmount());
    tree = null;
    await act(async () => {await jest.advanceTimersByTimeAsync(10);});
    expect(answers()).toHaveLength(1);
  });

  it('leaving before an answer sends one cancelled', async () => {
    // Never resolves: the proof is still running when the person leaves.
    mockGenerate.mockImplementation(() => new Promise(() => {}));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(answers()).toHaveLength(0);
    act(() => tree!.unmount());
    tree = null;
    await act(async () => {await jest.advanceTimersByTimeAsync(10);});
    expect(answers()).toEqual([expect.objectContaining({status: 'cancelled', requestId: 'req-coinbase_attestation'})]);
  });

  it('leaving after an error sends nothing more', async () => {
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    act(() => tree!.unmount());
    tree = null;
    await act(async () => {await jest.advanceTimersByTimeAsync(10);});
    expect(answers()).toHaveLength(1);
    expect(answers()[0].status).toBe('error');
  });

  it('Retry after the answer starts nothing, sends nothing, and says why (E1007)', async () => {
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(mockFindAttestation).toHaveBeenCalledTimes(1);
    mockFindAttestation.mockResolvedValue({rawTransaction: '0xraw', attestation: {id: `0x${'ab'.repeat(32)}`}});
    await act(async () => {await retryButton().props.onPress();});
    expect(mockFindAttestation).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(answers()).toHaveLength(1);
    expect(mockShowError).toHaveBeenLastCalledWith('E1007', expect.stringContaining('req-coinbase_attestation'));
  });

  it('a standalone proof that fails answers nobody, but still shows the error', async () => {
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', undefined);
    const generate = tree!.root.findAllByType('Button' as never)[0];
    await act(async () => {await generate.props.onPress();});
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith('E2005', expect.any(String));
    act(() => tree!.unmount());
    tree = null;
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('the screen says when it stops holding a new request\'s review', () => {
  // App.tsx keeps a new request's review closed only while this screen is
  // busy (src/stores/generationScreenStore.ts); an ended attempt must say so,
  // or the next request stays invisible underneath it.
  /* eslint-disable-next-line @typescript-eslint/no-var-requires */
  const store = require('../../stores/generationScreenStore');

  it('busy from the moment an accepted relay request mounts, while it proves', async () => {
    mockGenerate.mockImplementation(() => new Promise(() => {}));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(store.isGenerationScreenIdle()).toBe(false);
  });

  it.each([
    ['a thrown error', () => mockGenerate.mockRejectedValue(new Error('prover crashed'))],
    ['no attestation', () => mockFindAttestation.mockResolvedValue(null)],
  ])('idle once the attempt fails (%s), while the failed screen stays up', async (_label, arrange) => {
    arrange();
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(answers()[0].status).toBe('error');
    expect(store.isGenerationScreenIdle()).toBe(true);
  });

  it('idle once a proof is made', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1, signerVariant: 'standard'};
    await rerender();
    expect(store.isGenerationScreenIdle()).toBe(true);
  });

  it('an in-app screen nobody started is idle; pressing generate makes it busy', async () => {
    mockGenerate.mockImplementation(() => new Promise(() => {}));
    await mount('coinbase_attestation', undefined);
    expect(store.isGenerationScreenIdle()).toBe(true);
    const generate = tree!.root.findAllByType('Button' as never)[0];
    await act(async () => {generate.props.onPress();});
    expect(store.isGenerationScreenIdle()).toBe(false);
  });

  it('leaving returns the store to its default (busy) unless a newer screen took over', async () => {
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(store.isGenerationScreenIdle()).toBe(true);
    act(() => tree!.unmount());
    tree = null;
    expect(store.isGenerationScreenIdle()).toBe(false);
  });
});

describe('the relay answers back', () => {
  it('409 timed out: the person is told the request expired', async () => {
    mockPost.mockResolvedValue({kind: 'conflict', status: 409, timedOut: true, body: '{"reason":"timeout"}'});
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(mockShowError).toHaveBeenCalledWith('E2005', expect.any(String));
    expect(mockShowError).toHaveBeenLastCalledWith('E1003', expect.stringContaining('[E2005]'));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('a callback that cannot be sent does not crash the screen and is logged', async () => {
    mockPost.mockRejectedValue(new Error('socket hang up'));
    mockFindAttestation.mockResolvedValue(null);
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[RelayAnswer]'), expect.any(Error));
    expect(retryButton()).toBeDefined();
  });
});

describe('every hook step has an error code', () => {
  it('covers each step id the proof hooks declare', () => {
    const hooks = ['useCoinbaseKyc', 'useCoinbaseCountry', 'useOidcDomain', 'useGiwaKyc', 'useDojangPlayground', 'useHumanPassport'];
    const ids = new Set<string>();
    for (const name of hooks) {
      const src = fs.readFileSync(path.join(__dirname, '../../hooks', `${name}.ts`), 'utf8');
      for (const m of src.matchAll(/updateStep\('([A-Za-z_-]+)'/g)) ids.add(m[1]);
      for (const m of src.matchAll(/\{id: '([A-Za-z_-]+)', label:/g)) ids.add(m[1]);
    }
    // A broken pattern must not pass by matching nothing.
    expect(ids.size).toBeGreaterThanOrEqual(10);
    const missing = [...ids].filter(id => !Object.prototype.hasOwnProperty.call(STEP_ERROR_CODE, id));
    expect(missing).toEqual([]);
  });
});

describe('a wallet rejection is recognised by its code', () => {
  const {isWalletRejection, rejectedInWallet} = jest.requireActual('../../utils/walletRejection');

  it.each([[{code: 4001}, true], [{code: 5000}, true], [{code: -32002}, false], [{code: '4001'}, false],
    [new Error('User rejected'), false], [null, false], [undefined, false]])('%j -> %s', (error, expected) => {
    expect(isWalletRejection(error)).toBe(expected);
  });

  it('only the fixed prefix marks a detail as a rejection', () => {
    expect(rejectedInWallet(`${WALLET_REJECTED_PREFIX}: x`)).toBe(true);
    expect(rejectedInWallet('Signature failed: User rejected the request.')).toBe(false);
    expect(rejectedInWallet(undefined)).toBe(false);
  });

  it('every signing hook re-throws a rejection with the prefix', () => {
    const signing = ['useCoinbaseKyc', 'useCoinbaseCountry', 'useGiwaKyc', 'useDojangPlayground', 'useHumanPassport'];
    for (const name of signing) {
      const src = fs.readFileSync(path.join(__dirname, '../../hooks', `${name}.ts`), 'utf8');
      // The classification lives in one place since 2026-10-30
      // (src/utils/walletError.ts), so each hook must hand its error there.
      expect([name, /throw signingFailure\(signError\);/.test(src)]).toEqual([name, true]);
    }
    const {signingFailure} = jest.requireActual('../../utils/walletError');
    // A WalletConnect rejection arrives as a plain object, not an Error.
    expect(signingFailure({code: 4001, message: 'User rejected the request.'}).message)
      .toMatch(new RegExp(`^${WALLET_REJECTED_PREFIX}: `));
    expect(rejectedInWallet(signingFailure({code: 5000, message: 'rejected'}).message)).toBe(true);
    expect(rejectedInWallet(signingFailure({code: -32603, message: 'Internal error'}).message)).toBe(false);
  });
});

/*
 * Coinbase KYC v2: every Coinbase KYC request -- a dApp's included -- needs
 * the App Attest statement, made before the wallet is asked. Each way it can
 * fail answers the dApp ONCE with the code the person saw, and nothing is
 * proved.
 */
describe('Coinbase KYC v2 App Attest statement on a relay request', () => {
  const {AppAttestError} = jest.requireActual('../../appAttest/appAttestError');

  it.each([
    ['E2015', 'an Android chain the circuit refuses'],
    ['E2016', 'malformed Android attestation data'],
    ['E2009', 'no App Attest on this device'],
    ['E2011', 'revoked'],
    ['E3006', 'Apple unreachable'],
    ['E3002', 'EAS lookup failed'],
  ])('%s (%s) answers one error with that code and proves nothing', async (code, why) => {
    mockStatement.mockRejectedValue(new AppAttestError(reasonOf(code), why));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError(code);
    expect(mockShowError).toHaveBeenCalledWith(code, why);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('a development key is answered E2014 with its reason and neutral text, never the precise wording', async () => {
    const precise = "This build's App Attest key is a development (sandbox) key; Coinbase KYC v2 accepts production keys only";
    mockStatement.mockRejectedValue(new AppAttestError('ios_key_dev_environment', precise));
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expectOneError('E2014');
    const {ErrorCodes} = jest.requireActual('../../constants/errorCodes');
    expect(answers()[0].error).toBe(`${ErrorCodes.E2014.description} [reason: ios_key_dev_environment]`);
    // The precise reason is still this app's to log.
    expect(mockShowError).toHaveBeenCalledWith('E2014', precise);
  });

  it('a hook step carrying a device-check reason answers it too', async () => {
    await mount('oidc_domain_attestation', oidcRequest());
    mockSteps = [{id: 'jwks', label: 'jwks', status: 'error', detail: 'Play Integrity said no', code: 'E2017', deviceCheckReason: 'integrity_device_not_met'}];
    await rerender();
    expectOneError('E2017');
    expect(String(answers()[0].error)).toMatch(/\[reason: integrity_device_not_met\]$/);
  });

  it('a proof that does not say its package answers E2016 with its own reason', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1} as never;
    await rerender();
    expectOneError('E2016');
    expect(String(answers()[0].error)).toMatch(/\[reason: proof_package_unstated\]$/);
  });

  it('is made for the dApp request, with the action it carried, and handed to the hook', async () => {
    const action = {domain: {name: 'Forum', version: '1', chainId: 84532, verifyingContract: ACCOUNT},
      types: {Join: [{name: 'topicId', type: 'string'}]}, primaryType: 'Join', message: {topicId: 't'}};
    await mount('coinbase_attestation', request('coinbase_attestation', {scope: 'scope', action}));
    expect(mockStatement).toHaveBeenCalledWith(expect.objectContaining({
      walletAddress: ACCOUNT, attestationUid: `0x${'ab'.repeat(32)}`, scopeString: 'scope', action,
    }));
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({circuit: 'coinbase_attestation', appAttest: expect.objectContaining({action})}),
      expect.anything(), expect.anything(),
    );
  });
});
