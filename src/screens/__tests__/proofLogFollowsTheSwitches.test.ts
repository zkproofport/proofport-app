/**
 * The proof screen keeps an attempt's log in its History record, and hands it
 * to the completion screen, only when Developer Mode AND live logs are on.
 *
 * The real screen and the real `useLogs` run; the proof hooks, wallet,
 * attestation lookup, relay POST and stores are stubbed. The hooks write log
 * lines through the `addLog` the screen passes them, the way the real ones do.
 *
 * MATRIX rows held here (the rest are in proofLogKeepsNoSecrets.test.ts):
 *   gating     -> on/on keeps; on/off, off/on, off/off and a damaged "true"
 *                 keep nothing and hide the live panel; the settings READ AT
 *                 THE START of the attempt decide, not the screen's copy
 *   failure    -> a failed attempt keeps its log up to the error and the
 *                 ErrorModal code; a cancelled one keeps "[Cancelled]"
 *   success    -> the record and the completion screen get the same log
 *   history off-> no record is written, the completion screen still gets it
 *   hostile    -> a signature and an ID token the hooks log are stored scrubbed
 *   OIDC       -> the sign-in claims line (nonce, aud, azp) is in the log,
 *                 the token is not
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import type {ProofStackParamList} from '../../navigation/types';
import type {ProofRequest} from '../../utils/deeplink';

type Step = {id: string; label: string; status: string; detail?: string};

const mockGenerate = jest.fn();
const mockSignIn = jest.fn();
const mockNoop = jest.fn();
const mockGetProvider = async () => ({send: jest.fn()});
const mockPost = jest.fn();
const mockSettingsGet = jest.fn();
const mockHistoryAdd = jest.fn();
const mockHistoryUpdate = jest.fn();
const mockRunGate = jest.fn();
const mockNavigate = {navigate: jest.fn()};
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const REQUEST_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
let mockSteps: Step[] = [];
let mockParsedProof: {proofHex: string; publicInputsHex: string[]; numPublicInputs: number} | null = null;
let mockScreenSettings: Record<string, unknown> | null = null;
const mockRoute: {params: ProofStackParamList['ProofGeneration']} = {params: {circuitId: 'coinbase_attestation'}};

const mockProofHook = () => ({proofSteps: mockSteps, parsedProof: mockParsedProof, isLoading: false,
  generateProofWithSteps: mockGenerate, resetProofCache: mockNoop, signalHash: null});

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}}, Alert: {alert: jest.fn()},
  Animated: {View: 'AnimatedView', Value: class {interpolate() {return 0;}},
    timing: () => ({}), loop: () => ({start() {}, stop() {}})},
}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('../../components/MobileIdTypeSheet', () => ({MobileIdTypeSheet: 'MobileIdTypeSheet'}));
jest.mock('../../components/ui', () => ({Button: 'Button', Card: 'Card', StepIndicator: 'StepIndicator', LiveLogsPanel: 'LiveLogsPanel'}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigate, useRoute: () => mockRoute}));
// Stable across renders, like the real one: the screen's callbacks depend on it.
const mockT = (key: string, o?: {defaultValue?: string}) => o?.defaultValue ?? key;
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors})}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(), useDojangPlayground: () => mockProofHook(),
  useGoogleAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useMicrosoftAuth: () => ({isReady: true, promptSignIn: mockSignIn}),
  useWallet: () => ({account: ACCOUNT, isReady: true, getProvider: mockGetProvider, connect: mockNoop, disconnect: mockNoop}),
  useLogs: jest.requireActual('../../hooks/useLogs').useLogs,
  useDeepLink: jest.requireActual('../../hooks/useDeepLink').useDeepLink,
  useSettings: () => ({settings: mockScreenSettings}),
}));
jest.mock('../../hooks/useMdlKr', () => ({useMdlKr: () => mockProofHook()}));
jest.mock('../../hooks/useCircuitWalletGate', () => ({useCircuitWalletGate: () => ({
  runGate: mockRunGate, recordLookupFailure: mockNoop, wasFailedAddress: () => false, isPostPicker: false,
})}));
jest.mock('../../utils', () => ({
  findAttestationTransaction: async () => ({rawTransaction: '0xraw', attestation: {id: `0x${'ab'.repeat(32)}`}}),
  findGiwaAttestationTransaction: async () => ({rawTransaction: '0xraw'}),
  findDojangPlaygroundIssuance: async () => ({rawTransaction: '0xraw'}),
  DojangIssuanceError: class extends Error {},
  SELECTOR_ATTEST_ACCOUNT: '0x1', SELECTOR_ATTEST_COUNTRY: '0x2',
  computeScope: () => new Uint8Array(32),
  nullifierForCircuit: () => new Uint8Array(32),
  getTimestamp: () => '12:00:00',
}));
jest.mock('../../utils/errorBridge', () => ({showGlobalError: jest.fn()}));
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
  proofHistoryStore: {add: (...a: unknown[]) => mockHistoryAdd(...a), update: (...a: unknown[]) => mockHistoryUpdate(...a)},
}));
jest.mock('../../stores/circuitWalletStore', () => ({getCircuitWallet: async () => ACCOUNT, walletGroupKey: () => 'group'}));
jest.mock('../../config', () => ({
  canonicalCircuitId: jest.requireActual('../../config/circuitIds').canonicalCircuitId,
  getNetworkConfigForCircuit: () => ({name: 'Test', chainId: 1, explorerUrl: ''}),
  getVerifierAddressSync: () => '0x2222222222222222222222222222222222222222',
}));
jest.mock('../../utils/circuit', () => ({getCircuitDisplayName: () => 'Circuit'}));
// Coinbase KYC v2's App Attest statement (the native module is not here).
jest.mock('../../appAttest/coinbaseKycStatement', () => ({
  prepareCoinbaseKycStatement: async () => ({clientData: new Uint8Array(225), attestedAt: 1}),
}));

import {ProofGenerationScreen} from '../proof/ProofGenerationScreen';
import {resetRelayAnswersForTests} from '../../utils/relayAnswer';
import {clearActiveProofRequest} from '../../stores/activeProofRequestStore';
import {WALLET_REJECTED_PREFIX} from '../../utils/walletRejection';
import {deriveOidcNonce} from '../../oidc/oidcNonce';

const SIGNATURE = `0x${'ab'.repeat(65)}`;
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
// The nonce this request derives (src/oidc/oidcNonce.ts), so the token passes the binding check.
const NONCE = deriveOidcNonce('s', REQUEST_ID);
const AUD = '448669482783-web.apps.googleusercontent.com';
const AZP = '448669482783-ios.apps.googleusercontent.com';
const jwtWith = (nonce: string) =>
  `${b64url({alg: 'RS256', kid: 'k'})}.${b64url({iss: 'https://accounts.google.com', aud: AUD, azp: AZP, nonce, exp: 1761530000})}.${'Q'.repeat(300)}`;
const JWT = jwtWith(NONCE);
const ON = {developerMode: true, showLiveLogs: true, autoSaveProofs: true, confirmBeforeGenerate: false};

function request(circuit: ProofRequest['circuit'], inputs: Record<string, unknown> = {scope: 'scope'}): ProofRequest {
  return {requestId: REQUEST_ID, circuit, callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback',
    createdAt: 1, inputs, dappName: 'Test dApp'} as ProofRequest;
}

let tree: ReactTestRenderer | null;
let quiet: jest.SpyInstance[];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetRelayAnswersForTests();
  clearActiveProofRequest();
  tree = null;
  mockSteps = [];
  mockParsedProof = null;
  mockScreenSettings = ON;
  mockSettingsGet.mockResolvedValue(ON);
  mockHistoryAdd.mockResolvedValue({id: 'record-1'});
  mockHistoryUpdate.mockResolvedValue(undefined);
  mockPost.mockResolvedValue({kind: 'delivered', status: 200});
  mockRunGate.mockResolvedValue({address: ACCOUNT});
  // A hook logs what the real ones log, including a full wallet signature.
  mockGenerate.mockImplementation(async (...args: unknown[]) => {
    const log = args[args.length - 1] as (m: string) => void;
    log('Step 4: Requesting signature from wallet...');
    log(`Signature received: ${SIGNATURE}`);
    log('[Proof] Generation time: 4123ms');
  });
  mockSignIn.mockResolvedValue({token: JWT});
  quiet = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {})];
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  jest.useRealTimers();
  quiet.forEach(spy => spy.mockRestore());
});

async function mount(circuitId: string, proofRequest?: ProofRequest) {
  mockRoute.params = {circuitId, proofRequest} as ProofStackParamList['ProofGeneration'];
  await act(async () => {tree = create(React.createElement(ProofGenerationScreen));});
  await act(async () => {await jest.advanceTimersByTimeAsync(600);});
}
async function rerender() {
  await act(async () => {tree!.update(React.createElement(ProofGenerationScreen));});
  await act(async () => {await jest.advanceTimersByTimeAsync(10);});
}
async function failStep(id: string, detail: string) {
  mockSteps = [{id, label: id, status: 'error', detail}];
  await rerender();
}
async function succeed() {
  mockParsedProof = {proofHex: '0xproof', publicInputsHex: ['0x01'], numPublicInputs: 1};
  await rerender();
}
/** Every `log` value written to History. */
const storedLogs = () => mockHistoryUpdate.mock.calls.map(call => call[1]).filter(u => 'log' in u).map(u => u.log as string);
const completionParams = () => mockNavigate.navigate.mock.calls.find(call => call[0] === 'ProofComplete')?.[1];
const livePanelShown = () => tree!.root.findAllByType('LiveLogsPanel' as never).length > 0;

