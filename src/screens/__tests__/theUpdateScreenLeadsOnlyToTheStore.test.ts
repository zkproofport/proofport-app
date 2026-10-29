/**
 * The update-required screen, and what App.tsx does while it is up.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

const mockOpenURL = jest.fn();
const mockShowError = jest.fn();
let mockLanguage = 'ko';

jest.mock('react-native', () => ({
  Image: 'Image',
  SafeAreaView: 'SafeAreaView',
  Text: 'Text',
  View: 'View',
  StyleSheet: {create: (s: unknown) => s},
  Linking: {openURL: (url: string) => mockOpenURL(url)},
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
    i18n: {language: mockLanguage},
  }),
}));
jest.mock('../../components/ui', () => ({Button: 'Button'}));
jest.mock('../../context', () => ({
  useError: () => ({showError: mockShowError}),
  useThemeColors: () => ({colors: {background: {primary: '#000'}, text: {primary: '#fff', secondary: '#aaa', tertiary: '#888'}}}),
}));
jest.mock('../../constants/brand', () => ({BRAND_SYMBOL: 1}));
jest.mock('../../utils/version', () => ({getVersion: () => '1.4.0'}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {UpdateRequiredScreen} = require('../UpdateRequiredScreen') as typeof import('../UpdateRequiredScreen');

const RULE = {
  platform: 'ios' as const,
  minimum: '1.5.0',
  storeUrl: 'https://apps.apple.com/app/id6803903114',
  message: {ko: '새 버전으로 업데이트해 주세요 🙏'},
};

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAll(n => (n.type as unknown) === 'Text').map(n => String(n.props.children));
}

beforeEach(() => {
  mockOpenURL.mockReset();
  mockShowError.mockReset();
  mockLanguage = 'ko';
});

describe('the update-required screen', () => {
  it('shows the file\'s message in the reader\'s language, and both versions', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(UpdateRequiredScreen, {rule: RULE})); });
    expect(texts(tree)).toContain('새 버전으로 업데이트해 주세요 🙏');
    expect(texts(tree).join('\n')).toContain('"current":"1.4.0","minimum":"1.5.0"');
  });

  it('falls back to the app\'s own words when the file has none in that language', async () => {
    mockLanguage = 'en';
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(UpdateRequiredScreen, {rule: RULE})); });
    expect(texts(tree)).toContain('host.updateRequired.body');
  });

  it('opens exactly the store link from the rule', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(UpdateRequiredScreen, {rule: RULE})); });
    await act(async () => { await tree.root.findByProps({testID: 'update-required-store'}).props.onPress(); });
    expect(mockOpenURL).toHaveBeenCalledWith(RULE.storeUrl);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('shows E3009 through the error modal when the store cannot be opened', async () => {
    mockOpenURL.mockRejectedValue(new Error('No app can handle this URL'));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(React.createElement(UpdateRequiredScreen, {rule: RULE})); });
    await act(async () => { await tree.root.findByProps({testID: 'update-required-store'}).props.onPress(); });
    expect(mockShowError).toHaveBeenCalledWith('E3009', expect.stringContaining('No app can handle this URL'));
  });
});

describe('App.tsx while an update is required', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');

  it('refuses a deep link before the relay check, answering E1009', () => {
    const handler = app.slice(app.indexOf('const handleDeepLink'), app.indexOf('validateProofRequest(request)'));
    expect(handler).toMatch(/if \(isUpdateRequired\(\)\) \{\s*console\.log[^\n]*\n\s*answerRelayRequest\(request, UPDATE_REQUIRED_ANSWER\)/);
    expect(app).toMatch(/errorCode: 'E1009'/);
  });

  it('answers a request already waiting for review when the verdict turns to blocked', () => {
    expect(app).toMatch(/if \(!blocked\) return;[\s\S]{0,400}answerRelayRequest\(waiting, UPDATE_REQUIRED_ANSWER\)/);
  });

  it('renders only the update screen while blocked, and holds the loading screen while checking', () => {
    expect(app).toMatch(/if \(forceUpdate\.status === 'blocked'\) \{\s*return \(/);
    expect(app).toContain("if (isLoading || forceUpdate.status === 'checking') {");
  });
});
