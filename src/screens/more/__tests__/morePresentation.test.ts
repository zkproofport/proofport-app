import React from 'react';
import {act, create, type ReactTestInstance, type ReactTestRenderer} from 'react-test-renderer';

const mockDisk = new Map<string, string>();
const mockShowError = jest.fn();
const mockAlert = jest.fn();
const mockShare = jest.fn();
const mockNavigate = jest.fn();
const mockSetTheme = jest.fn();
const mockNativeOverride = jest.fn();
let mockOpenStoa = false;
let mockMode = 'dark';
let mockRemoveFailure = false;
let mockWriteFailure = false;
let mockReadFailure = false;
const mockTranslate = (key: string, options: Record<string, unknown> = {}) => {
  const locale = require('i18next').language.split('-')[0];
  const dictionaries = {en: require('../../../i18n/locales/en.json'), ko: require('../../../i18n/locales/ko.json')};
  const value = key.split('.').reduce((entry, part) => entry?.[part], dictionaries[locale as 'en' | 'ko']);
  return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_, name) => String(options[name] ?? '')) : key;
};

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  Pressable: 'Pressable', SafeAreaView: 'SafeAreaView', ActivityIndicator: 'ActivityIndicator',
  Switch: 'Switch', Modal: 'Modal', Image: 'Image',
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
  Alert: {alert: (...args: unknown[]) => mockAlert(...args)},
  Share: {share: (...args: unknown[]) => mockShare(...args), dismissedAction: 'dismissedAction'},
  NativeModules: {AppEnv: {setOpenStoaOverride: (...args: unknown[]) => mockNativeOverride(...args)}},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({bottom: 20})}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (key: string) => {
      if (mockReadFailure && key === '@zkproofport:settings:app') throw new Error('read failed');
      return mockDisk.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockWriteFailure) throw new Error('storage full');
      mockDisk.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      if (mockRemoveFailure) throw new Error('remove failed');
      mockDisk.delete(key);
    }),
  },
}));
jest.mock('../../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('../../../components/ui/atoms/Icon', () => ({Icon: 'Icon'}));
jest.mock('../../../utils/version', () => ({getVersionDisplay: () => '1.3.1'}));
jest.mock('../../../../assets/logo.png', () => 1);
jest.mock('../../../context', () => ({
  useThemeColors: () => ({mode: mockMode, setThemeMode: mockSetTheme, colors: jest.requireActual('../../../theme').darkColors}),
  useError: () => ({showError: mockShowError}),
}));
jest.mock('../../../context/ThemeContext', () => ({useThemeColors: () => ({mode: mockMode})}));
jest.mock('../../../context/ErrorContext', () => ({useError: () => ({showError: mockShowError})}));
jest.mock('@react-navigation/native', () => ({useFocusEffect: () => {}, useNavigation: () => ({navigate: mockNavigate})}));
jest.mock('../../../config', () => Object.defineProperty({
  __esModule: true, ...jest.requireActual('../../../config/networks'),
}, 'OPENSTOA_ENABLED', {get: () => mockOpenStoa}));
jest.mock('../../../stores', () => ({
  ...jest.requireActual('../../../stores/settingsStore'),
  ...jest.requireActual('../../../stores/proofHistoryStore'),
}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: mockTranslate, i18n: require('i18next')})}));

import i18n from 'i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MoreMainScreen from '../MoreMainScreen';
import AboutScreen from '../AboutScreen';
import SettingsLanguageScreen from '../SettingsLanguageScreen';

