import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

let mockLanguage = 'en';
let mockNested = false;
const mockGetAll = jest.fn();
const mockRemove = jest.fn();
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockShowError = jest.fn();
const mockCopy = jest.fn();
const mockAlert = jest.fn();
const mockNavigation = {goBack: mockGoBack, navigate: mockNavigate, canGoBack: () => true};
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', SafeAreaView: 'SafeAreaView',
  Alert: {alert: (...args: unknown[]) => mockAlert(...args)},
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('@react-native-clipboard/clipboard', () => ({__esModule: true, default: {setString: (...args: unknown[]) => mockCopy(...args)}}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: {proofId: 'proof-1'}}),
  useNavigationState: (callback: (state: unknown) => unknown) => callback({index: mockNested ? 1 : 0}),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../stores', () => ({proofHistoryStore: {
  getAll: (...args: unknown[]) => mockGetAll(...args), remove: (...args: unknown[]) => mockRemove(...args),
}}));
jest.mock('../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('../../components/ui', () => ({Card: 'Card', Icon: 'Icon', Badge: 'Badge'}));
jest.mock('../../components/ui/atoms/Icon', () => ({Icon: 'Icon'}));
jest.mock('../../components/ui/atoms/Badge', () => ({Badge: 'Badge'}));
jest.mock('../../utils', () => ({getCircuitDisplayName: () => 'Coinbase KYC', getCircuitIcon: () => 'shield'}));
jest.mock('../../context', () => ({
  useThemeColors: () => ({mode: 'dark', colors: jest.requireActual('../../theme').darkColors}),
  useError: () => ({showError: mockShowError}),
}));
jest.mock('../../context/ThemeContext', () => ({useThemeColors: () => ({mode: 'dark'})}));
jest.mock('react-i18next', () => ({useTranslation: () => ({
  i18n: {language: mockLanguage},
  t: (key: string, options: Record<string, unknown> = {}) => {
    const dictionaries = {en: require('../../i18n/locales/en.json'), ko: require('../../i18n/locales/ko.json')};
    const value = key.split('.').reduce((node, part) => node?.[part], dictionaries[mockLanguage as 'en' | 'ko']);
    return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_, name) => String(options[name] ?? '')) : key;
  },
})}));
import HistoryDetailScreen from '../history/HistoryDetailScreen';
import ProofHistoryScreen from '../history/ProofHistoryScreen';
import type {ProofHistoryItem} from '../../stores/proofHistoryStore';

let screen: ReactTestRenderer | undefined;
let consoleError: jest.SpyInstance;
function textOf(node: ReactTestInstance): string {
  return node.findAllByType('Text' as never).map(child => child.children.filter(value => typeof value === 'string').join('')).join('\n');
}
function node(testID: string): ReactTestInstance {return screen!.root.findByProps({testID});}
function has(testID: string): boolean {return screen!.root.findAllByProps({testID}).length > 0;}
async function render(element: React.ReactElement = React.createElement(HistoryDetailScreen)) {
  await act(async () => {screen = create(element);});
}
async function press(testID: string) {await act(async () => {await node(testID).props.onPress();});}
const ADDRESS = `0x${'a'.repeat(40)}`;
const HASH = `0x${'bc'.repeat(32)}`;
function record(overrides: Partial<ProofHistoryItem> = {}): ProofHistoryItem {
  return {
    id: 'proof-1', circuitId: 'coinbase_attestation', circuitName: 'Old circuit display name',
    proofHash: HASH, walletAddress: ADDRESS, verifierAddress: `0x${'d'.repeat(40)}`,
    network: 'Base', timestamp: '2026-09-23T02:00:00Z',
    overallStatus: 'verified', offChainStatus: 'verified', onChainStatus: 'generated',
    source: 'deeplink', dappName: '요청 앱 <script> %_\\', requestId: `request-${'full'.repeat(30)}`,
    ...overrides,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'en'; mockNested = false;
  mockGetAll.mockResolvedValue([]); mockRemove.mockResolvedValue(undefined);
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    original(...args);
  });
});
afterEach(async () => {
  if (screen) await act(async () => {screen!.unmount();});
  screen = undefined;
  consoleError.mockRestore();
});

