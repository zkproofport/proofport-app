import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

let mockLocale: 'en' | 'ko' = 'en';
let mockDeveloperMode = true;
let mockAccount: string | null = null;
let mockConnected = false;
const mockStorage = new Map<string, string>();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockShowError = jest.fn();
const mockCopy = jest.fn();

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('@react-native-clipboard/clipboard', () => ({__esModule: true, default: {setString: (...args: unknown[]) => mockCopy(...args)}}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {mockStorage.set(key, value);}),
  },
}));
jest.mock('../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('../../components/ui', () => ({Card: 'Card', Icon: 'Icon', Badge: 'Badge'}));
jest.mock('../../components/ui/atoms/Icon', () => ({Icon: 'Icon'}));
jest.mock('../../context', () => ({
  useThemeColors: () => ({mode: 'dark', colors: jest.requireActual('../../theme').darkColors}),
  useError: () => ({showError: mockShowError}),
}));
jest.mock('../../context/ThemeContext', () => ({
  useThemeColors: () => ({mode: 'dark', colors: jest.requireActual('../../theme').darkColors}),
}));
jest.mock('../../hooks/useWallet', () => ({useWallet: () => ({
  account: mockAccount, isWalletConnected: mockConnected, chainId: 8453,
  connect: mockConnect, disconnect: mockDisconnect,
})}));
jest.mock('../../hooks/useSettings', () => ({useSettings: () => ({settings: {developerMode: mockDeveloperMode}})}));
jest.mock('../../config', () => jest.requireActual('../../config/circuitIds'));
jest.mock('../../stores', () => {
  const real = jest.requireActual('../../stores/circuitWalletStore');
  return {...real, clearCircuitWallet: jest.fn(real.clearCircuitWallet), setCircuitWallet: jest.fn(real.setCircuitWallet)};
});
jest.mock('react-i18next', () => ({useTranslation: () => ({
  t: (key: string, options: Record<string, unknown> = {}) => {
    const dictionaries = {en: require('../../i18n/locales/en.json'), ko: require('../../i18n/locales/ko.json')};
    const value = key.split('.').reduce((node, part) => node?.[part], dictionaries[mockLocale]);
    if (typeof value !== 'string') throw new Error(`Missing ${mockLocale} translation: ${key}`);
    return value.replace(/{{(\w+)}}/g, (_, name) => String(options[name] ?? ''));
  },
})}));

import {CircuitWalletsCard} from '../wallet/CircuitWalletsCard';
import {WalletSessionCard} from '../wallet/WalletSessionCard';
import {WalletConnectedScreen} from '../wallet/WalletConnectedScreen';
import {WalletNoConnectionScreen} from '../wallet/WalletNoConnectionScreen';
import {clearCircuitWallet, getCircuitWalletEntry, setCircuitWallet} from '../../stores';
import {CIRCUIT_WALLET_TTL_MS, walletGroupKey} from '../../stores/circuitWalletStore';
import type {CircuitName} from '../../config/circuitIds';

const ADDRESS = '0xab12cd34ef56ab78cd90ef12ab34cd56ef78ab90';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const PICKED_ADDRESS = '0x2222222222222222222222222222222222222222';
const CLOCK = 2_000_000_000_000;
let screen: ReactTestRenderer | undefined;
let consoleError: jest.SpyInstance;

function words(key: string): string {
  const dictionaries = {en: require('../../i18n/locales/en.json'), ko: require('../../i18n/locales/ko.json')};
  return key.split('.').reduce((value, part) => value?.[part], dictionaries[mockLocale].host.wallet);
}
function textOf(node: ReactTestInstance): string {
  return node.findAllByType('Text' as never)
    .map(child => child.children.filter(value => typeof value === 'string').join('')).join('\n');
}
function findNode(testID: string): ReactTestInstance {
  return screen!.root.findByProps({testID});
}
function hasNode(testID: string): boolean {
  return screen!.root.findAllByProps({testID}).length > 0;
}
async function render(element: React.ReactElement = React.createElement(CircuitWalletsCard)) {
  await act(async () => {screen = create(element);});
}
async function press(testID: string) {
  await act(async () => {await findNode(testID).props.onPress();});
}
async function bind(circuit: CircuitName, address = ADDRESS) {
  await setCircuitWallet(walletGroupKey(circuit), address);
  jest.mocked(setCircuitWallet).mockClear();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(CLOCK);
  jest.clearAllMocks();
  mockStorage.clear();
  mockLocale = 'en';
  mockDeveloperMode = true;
  mockAccount = null;
  mockConnected = false;
  mockDisconnect.mockImplementation(async () => {mockAccount = null; mockConnected = false;});
  mockConnect.mockImplementation(async () => {mockAccount = PICKED_ADDRESS; mockConnected = true;});
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    originalError(...args);
  });
});
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  consoleError.mockRestore();
});

