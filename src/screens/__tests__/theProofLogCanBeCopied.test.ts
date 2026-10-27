/**
 * "Copy log" on the completion screen and in History.
 *
 * MATRIX rows held here:
 *   present/absent -> the completion screen offers it only when the attempt
 *                     kept a log (a string `proofLog` param); History only
 *                     while Developer Mode is on AND the record holds a
 *                     readable log
 *   old records    -> no `log`, empty, whitespace, non-string: no card, the
 *                     rest of the record still renders
 *   verification   -> off/on-chain lines (including a thrown error) are added
 *                     to the record's log, scrubbed; nothing is added when
 *                     the attempt kept no log
 *   copy           -> copies the scrubbed text; confirmation is inline, never
 *                     an Alert or an ErrorModal; a clipboard failure IS an
 *                     ErrorModal (E5001) and shows no confirmation
 *   hostile/large  -> a stored raw token is copied scrubbed; a 1 MB stored
 *                     log is shown and copied capped
 *   UTF-8          -> Korean and emoji are copied as stored
 *   storage down   -> settings that cannot be read hide the card, not the record
 */
import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

const mockCopy = jest.fn();
const mockAlert = jest.fn();
const mockShowError = jest.fn();
const mockUpdate = jest.fn();
const mockGetAll = jest.fn();
const mockSettingsGet = jest.fn();
const mockOffChain = jest.fn();
const mockOnChain = jest.fn();
let mockParams: Record<string, unknown> = {};
const mockNavigation = {navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
const mockProofHook = () => ({verifyProofOffChain: mockOffChain, verifyProofOnChain: mockOnChain, resetProofCache: jest.fn()});

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', Modal: 'Modal',
  TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', Platform: {OS: 'ios'},
  StyleSheet: {create: (styles: unknown) => styles, hairlineWidth: 1}, Alert: {alert: (...a: unknown[]) => mockAlert(...a)},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('@react-native-clipboard/clipboard', () => ({__esModule: true, default: {setString: (...a: unknown[]) => mockCopy(...a)}}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: mockParams}),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
const mockT = (key: string) => key;
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockT, i18n: {language: 'en'}})}));
jest.mock('../../components/ui', () => ({Icon: 'Icon', Badge: 'Badge', Button: 'Button', Card: 'Card'}));
jest.mock('../../components/ui/atoms/Icon', () => ({Icon: 'Icon'}));
jest.mock('../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('../../context', () => ({
  useThemeColors: () => ({mode: 'dark', colors: jest.requireActual('../../theme').darkColors}),
  useError: () => ({showError: mockShowError}),
}));
jest.mock('../../context/ThemeContext', () => ({useThemeColors: () => ({mode: 'dark'})}));
jest.mock('../../hooks', () => ({
  useCoinbaseKyc: () => mockProofHook(), useCoinbaseCountry: () => mockProofHook(),
  useOidcDomain: () => mockProofHook(), useGiwaKyc: () => mockProofHook(), useDojangPlayground: () => mockProofHook(),
  useLogs: jest.requireActual('../../hooks/useLogs').useLogs,
}));
jest.mock('../../hooks/useMdlKr', () => ({useMdlKr: () => mockProofHook()}));
jest.mock('../../stores', () => ({
  proofHistoryStore: {update: (...a: unknown[]) => mockUpdate(...a), getAll: (...a: unknown[]) => mockGetAll(...a), remove: jest.fn()},
  settingsStore: {get: () => mockSettingsGet()},
}));
jest.mock('../../config', () => ({...jest.requireActual('../../config/circuitIds')}));
jest.mock('../../utils', () => ({getCircuitDisplayName: () => 'Coinbase KYC', getTimestamp: () => '12:00:00'}));

import {ProofCompleteScreen} from '../proof/ProofCompleteScreen';
import HistoryDetailScreen from '../history/HistoryDetailScreen';
import {PROOF_LOG_LIMITS} from '../../utils/proofLog';
import {LiveLogsPanel} from '../../components/ui/organisms/LiveLogsPanel';

const JWT = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"nonce":"n1"}').toString('base64url')}.${'Z'.repeat(200)}`;
const SIGNATURE = `0x${'cd'.repeat(65)}`;
const GENERATION_LOG = '[12:00:00] [Attempt] coinbase_attestation, in-app\n[12:00:01] [Proof] Generation time: 4123ms';

let screen: ReactTestRenderer | undefined;
let quiet: jest.SpyInstance[];
const has = (testID: string) => screen!.root.findAllByProps({testID}).length > 0;
const node = (testID: string): ReactTestInstance => screen!.root.findByProps({testID});
const textOf = (n: ReactTestInstance) =>
  n.findAllByType('Text' as never).map(c => c.children.filter(v => typeof v === 'string').join('')).join('\n');