describe('Developer Mode and live logs both on', () => {
  it('a failed attempt keeps its log up to the failure, scrubbed', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await failStep('proof', 'prover ran out of memory');
    const [log] = storedLogs();
    expect(mockHistoryUpdate).toHaveBeenCalledWith('record-1', expect.objectContaining({overallStatus: 'failed'}));
    expect(log).toContain(`[Attempt] coinbase_attestation, relay request ${REQUEST_ID} from "Test dApp"`);
    expect(log).toContain('[History] Record created: record-1');
    expect(log).toContain('[Proof] Generation time: 4123ms');
    expect(log).toContain('[Failed] E2001: prover ran out of memory');
    expect(log).toContain('Signature received: [redacted signature, 132 chars]');
    expect(log).not.toContain('abababab');
  });

  it('a cancelled attempt keeps its log too', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await failStep('sign', `${WALLET_REJECTED_PREFIX}: User rejected the request.`);
    expect(storedLogs()[0]).toContain(`[Cancelled] ${WALLET_REJECTED_PREFIX}: User rejected the request.`);
  });

  it('a finished proof hands the same log to History and to the completion screen', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await succeed();
    const [log] = storedLogs();
    expect(mockHistoryUpdate).toHaveBeenCalledWith('record-1', expect.objectContaining({proofHash: '0xproof', log}));
    expect(completionParams()).toMatchObject({historyId: 'record-1', proofLog: log});
    expect(log).toContain('[Proof] Generation time: 4123ms');
  });

  it('with History off, nothing is written but the completion screen still gets the log', async () => {
    mockSettingsGet.mockResolvedValue({...ON, autoSaveProofs: false});
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await succeed();
    expect(mockHistoryAdd).not.toHaveBeenCalled();
    expect(mockHistoryUpdate).not.toHaveBeenCalled();
    expect(completionParams().proofLog).toContain('[Attempt] coinbase_attestation');
  });

  it('the live panel is shown', async () => {
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(livePanelShown()).toBe(true);
  });

  it('an OIDC sign-in logs its claims (nonce, aud, azp), never the token', async () => {
    await mount('oidc_domain_attestation', request('oidc_domain_attestation', {scope: 's', provider: 'google'}));
    await failStep('validate', 'JWT expired');
    const [log] = storedLogs();
    expect(log).toContain(`[OIDC] Sign-in claims: iss="https://accounts.google.com" aud="${AUD}" azp="${AZP}" nonce="${NONCE}"`);
    expect(log).toContain('[Failed] E2008: JWT expired');
    expect(log).not.toContain(JWT.slice(0, 40));
    expect(log).not.toContain('QQQQQQQQ');
  });

  it('a token refused for the wrong nonce (E2012) still logs which nonce and client it carried', async () => {
    const wrong = 'd4'.repeat(32);
    mockSignIn.mockResolvedValue({token: jwtWith(wrong)});
    await mount('oidc_domain_attestation', request('oidc_domain_attestation', {scope: 's', provider: 'google'}));
    const [log] = storedLogs();
    expect(log).toContain(`aud="${AUD}" azp="${AZP}" nonce="${wrong}"`);
    expect(log).toContain(`nonce ${NONCE}`);
    expect(log).toMatch(/\[Failed\] E2012: /);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(log).not.toContain('QQQQQQQQ');
  });
});