describe('wallet presentation preserves the binding and live-session distinction', () => {
  it('renders one Coinbase group for KYC, Country and Arc, and one separate GIWA group', async () => {
    await render();
    const rows = screen!.root.findAll(item => typeof item.type === 'string' && item.props.testID?.startsWith('wallet-binding-'));
    expect(rows.map(row => row.props.testID).sort()).toEqual(['wallet-binding-coinbase', 'wallet-binding-giwa']);
    const coinbase = textOf(findNode('wallet-binding-coinbase'));
    for (const name of ['Coinbase KYC', 'Coinbase Country', 'Arc Eligibility']) expect(coinbase).toContain(name);
    expect(textOf(screen!.root)).not.toMatch(/OIDC Domain|Korea Mobile ID/);
  });

  it('preserves the existing GIWA developer-mode visibility gate', async () => {
    mockDeveloperMode = false;
    await render();
    expect(hasNode('wallet-binding-coinbase')).toBe(true);
    expect(hasNode('wallet-binding-giwa')).toBe(false);
  });

  it.each([null, OTHER_ADDRESS])('shows a stored wallet as inactive when the live account is %s', async account => {
    await bind('coinbase_attestation');
    mockAccount = account;
    mockConnected = account !== null;
    await render();
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('home.saved'));
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(ADDRESS);
    expect(textOf(findNode('wallet-binding-coinbase'))).not.toContain(words('connected'));
    expect(hasNode('wallet-bind-coinbase')).toBe(true);
    expect(hasNode('wallet-clear-coinbase')).toBe(true);
    expect(hasNode('wallet-disconnect-coinbase')).toBe(false);
  });

  it('recognizes the actual connected account case-insensitively', async () => {
    await bind('coinbase_attestation');
    mockAccount = `0x${ADDRESS.slice(2).toUpperCase()}`;
    mockConnected = true;
    await render();
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('connected'));
    expect(hasNode('wallet-disconnect-coinbase')).toBe(true);
    expect(hasNode('wallet-bind-coinbase')).toBe(false);
  });

  it.each(['missing', 'expired'] as const)('offers connection for a %s binding without claiming it is connected', async kind => {
    if (kind === 'expired') {
      await bind('coinbase_attestation');
      jest.setSystemTime(CLOCK + CIRCUIT_WALLET_TTL_MS);
      mockAccount = ADDRESS;
      mockConnected = true;
    }
    await render();
    expect(hasNode('wallet-bind-coinbase')).toBe(true);
    expect(hasNode('wallet-disconnect-coinbase')).toBe(false);
    expect(textOf(findNode('wallet-binding-coinbase'))).not.toContain(words('connected'));
    expect(textOf(findNode('wallet-bind-coinbase'))).toContain(words('connect'));
  });

  it('connects an unbound group and stores exactly the account returned by the picker', async () => {
    await render();
    await press('wallet-bind-coinbase');
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(setCircuitWallet).toHaveBeenCalledWith(walletGroupKey('coinbase_attestation'), PICKED_ADDRESS);
    expect((await getCircuitWalletEntry(walletGroupKey('coinbase_attestation')))?.address).toBe(PICKED_ADDRESS);
    expect(hasNode('wallet-disconnect-coinbase')).toBe(true);
  });

  it('reconnects an inactive group through the picker after dropping the previous live session', async () => {
    await bind('giwa_attestation');
    mockAccount = OTHER_ADDRESS;
    mockConnected = true;
    await render();
    await press('wallet-bind-giwa');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockDisconnect.mock.invocationCallOrder[0]).toBeLessThan(mockConnect.mock.invocationCallOrder[0]);
    expect(setCircuitWallet).toHaveBeenCalledWith(walletGroupKey('giwa_attestation'), PICKED_ADDRESS);
  });

  it('disconnects the live session while retaining the saved binding', async () => {
    await bind('coinbase_attestation');
    mockAccount = ADDRESS;
    mockConnected = true;
    await render();
    await press('wallet-disconnect-coinbase');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(clearCircuitWallet).not.toHaveBeenCalled();
    expect((await getCircuitWalletEntry(walletGroupKey('coinbase_attestation')))?.address).toBe(ADDRESS);
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('home.saved'));
  });

  it.each([true, false])('clears a binding and disconnects only if that binding owns the live session (%s)', async ownsSession => {
    await bind('coinbase_attestation');
    mockAccount = ownsSession ? ADDRESS : OTHER_ADDRESS;
    mockConnected = true;
    await render();
    await press('wallet-clear-coinbase');
    expect(clearCircuitWallet).toHaveBeenCalledWith(walletGroupKey('coinbase_attestation'));
    expect(await getCircuitWalletEntry(walletGroupKey('coinbase_attestation'))).toBeNull();
    expect(mockDisconnect).toHaveBeenCalledTimes(ownsSession ? 1 : 0);
    if (!ownsSession) expect(mockAccount).toBe(OTHER_ADDRESS);
    expect(hasNode('wallet-bind-coinbase')).toBe(true);
  });

  it('reports failed connection through the error system and permits retry', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Picker refused'));
    await render();
    await press('wallet-bind-coinbase');
    expect(mockShowError).toHaveBeenCalledWith('E4003', 'Picker refused');
    expect(findNode('wallet-bind-coinbase').props.disabled).toBe(false);
    expect(setCircuitWallet).not.toHaveBeenCalled();
    await press('wallet-bind-coinbase');
    expect(setCircuitWallet).toHaveBeenCalledWith(walletGroupKey('coinbase_attestation'), PICKED_ADDRESS);
  });

  it('reports failed disconnection without deleting the saved binding', async () => {
    await bind('coinbase_attestation');
    mockAccount = ADDRESS;
    mockConnected = true;
    mockDisconnect.mockRejectedValueOnce(new Error('Session refused'));
    await render();
    await press('wallet-disconnect-coinbase');
    expect(mockShowError).toHaveBeenCalledWith('E4004', 'Session refused');
    expect(clearCircuitWallet).not.toHaveBeenCalled();
    expect((await getCircuitWalletEntry(walletGroupKey('coinbase_attestation')))?.address).toBe(ADDRESS);
  });
});