async function render(element: React.ReactElement) {
  await act(async () => {screen = create(element);});
}
async function press(testID: string) {
  await act(async () => {await node(testID).props.onPress();});
}
function verifyButton(index: number) {
  return screen!.root.findAll(n => String(n.type) === 'TouchableOpacity' &&
    n.findAllByType('Text' as never).some(t => t.children.includes('host.proof.complete.verifyButton')))[index];
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  mockParams = {
    circuitId: 'coinbase_attestation', proofHex: '0x1234', timestamp: '1750000000000', historyId: 'record-1',
    verification: {offChain: null, onChain: null, verifierContract: '0x2', chainName: 'Base', explorerUrl: ''},
    proofLog: GENERATION_LOG,
  };
  mockUpdate.mockResolvedValue(undefined);
  mockOffChain.mockImplementation(async (log: (m: string) => void) => {
    log(`[OffChain] signature: ${SIGNATURE}`);
    log('[OffChain] Proof is VALID');
    return true;
  });
  mockOnChain.mockImplementation(async (_c: string, log: (m: string) => void) => {
    log('[OnChain] eth_call to 0x2 -> true');
    return true;
  });
  quiet = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {})];
});
afterEach(async () => {
  if (screen) await act(async () => {screen!.unmount();});
  screen = undefined;
  jest.useRealTimers();
  quiet.forEach(spy => spy.mockRestore());
});