const HISTORY_KEY = '@zkproofport:proofHistory:items';
const SETTINGS_KEY = '@zkproofport:settings:app';
const WALLET_KEY = '@zkproofport:wallet:test';
let screen: ReactTestRenderer | undefined;
const rootProps = {navigation: {navigate: mockNavigate}, route: {name: 'MoreMain'}} as never;
const history = [{id: 'proof-1', circuitId: 'coinbase_attestation', circuitName: 'KYC', proofHash: '0x123', offChainStatus: 'generated', onChainStatus: 'generated', overallStatus: 'generated', timestamp: '2026-09-23T00:00:00.000Z', network: 'base', walletAddress: '0x456'}];
function textOf(target: ReactTestInstance = screen!.root) {return target.findAllByType('Text' as never).map(child => child.children.filter(value => typeof value === 'string').join('')).join('\n');}
function node(id: string) {return screen!.root.find(item => typeof item.type === 'string' && item.props.testID === id);}
function has(id: string) {return screen!.root.findAllByProps({testID: id}).length > 0;}
async function render(element: React.ReactElement = React.createElement(MoreMainScreen, rootProps)) {await act(async () => {screen = create(element);});}
async function press(id: string) {await act(async () => {await node(id).props.onPress();});}
async function confirm() {await act(async () => {await mockAlert.mock.calls.at(-1)[2].find((button: {style?: string}) => button.style !== 'cancel').onPress();});}
function settings(partial: Record<string, unknown>) {mockDisk.set(SETTINGS_KEY, JSON.stringify(partial));}

beforeEach(async () => {
  jest.clearAllMocks(); mockDisk.clear(); mockOpenStoa = false; mockMode = 'dark'; mockRemoveFailure = false; mockWriteFailure = false; mockReadFailure = false;
  mockShare.mockResolvedValue({action: 'dismissedAction'});
  mockNativeOverride.mockImplementation(() => {});
  mockDisk.set(HISTORY_KEY, JSON.stringify(history));
  mockDisk.set(WALLET_KEY, 'saved-wallet');
  settings({theme: 'light', autoSaveProofs: true, confirmBeforeGenerate: true, developerMode: false, defaultNetwork: 'base'});
  if (!i18n.isInitialized) await i18n.init({lng: 'en', fallbackLng: false, resources: {en: {translation: {}}, ko: {translation: {}}}});
  await i18n.changeLanguage('en');
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (/^(react-test-renderer is deprecated|Failed to clear proof history:|Failed to update settings:)/.test(String(args[0]))) return;
    originalError(...args);
  });
});
afterEach(async () => {if (screen) await act(async () => screen!.unmount()); screen = undefined; jest.useRealTimers(); jest.restoreAllMocks();});