it('leaves loading for a missing or deleted record and offers a return to history', async () => {
  await render();
  expect(screen!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(0);
  expect(has('history-record-missing')).toBe(true);
  await press('history-back');
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

function words(key: string): string {
  const dictionary = mockLanguage === 'ko' ? require('../../i18n/locales/ko.json') : require('../../i18n/locales/en.json');
  return key.split('.').reduce((value, part) => value?.[part], dictionary);
}
function confirmation(): {text: string; style?: string; onPress?: () => Promise<void>}[] {
  return mockAlert.mock.calls[mockAlert.mock.calls.length - 1][2];
}

it.each([HistoryDetailScreen, ProofHistoryScreen])('retries a failed storage read without claiming history is empty (%p)', async Component => {
  mockGetAll.mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce([record()]);
  await render(React.createElement(Component));
  expect(mockShowError).toHaveBeenCalledWith('E5002', 'Storage unavailable');
  expect(has('history-load-error')).toBe(true);
  expect(has('history-empty')).toBe(false);
  await press('history-retry');
  expect(mockGetAll).toHaveBeenCalledTimes(2);
  expect(has('history-load-error')).toBe(false);
  expect(textOf(screen!.root)).toContain('요청 앱 <script> %_\\');
});

it('waits for a pending read and ignores its failure after leaving the screen', async () => {
  let reject!: (error: Error) => void;
  mockGetAll.mockReturnValue(new Promise((_, fail) => {reject = fail;}));
  await render();
  expect(screen!.root.findAllByType('ActivityIndicator' as never).length).toBe(1);
  await act(async () => {screen!.unmount();}); screen = undefined;
  await act(async () => {reject(new Error('Late failure'));});
  expect(mockShowError).not.toHaveBeenCalled();
});

it.each(['en', 'ko'])('localizes all seven generation outcomes and orders grouped records in %s', async language => {
  mockLanguage = language;
  const statuses = ['started', 'generating', 'pending', 'generated', 'verified', 'failed', 'verified_failed'] as const;
  mockGetAll.mockResolvedValue(statuses.map((overallStatus, index) => record({
    id: overallStatus, overallStatus, timestamp: `2026-0${index % 2 ? '8' : '9'}-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
  })));
  await render(React.createElement(ProofHistoryScreen));
  for (const status of statuses) {
    expect(textOf(node(`history-record-${status}`))).toContain(words(`host.history.states.${status}`));
  }
  const orderedIds = screen!.root.findAll(item => String(item.type) === 'TouchableOpacity' && String(item.props.testID).startsWith('history-record-')).map(item => item.props.testID);
  expect(orderedIds).toEqual(['history-record-verified_failed', 'history-record-verified', 'history-record-pending', 'history-record-started', 'history-record-failed', 'history-record-generated', 'history-record-generating']);
  const text = textOf(screen!.root);
  expect(text).toContain(language === 'ko' ? '2026년 9월' : 'September 2026');
  expect(text).toContain(language === 'ko' ? '2026년 8월' : 'August 2026');
  expect(text).not.toMatch(/host\.(?:history|proofRequest)\./);
  expect(text).not.toContain(HASH);
  expect(has('history-delete')).toBe(false);
  await press('history-record-verified');
  expect(mockNavigate).toHaveBeenCalledWith('HistoryDetail', {proofId: 'verified'});
});

it('has a useful empty state and avoids a second brand/header when reached from More', async () => {
  mockNested = true;
  await render(React.createElement(ProofHistoryScreen));
  expect(has('history-empty')).toBe(true);
  expect(textOf(screen!.root)).toContain(words('host.history.home.emptyText'));
  expect(textOf(screen!.root)).not.toContain(words('host.proof.home.brand'));
  expect(screen!.root.findByType('SafeAreaView' as never).props.edges).toEqual(['left', 'right']);
});

it('keeps a single record readable and labels invalid legacy dates', async () => {
  mockGetAll.mockResolvedValue([record({timestamp: 'invalid-date', dappName: undefined, source: 'manual'})]);
  await render(React.createElement(ProofHistoryScreen));
  expect(textOf(node('history-record-proof-1'))).toContain('Date unavailable');
  expect(textOf(screen!.root)).toContain(words('host.history.home.manual'));
  expect(textOf(screen!.root)).not.toContain('Invalid Date');
});

it.each([
  {circuitId: '__proto__'},
  {overallStatus: 'unknown'},
  {offChainStatus: 'unknown'},
  {onChainStatus: 'unknown'},
])('reports an unsupported saved identifier instead of inventing a result (%p)', async patch => {
  mockGetAll.mockResolvedValue([record(patch as Partial<ProofHistoryItem>)]);
  await render();
  expect(has('history-load-error')).toBe(true);
  expect(mockShowError).toHaveBeenCalledWith('E5002', expect.stringMatching(/Unknown .*(__proto__|unknown)/));
});

it.each(['en', 'ko'])('preserves distinct verification outcomes and full copyable technical values in %s', async language => {
  mockLanguage = language;
  const item = record(); mockGetAll.mockResolvedValue([item]);
  await render();
  expect(textOf(node('history-offchain'))).toContain(words('host.history.states.verified'));
  expect(textOf(node('history-onchain'))).toContain(words('host.history.detail.verificationGenerated'));
  expect(textOf(screen!.root)).not.toContain(HASH);
  expect(has('history-technical-details')).toBe(false);
  expect(screen!.root.findByType('SafeAreaView' as never).props.edges).toEqual(['left', 'right', 'bottom']);
  await press('history-technical-toggle');
  for (const value of [ADDRESS, HASH, item.verifierAddress!, item.requestId!]) expect(textOf(node('history-technical-details'))).toContain(value);
  for (const id of ['wallet', 'verifier', 'proof-hash', 'request-id']) await press(`history-copy-${id}`);
  expect(mockCopy.mock.calls).toEqual([[ADDRESS], [item.verifierAddress], [HASH], [item.requestId]]);
  expect(textOf(screen!.root)).toContain(words('host.history.detail.copied'));
  await press('history-technical-toggle');
  expect(has('history-technical-details')).toBe(false);
});

it('does not offer copy actions for missing hashes or empty wallet addresses', async () => {
  mockGetAll.mockResolvedValue([record({proofHash: '', walletAddress: '', verifierAddress: undefined, requestId: undefined})]);
  await render(); await press('history-technical-toggle');
  expect(textOf(node('history-technical-details'))).toContain(words('host.history.detail.notRecorded'));
  for (const id of ['wallet', 'verifier', 'proof-hash', 'request-id']) expect(has(`history-copy-${id}`)).toBe(false);
});

it.each([undefined, null, {version: 2, inputs: {}}, {version: 1, inputs: []}, {version: 1, inputs: null}])(
  'truthfully labels unavailable review data without fabricated conditions (%p)', async review => {
    mockGetAll.mockResolvedValue([record({review: review as ProofHistoryItem['review']})]);
    await render();
    expect(textOf(node('history-conditions'))).toContain(words('host.history.detail.notSaved'));
    expect(has('request-action')).toBe(false);
    expect(textOf(node('history-conditions'))).not.toContain(words('host.proofRequest.presentation.kyc.requirement'));
  },
);

it('shows saved country conditions including false and keeps raw technical inputs out of review', async () => {
  mockGetAll.mockResolvedValue([record({circuitId: 'coinbase_country_attestation', review: {version: 1, inputs: {countryList: ['KR', 'JP'], isIncluded: false}}})]);
  await render();
  const text = textOf(node('history-conditions'));
  expect(text).toContain('KR · JP');
  expect(text).toContain(words('host.proofRequest.presentation.values.countryExcluded'));
  expect(text).toContain(words('host.history.detail.noAction'));
  expect(text).not.toContain('"countryList"');
});

it('opens the same action review with nested values and Back returns to the record', async () => {
  const message = {recipient: ADDRESS, enabled: false, amount: 0, note: '한국어 "quoted" <script>\nline', optional: null, list: ['first', 'second']};
  mockGetAll.mockResolvedValue([record({review: {version: 1, inputs: {}, action: {
    primaryType: 'Transfer', message, domain: {name: 'Long domain'}, types: {Transfer: [{name: 'recipient', type: 'address'}]},
  }}})]);
  await render();
  expect(has('action-review-details')).toBe(false);
  await press('request-action');
  expect(has('action-review-details')).toBe(true);
  const text = textOf(node('action-review-details'));
  for (const value of [ADDRESS, 'false', '0', '한국어 "quoted" <script>⟦U+000A⟧line', 'first', 'second']) expect(text).toContain(value);
  expect(text).toContain(words('host.proofRequest.review.values.null'));
  expect(text).not.toContain(JSON.stringify(message));
  await press('action-review-back');
  expect(has('action-review-details')).toBe(false);
  expect(has('history-requester')).toBe(true);
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('makes deletion explicit, keeps cancel harmless, and returns only after storage succeeds', async () => {
  mockGetAll.mockResolvedValue([record()]); await render();
  await press('history-delete');
  expect(mockAlert).toHaveBeenCalledWith(words('host.history.detail.deleteRecordTitle'), words('host.history.detail.deleteRecordMessage'), expect.any(Array));
  const cancel = confirmation().find(button => button.style === 'cancel');
  await act(async () => {await cancel?.onPress?.();});
  expect(mockRemove).not.toHaveBeenCalled(); expect(mockGoBack).not.toHaveBeenCalled();
  await press('history-delete');
  await act(async () => {await confirmation().find(button => button.style === 'destructive')!.onPress!();});
  expect(mockRemove).toHaveBeenCalledWith('proof-1'); expect(mockGoBack).toHaveBeenCalledTimes(1);
});

it('keeps a failed deletion on screen with a retry and avoids duplicate writes while pending', async () => {
  mockGetAll.mockResolvedValue([record()]); mockRemove.mockRejectedValueOnce(new Error('Write failed'));
  await render(); await press('history-delete');
  await act(async () => {await confirmation().find(button => button.style === 'destructive')!.onPress!();});
  expect(mockShowError).toHaveBeenCalledWith('E5001', 'Write failed');
  expect(has('history-delete-error')).toBe(true); expect(mockGoBack).not.toHaveBeenCalled();
  expect(node('history-delete').props.disabled).toBe(false);
  let finish!: () => void;
  mockRemove.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  await press('history-delete');
  const remove = confirmation().find(button => button.style === 'destructive')!.onPress!;
  let pending!: Promise<void>;
  await act(async () => {pending = remove();});
  expect(node('history-delete').props.disabled).toBe(true);
  await act(async () => {await remove();});
  expect(mockRemove).toHaveBeenCalledTimes(2);
  await act(async () => {finish(); await pending;});
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

it('labels a failed verification as verification failure, separately from proof generation', async () => {
  mockGetAll.mockResolvedValue([record({overallStatus: 'verified_failed', offChainStatus: 'failed', onChainStatus: 'pending'})]);
  await render();
  expect(textOf(node('history-offchain'))).toContain(words('host.history.states.verified_failed'));
  expect(textOf(node('history-offchain'))).not.toContain(words('host.history.states.failed'));
  expect(textOf(node('history-onchain'))).toContain(words('host.history.detail.verificationPending'));
});

it('does not navigate again if deletion finishes after leaving the record', async () => {
  let finish!: () => void;
  mockGetAll.mockResolvedValue([record()]);
  mockRemove.mockReturnValue(new Promise<void>(resolve => {finish = resolve;}));
  await render(); await press('history-delete');
  let pending!: Promise<void>;
  await act(async () => {pending = confirmation().find(button => button.style === 'destructive')!.onPress!();});
  await act(async () => {screen!.unmount();}); screen = undefined;
  await act(async () => {finish(); await pending;});
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('does not claim verification was attempted when proof generation itself failed', async () => {
  mockGetAll.mockResolvedValue([record({overallStatus: 'failed', offChainStatus: 'failed', onChainStatus: 'failed', proofHash: ''})]);
  await render();
  expect(textOf(screen!.root)).toContain(words('host.history.states.failed'));
  for (const channel of ['offchain', 'onchain']) {
    expect(textOf(node(`history-${channel}`))).toContain(words('host.history.detail.verificationPending'));
    expect(textOf(node(`history-${channel}`))).not.toContain(words('host.history.states.verified_failed'));
  }
});

it('retains an actual verification failure even if a legacy record has no saved proof hash', async () => {
  mockGetAll.mockResolvedValue([record({overallStatus: 'verified_failed', offChainStatus: 'failed', onChainStatus: 'generated', proofHash: ''})]);
  await render();
  expect(textOf(node('history-offchain'))).toContain(words('host.history.states.verified_failed'));
});

it('shows saved scope fields only in technical details and copies their full original strings', async () => {
  const scope = `0x${'ab'.repeat(64)}`;
  const scopeString = '한국어 scope\nwith "quotes" %_';
  mockGetAll.mockResolvedValue([record({review: {version: 1, inputs: {scope, scopeString}}})]);
  await render();
  expect(textOf(screen!.root)).not.toContain(scope);
  await press('history-technical-toggle');
  expect(textOf(node('history-technical-details'))).toContain(scope);
  expect(textOf(node('history-technical-details'))).toContain('한국어 scope⟦U+000A⟧with "quotes" %_');
  await press('history-copy-scope'); await press('history-copy-scope-string');
  expect(mockCopy.mock.calls).toEqual([[scope], [scopeString]]);
});

it.each(['', null, false, 0])('preserves an explicitly stored scope scalar %p', async scope => {
  mockGetAll.mockResolvedValue([record({review: {version: 1, inputs: {scope}}})]);
  await render(); await press('history-technical-toggle');
  expect(has('history-copy-scope')).toBe(true);
  expect(has('history-copy-scope-string')).toBe(false);
  await press('history-copy-scope');
  expect(mockCopy).toHaveBeenCalledWith(typeof scope === 'string' ? scope : String(scope));
});

it('does not infer a scope when the record did not save one', async () => {
  mockGetAll.mockResolvedValue([record({review: {version: 1, inputs: {}}})]);
  await render(); await press('history-technical-toggle');
  expect(has('history-copy-scope')).toBe(false);
  expect(has('history-copy-scope-string')).toBe(false);
});