describe('the completion screen', () => {
  it('offers "Copy log" and copies the generation log', async () => {
    await render(React.createElement(ProofCompleteScreen));
    expect(has('proof-complete-copy-log')).toBe(true);
    expect(has('proof-complete-log-copied')).toBe(false);
    await press('proof-complete-copy-log');
    expect(mockCopy).toHaveBeenCalledWith(GENERATION_LOG);
    expect(has('proof-complete-log-copied')).toBe(true);
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('the confirmation goes away by itself', async () => {
    jest.useFakeTimers();
    await render(React.createElement(ProofCompleteScreen));
    await press('proof-complete-copy-log');
    await act(async () => {jest.advanceTimersByTime(2100);});
    expect(has('proof-complete-log-copied')).toBe(false);
  });

  it('verification lines are added to the record\'s log and to the copy, scrubbed', async () => {
    await render(React.createElement(ProofCompleteScreen));
    await act(async () => {await verifyButton(0).props.onPress();});
    await act(async () => {await verifyButton(0).props.onPress();});
    const logs = mockUpdate.mock.calls.map(call => call[1].log as string);
    expect(logs).toHaveLength(2);
    expect(logs[0].startsWith(GENERATION_LOG)).toBe(true);
    expect(logs[0]).toContain('[OffChain] signature: [redacted signature, 132 chars]');
    expect(logs[0]).toContain('[Verify] Off-chain: verified');
    expect(logs[1]).toContain('[Verify] On-chain: verified');
    expect(logs.join()).not.toContain('cdcdcdcd');
    await press('proof-complete-copy-log');
    expect(mockCopy).toHaveBeenLastCalledWith(logs[1]);
  });

  it('a verification that throws is logged with its message', async () => {
    mockOffChain.mockRejectedValue(new Error('RPC unreachable'));
    await render(React.createElement(ProofCompleteScreen));
    await act(async () => {await verifyButton(0).props.onPress();});
    expect(mockUpdate).toHaveBeenCalledWith('record-1', expect.objectContaining({
      offChainStatus: 'failed', log: expect.stringContaining('[Verify] Off-chain threw: RPC unreachable'),
    }));
  });

  it.each([
    ['no log (logs were off)', undefined],
    ['a damaged non-string log', 12345],
    ['a damaged object log', {text: 'x'}],
  ])('%s: no "Copy log", and verification writes no log', async (_name, proofLog) => {
    mockParams.proofLog = proofLog;
    await render(React.createElement(ProofCompleteScreen));
    expect(has('proof-complete-copy-log')).toBe(false);
    await act(async () => {await verifyButton(0).props.onPress();});
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('log');
  });

  it('without a History record the log can still be copied, and nothing is written', async () => {
    mockParams.historyId = undefined;
    await render(React.createElement(ProofCompleteScreen));
    await act(async () => {await verifyButton(0).props.onPress();});
    await press('proof-complete-copy-log');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCopy.mock.calls[0][0]).toContain('[Verify] Off-chain: verified');
  });

  it('a clipboard failure is an ErrorModal, with no confirmation', async () => {
    mockCopy.mockImplementationOnce(() => {throw new Error('pasteboard locked');});
    await render(React.createElement(ProofCompleteScreen));
    await press('proof-complete-copy-log');
    expect(mockShowError).toHaveBeenCalledWith('E5001', 'pasteboard locked');
    expect(has('proof-complete-log-copied')).toBe(false);
  });
});

describe('History detail', () => {
  const record = (patch: Record<string, unknown> = {}) => ({
    id: 'proof-1', circuitId: 'coinbase_attestation', circuitName: 'x', proofHash: '0x12', walletAddress: '0xab',
    network: 'Base', timestamp: '2026-10-27T02:00:00Z', overallStatus: 'failed', offChainStatus: 'failed',
    onChainStatus: 'failed', source: 'manual', ...patch,
  });
  beforeEach(() => {
    mockParams = {proofId: 'proof-1'};
    mockSettingsGet.mockResolvedValue({developerMode: true, showLiveLogs: true});
  });

  it('shows the kept log with "Copy log" while Developer Mode is on', async () => {
    mockGetAll.mockResolvedValue([record({log: '[Attempt] x\n[Failed] E2001: 증명 실패 🙂'})]);
    await render(React.createElement(HistoryDetailScreen));
    expect(textOf(node('history-log-text'))).toBe('[Attempt] x\n[Failed] E2001: 증명 실패 🙂');
    await press('history-copy-log');
    expect(mockCopy).toHaveBeenCalledWith('[Attempt] x\n[Failed] E2001: 증명 실패 🙂');
    expect(textOf(node('history-log'))).toContain('host.history.detail.logCopied');
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('still shows it with live logs turned off since', async () => {
    mockSettingsGet.mockResolvedValue({developerMode: true, showLiveLogs: false});
    mockGetAll.mockResolvedValue([record({log: 'kept'})]);
    await render(React.createElement(HistoryDetailScreen));
    expect(has('history-log')).toBe(true);
  });

  it.each([
    ['Developer Mode off', {developerMode: false, showLiveLogs: true}],
    ['a damaged "true"', {developerMode: 'true', showLiveLogs: true}],
  ])('%s hides a kept log (it is not deleted)', async (_name, settings) => {
    mockSettingsGet.mockResolvedValue(settings);
    mockGetAll.mockResolvedValue([record({log: 'kept'})]);
    await render(React.createElement(HistoryDetailScreen));
    expect(has('history-log')).toBe(false);
    expect(has('history-requester')).toBe(true);
  });

  it('settings that cannot be read hide the card, not the record', async () => {
    mockSettingsGet.mockRejectedValue(new Error('storage down'));
    mockGetAll.mockResolvedValue([record({log: 'kept'})]);
    await render(React.createElement(HistoryDetailScreen));
    expect(has('history-log')).toBe(false);
    expect(has('history-requester')).toBe(true);
  });

  it.each([
    ['an older record without a log', {}],
    ['an empty log', {log: ''}],
    ['a whitespace log', {log: '   \n'}],
    ['a number', {log: 7}],
    ['an array', {log: ['a', 'b']}],
    ['null', {log: null}],
  ])('%s shows no card and the record renders', async (_name, patch) => {
    mockGetAll.mockResolvedValue([record(patch)]);
    await render(React.createElement(HistoryDetailScreen));
    expect(has('history-log')).toBe(false);
    expect(has('history-requester')).toBe(true);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('a raw token stored by an older build is shown and copied scrubbed', async () => {
    mockGetAll.mockResolvedValue([record({log: `token=${JWT}`})]);
    await render(React.createElement(HistoryDetailScreen));
    await press('history-copy-log');
    expect(mockCopy).toHaveBeenCalledWith(`token=[redacted jwt, ${JWT.length} chars]`);
    expect(textOf(node('history-log-text'))).not.toContain('ZZZZZZZZ');
  });

  it('a 1 MB stored log is shown and copied capped', async () => {
    mockGetAll.mockResolvedValue([record({log: 'L'.repeat(1_000_000)})]);
    await render(React.createElement(HistoryDetailScreen));
    await press('history-copy-log');
    expect((mockCopy.mock.calls[0][0] as string).length).toBeLessThanOrEqual(PROOF_LOG_LIMITS.perRecordChars);
    expect(textOf(node('history-log-text')).length).toBeLessThanOrEqual(PROOF_LOG_LIMITS.perRecordChars);
  });

  it('a clipboard failure is an ErrorModal', async () => {
    mockCopy.mockImplementationOnce(() => {throw new Error('pasteboard locked');});
    mockGetAll.mockResolvedValue([record({log: 'kept'})]);
    await render(React.createElement(HistoryDetailScreen));
    await press('history-copy-log');
    expect(mockShowError).toHaveBeenCalledWith('E5001', 'pasteboard locked');
    expect(textOf(node('history-log'))).not.toContain('host.history.detail.logCopied');
  });
});

describe('the live panel', () => {
  it('copies the live log scrubbed, as the kept log is', async () => {
    await render(React.createElement(LiveLogsPanel, {logs: [
      '[12:00:00] [OIDC] Sign-in claims: nonce="abc"',
      `[12:00:01] token=${JWT}`,
      `[12:00:02] Signature received: ${SIGNATURE}`,
    ]}));
    await act(async () => {screen!.root.findByType('TouchableOpacity' as never).props.onPress();});
    expect(mockCopy).toHaveBeenCalledWith(
      `[OIDC] Sign-in claims: nonce="abc"\ntoken=[redacted jwt, ${JWT.length} chars]\nSignature received: [redacted signature, 132 chars]`,
    );
  });
});