describe('More settings and local data actions', () => {
  it('shows a recoverable settings read error without replacing the saved preferences', async () => {
    mockReadFailure = true; const saved = mockDisk.get(SETTINGS_KEY);
    await render();
    expect(mockShowError).toHaveBeenCalledWith('E5002', mockTranslate('host.more.loadError'));
    expect(has('more-confirm')).toBe(false);
    expect(mockDisk.get(SETTINGS_KEY)).toBe(saved);
    mockReadFailure = false;
    const retry = screen!.root.find(item => typeof item.type === 'string' && item.props.onPress && textOf(item) === mockTranslate('common.retry'));
    await act(async () => {await retry.props.onPress();});
    expect(has('more-confirm')).toBe(true);
    expect(mockDisk.get(SETTINGS_KEY)).toBe(saved);
  });
  it('retains history when the destructive confirmation is cancelled', async () => {
    await render(); await press('more-clear-history');
    const buttons = mockAlert.mock.calls[0][2];
    expect(buttons.find((button: {style?: string}) => button.style === 'cancel')).toBeDefined();
    expect(buttons.find((button: {style?: string}) => button.style === 'destructive')).toBeDefined();
    expect(mockDisk.get(HISTORY_KEY)).toBe(JSON.stringify(history));
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
  it.each(['en', 'ko'])('deletes only history and shows inline success in %s', async locale => {
    await i18n.changeLanguage(locale);
    const beforeSettings = mockDisk.get(SETTINGS_KEY);
    await render(); await press('more-clear-history'); await confirm();
    expect(mockDisk.has(HISTORY_KEY)).toBe(false);
    expect(mockDisk.get(SETTINGS_KEY)).toBe(beforeSettings);
    expect(mockDisk.get(WALLET_KEY)).toBe('saved-wallet');
    expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(HISTORY_KEY);
    expect(textOf(node('more-data-notice'))).toBe(mockTranslate('host.more.clearSuccess'));
    expect(textOf()).not.toContain('host.');
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });
  it('keeps history and exposes a delete failure through ErrorModal', async () => {
    mockRemoveFailure = true;
    await render(); await press('more-clear-history'); await confirm();
    expect(mockDisk.has(HISTORY_KEY)).toBe(true);
    expect(mockShowError).toHaveBeenCalledWith('E5001', expect.stringContaining(mockTranslate('host.more.clearError')));
    expect(has('more-data-notice')).toBe(false);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
  it.each([0, 120])('deletes a history containing %s records without changing settings or wallets', async count => {
    mockDisk.set(HISTORY_KEY, JSON.stringify(Array.from({length: count}, (_, index) => ({...history[0], id: `proof-${index}`}))));
    const beforeSettings = mockDisk.get(SETTINGS_KEY);
    await render(); await press('more-clear-history'); await confirm();
    expect(mockDisk.has(HISTORY_KEY)).toBe(false);
    expect(mockDisk.get(SETTINGS_KEY)).toBe(beforeSettings);
    expect(mockDisk.get(WALLET_KEY)).toBe('saved-wallet');
  });
  it('shares the exact history JSON and treats native cancellation as a normal dismissal', async () => {
    await render(); await press('more-export-history'); await confirm();
    expect(JSON.parse(mockShare.mock.calls[0][0].message)).toEqual(history.map(item => ({...item, source: 'manual'})));
    expect(mockDisk.has(HISTORY_KEY)).toBe(true);
    expect(mockShowError).not.toHaveBeenCalled();
    expect(has('more-data-notice')).toBe(false);
  });
  it('reports export failure without deleting local history', async () => {
    mockShare.mockRejectedValueOnce(new Error('share failed'));
    await render(); await press('more-export-history'); await confirm();
    expect(mockShowError).toHaveBeenCalledWith('E9999', expect.stringContaining(mockTranslate('host.more.exportError')));
    expect(mockDisk.has(HISTORY_KEY)).toBe(true);
  });
  it('persists both proof switches and a network selection independently', async () => {
    await render();
    await act(async () => {await node('more-auto-save').props.onValueChange(false);});
    await act(async () => {await node('more-confirm').props.onValueChange(false);});
    await press('more-network'); await press('more-network-option-other');
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!)).toMatchObject({autoSaveProofs: false, confirmBeforeGenerate: false, defaultNetwork: 'other', theme: 'light'});
  });
  it('reports a rejected settings write without an unhandled rejection', async () => {
    await render(); mockWriteFailure = true;
    await act(async () => {await node('more-confirm').props.onValueChange(false);});
    expect(mockShowError).toHaveBeenCalledWith('E5001', expect.stringContaining(mockTranslate('host.more.saveError')));
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!).confirmBeforeGenerate).toBe(true);
  });
  it('keeps a selected developer network available and hides other developer choices', async () => {
    settings({developerMode: false, defaultNetwork: 'arc'});
    await render(); await press('more-network');
    expect(has('more-network-option-arc')).toBe(true);
    expect(has('more-network-option-giwa')).toBe(false);
    expect(has('more-openstoa')).toBe(false);
    expect(has('more-live-logs')).toBe(false);
  });
  it.each([false, true])('shows the history navigation entry only while OpenStoa owns its tab (%s)', async enabled => {
    mockOpenStoa = enabled; await render();
    expect(has('more-history')).toBe(enabled);
    if (enabled) {await press('more-history'); expect(mockNavigate).toHaveBeenCalledWith('HistoryMain');}
    await press('more-language'); expect(mockNavigate).toHaveBeenCalledWith('SettingsLanguage');
    await press('more-about'); expect(mockNavigate).toHaveBeenCalledWith('About');
  });
  it('keeps theme choice and developer-only native override functional', async () => {
    settings({developerMode: true}); await render();
    await press('more-theme-light'); expect(mockSetTheme).toHaveBeenCalledWith('light');
    await act(async () => {await node('more-openstoa').props.onValueChange(true);});
    expect(mockNativeOverride).toHaveBeenCalledWith(true);
    expect(textOf()).toContain(mockTranslate('host.more.openStoaRestartRequired'));
    expect(has('more-live-logs')).toBe(true);
  });
});