describe('either switch off keeps nothing and shows no live panel', () => {
  it.each([
    ['Developer Mode off, live logs left on', {developerMode: false, showLiveLogs: true}],
    ['Developer Mode on, live logs off', {developerMode: true, showLiveLogs: false}],
    ['both off', {developerMode: false, showLiveLogs: false}],
    ['a damaged "true" string', {developerMode: 'true', showLiveLogs: 'true'}],
  ])('%s', async (_name, switches) => {
    mockScreenSettings = {...ON, ...switches};
    mockSettingsGet.mockResolvedValue({...ON, ...switches});
    await mount('coinbase_attestation', request('coinbase_attestation'));
    expect(livePanelShown()).toBe(false);
    await failStep('proof', 'broke');
    expect(mockHistoryUpdate).toHaveBeenCalledWith('record-1', expect.objectContaining({overallStatus: 'failed'}));
    expect(storedLogs()).toEqual([]);
  });

  it.each([['failure'], ['success']])('a %s writes no log field at all', async outcome => {
    mockSettingsGet.mockResolvedValue({...ON, developerMode: false});
    await mount('coinbase_attestation', request('coinbase_attestation'));
    if (outcome === 'success') await succeed();
    else await failStep('proof', 'broke');
    for (const [, updates] of mockHistoryUpdate.mock.calls) expect(updates).not.toHaveProperty('log');
    if (outcome === 'success') expect(completionParams().proofLog).toBeUndefined();
  });

  it('the settings read when the attempt starts decide, not the screen\'s earlier copy', async () => {
    // The screen loaded "on" (panel shown); Developer Mode was turned off before the proof began.
    mockScreenSettings = ON;
    mockSettingsGet.mockResolvedValue({...ON, developerMode: false});
    await mount('coinbase_attestation', request('coinbase_attestation'));
    await succeed();
    expect(storedLogs()).toEqual([]);
    expect(completionParams().proofLog).toBeUndefined();
  });
});
