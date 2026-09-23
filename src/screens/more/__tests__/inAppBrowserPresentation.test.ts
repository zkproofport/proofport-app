import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const mockShowError = jest.fn();
const mockShare = jest.fn();
const mockBack = jest.fn();
const mockForward = jest.fn();
const mockReload = jest.fn();
let mockLocale: 'en' | 'ko' = 'en';
let mockPlatform = 'ios';
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1, absoluteFillObject: {position: 'absolute'}},
  Platform: {get OS() {return mockPlatform;}}, Share: {share: (...args: unknown[]) => mockShare(...args)},
  Animated: {Value: class {setValue() {}}, View: 'AnimatedView', timing: () => ({start: () => {}})},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('react-native-webview', () => ({
  WebView: require('react').forwardRef((props: Record<string, unknown>, ref: unknown) => {
    require('react').useImperativeHandle(ref, () => ({goBack: mockBack, goForward: mockForward, reload: mockReload}));
    return require('react').createElement('WebView', props);
  }),
}));
jest.mock('@react-navigation/native', () => ({useRoute: () => ({params: {url: 'https://www.zkproofport.com'}})}));
jest.mock('../../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('../../../context', () => ({useError: () => ({showError: mockShowError}), useThemeColors: () => ({colors: jest.requireActual('../../../theme').darkColors})}));
jest.mock('../../../context/ThemeContext', () => ({useThemeColors: () => ({mode: 'dark'})}));
jest.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => {
  const dictionaries = {en: require('../../../i18n/locales/en.json'), ko: require('../../../i18n/locales/ko.json')};
  return key.split('.').reduce((node, part) => node?.[part], dictionaries[mockLocale]) ?? key;
}})}));
import {InAppBrowserScreen} from '../../shared/InAppBrowserScreen';
let screen: ReactTestRenderer | undefined;
let consoleError: jest.SpyInstance;
const node = (testID: string) => screen!.root.find(item => typeof item.type === 'string' && item.props.testID === testID);
const web = () => screen!.root.findByType('WebView' as never);
const has = (testID: string) => screen!.root.findAllByProps({testID}).length > 0;
async function render() {await act(async () => {screen = create(React.createElement(InAppBrowserScreen));});}
async function press(testID: string) {await act(async () => {await node(testID).props.onPress();});}
beforeEach(() => {
  jest.clearAllMocks(); mockLocale = 'en'; mockPlatform = 'ios'; mockShare.mockResolvedValue({action: 'dismissedAction'});
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    originalError(...args);
  });
});
afterEach(async () => {if (screen) await act(async () => screen!.unmount()); screen = undefined; consoleError.mockRestore();});

it('shows a retry state after a page load error and reloads the retained WebView', async () => {
  await render();
  await act(async () => {web().props.onError({nativeEvent: {description: 'Offline', url: 'https://www.zkproofport.com'}});});
  expect(has('browser-error')).toBe(true);
  expect(mockShowError).toHaveBeenCalledWith('E3001', expect.any(String));
  await press('browser-retry');
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(has('browser-error')).toBe(false);
});
it('reports a main-page HTTP error once and ignores a failed subresource', async () => {
  await render();
  await act(async () => {web().props.onHttpError({nativeEvent: {statusCode: 404, url: 'https://www.zkproofport.com/missing-image.png'}});});
  expect(mockShowError).not.toHaveBeenCalled();
  await act(async () => {web().props.onHttpError({nativeEvent: {statusCode: 503, url: 'https://www.zkproofport.com'}});});
  await act(async () => {web().props.onError({nativeEvent: {description: 'Failed'}});});
  expect(mockShowError).toHaveBeenCalledTimes(1);
  expect(mockShowError).toHaveBeenCalledWith('E3002', expect.any(String));
  expect(has('browser-error')).toBe(true);
});
it.each(['en', 'ko'] as const)('labels toolbar actions and reflects actual navigation availability in %s', async locale => {
  mockLocale = locale; await render();
  expect(node('browser-back').props.disabled).toBe(true);
  expect(node('browser-forward').props.accessibilityState.disabled).toBe(true);
  for (const name of ['back', 'forward', 'reload', 'share']) {
    expect(node(`browser-${name}`).props.accessibilityLabel).toMatch(/\S/);
    expect(node(`browser-${name}`).props.accessibilityLabel).not.toContain('host.browser');
  }
  await act(async () => {web().props.onNavigationStateChange({canGoBack: true, canGoForward: true, url: 'https://www.zkproofport.com/privacy'});});
  await press('browser-back'); await press('browser-forward'); await press('browser-reload');
  expect(mockBack).toHaveBeenCalledTimes(1); expect(mockForward).toHaveBeenCalledTimes(1); expect(mockReload).toHaveBeenCalledTimes(1);
});
it.each(['ios', 'android'])('shares the currently browsed URL on %s and ignores dismissal', async platform => {
  mockPlatform = platform; await render();
  await act(async () => {web().props.onNavigationStateChange({canGoBack: true, canGoForward: false, url: 'https://www.masselabs.com/team'});});
  await press('browser-share');
  expect(mockShare).toHaveBeenCalledWith(platform === 'ios' ? {url: 'https://www.masselabs.com/team'} : {message: 'https://www.masselabs.com/team'});
  expect(mockShowError).not.toHaveBeenCalled();
});
it('reports a real share failure through the common error system', async () => {
  mockShare.mockRejectedValueOnce(new Error('Native share failed')); await render(); await press('browser-share');
  expect(mockShowError).toHaveBeenCalledWith('E9999', expect.any(String));
});