describe('language and About navigation', () => {
  it('changes language immediately even when persistence has not resolved', async () => {
    const setItem = jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise(() => {}));
    await render(React.createElement(SettingsLanguageScreen));
    await press('settings-language-option-ko');
    expect(i18n.language).toBe('ko');
    expect(node('settings-language-option-ko').props.accessibilityState.selected).toBe(true);
    expect(setItem).toHaveBeenCalledWith('proofport.language', 'ko');
  });
  it('reports persistence failure while retaining the selected language for this session', async () => {
    mockWriteFailure = true;
    await render(React.createElement(SettingsLanguageScreen)); await press('settings-language-option-ko');
    expect(i18n.language).toBe('ko');
    expect(mockShowError).toHaveBeenCalledWith('E5001', expect.any(String));
  });
  it('does not persist a language that failed to activate', async () => {
    await render(React.createElement(SettingsLanguageScreen));
    const change = jest.spyOn(i18n, 'changeLanguage').mockRejectedValueOnce(new Error('language failed'));
    await press('settings-language-option-ko');
    expect(mockShowError).toHaveBeenCalledWith('E9999', expect.any(String));
    expect(mockDisk.has('proofport.language')).toBe(false);
    change.mockRestore();
  });
  it('does not write again when the current language is selected', async () => {
    await render(React.createElement(SettingsLanguageScreen)); await press('settings-language-option-en');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it('keeps the seven-tap developer gate and an inline status notice', async () => {
    jest.useFakeTimers(); await render(React.createElement(AboutScreen, {} as never));
    for (let i = 0; i < 6; i++) await press('about-version');
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!).developerMode).toBe(false);
    await press('about-version');
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!).developerMode).toBe(true);
    expect(textOf()).toContain(mockTranslate('host.about.devModeEnabled'));
    expect(mockAlert).not.toHaveBeenCalled();
  });
  it('resets the hidden developer tap sequence after two seconds', async () => {
    jest.useFakeTimers(); await render(React.createElement(AboutScreen, {} as never));
    for (let i = 0; i < 6; i++) await press('about-version');
    await act(async () => {jest.advanceTimersByTime(2001);});
    await press('about-version');
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!).developerMode).toBe(false);
  });
  it('keeps developer mode unchanged and reports a failed seven-tap save', async () => {
    jest.useFakeTimers(); await render(React.createElement(AboutScreen, {} as never)); mockWriteFailure = true;
    for (let i = 0; i < 7; i++) await press('about-version');
    expect(JSON.parse(mockDisk.get(SETTINGS_KEY)!).developerMode).toBe(false);
    expect(mockShowError).toHaveBeenCalledWith('E5001', expect.any(String));
    expect(textOf()).not.toContain(mockTranslate('host.about.devModeEnabled'));
  });
  it('opens the privacy policy and OpenStoa website in the internal browser', async () => {
    await render(React.createElement(AboutScreen, {} as never));
    await press('about-privacy');
    expect(mockNavigate).toHaveBeenCalledWith('InAppBrowser', {url: 'https://github.com/zkproofport/proofport-app/blob/main/docs/legal/privacy-policy.md', title: mockTranslate('host.about.privacyPolicy')});
    await press('about-openstoa');
    expect(mockNavigate).toHaveBeenCalledWith('InAppBrowser', {url: 'https://www.openstoa.xyz', title: 'OpenStoa'});
  });
});
