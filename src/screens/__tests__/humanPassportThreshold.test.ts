/**
 * The Human Passport threshold screen: it starts at Human Passport's own
 * passing score, continues only with a threshold the circuit can carry, and
 * hands exactly that number on.
 *
 * Matrix: 20 (start) / 0.0001 / 429496.7295 continue; empty, whitespace, 0,
 * negative, five decimals, 429496.7296, letters, '1e3', '20,5', HTML, emoji,
 * a 10,000-character string do not; Korean text renders. Chain: none selected
 * without a wallet (Continue stays off); with a wallet every chain is looked
 * up, the newest score's chain is preselected, a chain with none says so, a
 * lookup that did not finish says so; the chosen chain id is handed on.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {darkColors as mockDarkColors} from '../../theme';

let mockLocale: 'en' | 'ko' = 'en';
const mockNavigate = jest.fn();
let mockAccount: string | null = null;
const mockSurvey = jest.fn();

jest.mock('react-native', () => ({
  SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: {create: (styles: unknown) => styles},
}));
jest.mock('../../components/ui', () => ({
  Card: 'Card',
  Button: (props: Record<string, unknown>) => require('react').createElement('Button', props),
}));
jest.mock('../../hooks/useWallet', () => ({useWallet: () => ({account: mockAccount})}));
jest.mock('../../utils/humanPassport', () => ({surveyHumanPassportChains: (...a: unknown[]) => mockSurvey(...a)}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({navigate: mockNavigate})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: mockDarkColors})}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const dictionaries = {en: require('../../i18n/locales/en.json'), ko: require('../../i18n/locales/ko.json')};
      const text = key.split('.').reduce((value: any, part: string) => value?.[part], dictionaries[mockLocale]) ?? key;
      return String(text).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars?.[k]));
    },
  }),
}));

import {HumanPassportInputScreen} from '../proof/HumanPassportInputScreen';

let tree: ReactTestRenderer;
let consoleError: jest.SpyInstance;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    original(...args);
  });
});
afterAll(() => consoleError.mockRestore());
beforeEach(() => {
  mockLocale = 'en';
  mockAccount = null;
  mockNavigate.mockClear();
  mockSurvey.mockReset();
  act(() => {tree = create(React.createElement(HumanPassportInputScreen));});
});
const pickChain = (id: number) => act(() => tree.root.find(n => n.props.testID === `chain-row-${id}`).props.onPress());
afterEach(() => act(() => tree.unmount()));

const input = () => tree.root.find(n => n.props.testID === 'human-passport-threshold');
const button = () => tree.root.findByType('Button' as any);
const type = (text: string) => act(() => input().props.onChangeText(text));
const texts = () => tree.root.findAllByType('Text' as any).map(n => [].concat(n.props.children).join(''));

it('starts at 20 with no chain chosen, and does not continue until one is', () => {
  expect(input().props.value).toBe('20');
  expect(button().props.disabled).toBe(true);
  act(() => button().props.onPress());
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(texts()).toContain('Choose the chain your score is on.');
  expect(mockSurvey).not.toHaveBeenCalled();
  pickChain(42161);
  act(() => button().props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ActionInput', {circuit: 'human_passport_score', passportInputs: {minScore: 20, chainId: 42161}});
});

it('with a wallet, looks up every chain, preselects the newest score and says what each chain holds', async () => {
  act(() => tree.unmount());
  mockAccount = '0x1111111111111111111111111111111111111111';
  mockSurvey.mockResolvedValue([
    {chainId: 8453, state: 'found', score: 233860, expirationTime: 100},
    {chainId: 10, state: 'found', score: 300000, expirationTime: 200},
    {chainId: 42161, state: 'none'},
    {chainId: 59144, state: 'unchecked', reason: 'timeout'},
    {chainId: 534352, state: 'none'}, {chainId: 360, state: 'none'}, {chainId: 324, state: 'none'},
  ]);
  await act(async () => {tree = create(React.createElement(HumanPassportInputScreen));});
  expect(mockSurvey).toHaveBeenCalledWith(mockAccount, expect.any(Number), expect.any(Function));
  const all = texts();
  expect(all).toContain('Score 23.386 found');
  expect(all).toContain('Score 30 found');
  expect(all).toContain('No score on this chain');
  expect(all).toContain('Could not check');
  act(() => button().props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ActionInput', {circuit: 'human_passport_score', passportInputs: {minScore: 20, chainId: 10}});
});

it.each([['0.0001', 0.0001], ['429496.7295', 429496.7295], [' 25.5 ', 25.5]])('continues with %j', (text, value) => {
  pickChain(8453);
  type(text);
  expect(button().props.disabled).toBe(false);
  act(() => button().props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ActionInput', {circuit: 'human_passport_score', passportInputs: {minScore: value, chainId: 8453}});
});

it.each(['', '   ', '0', '-5', '20.00001', '429496.7296', 'abc', '1e3', '20,5', '<b>20</b>', '🙂', '9'.repeat(10000), '\t\n'])(
  'does not continue with %j', text => {
    pickChain(8453);
    type(text);
    expect(button().props.disabled).toBe(true);
    act(() => button().props.onPress());
    act(() => input().props.onSubmitEditing());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(texts()).toContain('Enter a score above 0 with at most four decimals.');
  });

it('reads in Korean', () => {
  act(() => tree.unmount());
  mockLocale = 'ko';
  act(() => {tree = create(React.createElement(HumanPassportInputScreen));});
  expect(texts()).toContain('점수가 20 이상임을 증명');
});