describe('wallet session card and screen composition', () => {
  it.each(['en', 'ko'] as const)('copies the full address and invokes disconnect in %s', async language => {
    mockLocale = language;
    const disconnect = jest.fn();
    await render(React.createElement(WalletSessionCard, {
      walletName: 'WalletConnect', address: ADDRESS, network: 'Base', isActive: true, onDisconnect: disconnect,
    }));
    expect(textOf(screen!.root)).toContain('WalletConnect');
    expect(textOf(screen!.root)).toContain('Base');
    expect(textOf(findNode('wallet-disconnect'))).toContain(words('disconnect'));
    await press('wallet-copy-address');
    expect(mockCopy).toHaveBeenCalledWith(ADDRESS);
    expect(textOf(screen!.root)).toContain(words('copied'));
    await press('wallet-disconnect');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(clearCircuitWallet).not.toHaveBeenCalled();
  });

  it.each(['en', 'ko'] as const)('localizes inactive and unbound group actions in %s', async language => {
    mockLocale = language;
    await bind('coinbase_attestation');
    await render();
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('home.saved'));
    expect(textOf(findNode('wallet-bind-coinbase'))).toContain(words('reconnect'));
    expect(textOf(findNode('wallet-clear-coinbase'))).toContain(words('clear'));
    expect(textOf(findNode('wallet-binding-giwa'))).toContain(words('notBound'));
    expect(textOf(screen!.root)).not.toContain('host.wallet.');
  });

  it.each(['en', 'ko'] as const)('explains an expired saved wallet in %s without claiming a live connection', async language => {
    mockLocale = language;
    await bind('coinbase_attestation');
    jest.setSystemTime(CLOCK + CIRCUIT_WALLET_TTL_MS);
    await render();
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('home.expired'));
    expect(textOf(findNode('wallet-binding-coinbase'))).toContain(words('notBound'));
    expect(hasNode('wallet-disconnect-coinbase')).toBe(false);
    expect(textOf(screen!.root)).not.toContain('host.wallet.');
  });

  it('copies the newly displayed account after the wallet changes', async () => {
    const props = {walletName: 'WalletConnect', address: ADDRESS, network: 'Base', isActive: true, onDisconnect: jest.fn()};
    await render(React.createElement(WalletSessionCard, props));
    expect(textOf(screen!.root)).toContain(ADDRESS);
    expect(findNode('wallet-copy-address').props.accessibilityLabel).toContain(ADDRESS);
    await press('wallet-copy-address');
    await act(async () => {screen!.update(React.createElement(WalletSessionCard, {...props, address: OTHER_ADDRESS}));});
    expect(textOf(screen!.root)).toContain(OTHER_ADDRESS);
    expect(textOf(screen!.root)).not.toContain(words('copied'));
    await press('wallet-copy-address');
    expect(mockCopy.mock.calls).toEqual([[ADDRESS], [OTHER_ADDRESS]]);
  });

  it('does not label an inactive session card as currently connected', async () => {
    await render(React.createElement(WalletSessionCard, {
      walletName: 'WalletConnect', address: ADDRESS, network: 'Base', isActive: false, onDisconnect: jest.fn(),
    }));
    expect(textOf(screen!.root)).toContain(words('notConnected'));
    expect(textOf(screen!.root)).not.toContain(words('connected'));
  });

  it('keeps group-specific connection entry points on the no-connection screen', async () => {
    await render(React.createElement(WalletNoConnectionScreen));
    expect(hasNode('wallet-copy-address')).toBe(false);
    expect(hasNode('wallet-disconnect')).toBe(false);
    await press('wallet-bind-coinbase');
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(setCircuitWallet).toHaveBeenCalledWith(walletGroupKey('coinbase_attestation'), PICKED_ADDRESS);
  });

  it('keeps the session actions and group bindings on the connected screen', async () => {
    const disconnect = jest.fn();
    await render(React.createElement(WalletConnectedScreen, {
      walletName: 'WalletConnect', address: ADDRESS, network: 'Base',
      isActive: true, onDisconnect: disconnect,
    }));
    expect(hasNode('wallet-binding-coinbase')).toBe(true);
    await press('wallet-copy-address');
    expect(mockCopy).toHaveBeenCalledWith(ADDRESS);
    await press('wallet-disconnect');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
