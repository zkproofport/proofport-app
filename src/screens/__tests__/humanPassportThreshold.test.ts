/**
 * The Human Passport threshold screen: it starts at Human Passport's own
 * passing score, continues only with a threshold the circuit can carry, and
 * hands exactly that number on.
 *
 * Matrix: 20 (start) / 0.0001 / 429496.7295 continue; empty, whitespace, 0,
 * negative, five decimals, 429496.7296, letters, '1e3', '20,5', HTML, emoji,
 * a 10,000-character string do not; Korean text renders.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {darkColors as mockDarkColors} from '../../theme';

let mockLocale: 'en' | 'ko' = 'en';
const mockNavigate = jest.fn();

jest.mock('react-native', () => ({
  SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  StyleSheet: {create: (styles: unknown) => styles},
}));
jest.mock('../../components/ui', () => ({
  Card: 'Card',
  Button: (props: Record<string, unknown>) => require('react').createElement('Button', props),
}));
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
  mockNavigate.mockClear();
  act(() => {tree = create(React.createElement(HumanPassportInputScreen));});
});
afterEach(() => act(() => tree.unmount()));

const input = () => tree.root.find(n => n.props.testID === 'human-passport-threshold');
const button = () => tree.root.findByType('Button' as any);
const type = (text: string) => act(() => input().props.onChangeText(text));
const texts = () => tree.root.findAllByType('Text' as any).map(n => [].concat(n.props.children).join(''));

it('starts at 20 and continues to the action screen with it', () => {
  expect(input().props.value).toBe('20');
  act(() => button().props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ActionInput', {circuit: 'human_passport_score', passportInputs: {minScore: 20}});
});

it.each([['0.0001', 0.0001], ['429496.7295', 429496.7295], [' 25.5 ', 25.5]])('continues with %j', (text, value) => {
  type(text);
  expect(button().props.disabled).toBe(false);
  act(() => button().props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ActionInput', {circuit: 'human_passport_score', passportInputs: {minScore: value}});
});

it.each(['', '   ', '0', '-5', '20.00001', '429496.7296', 'abc', '1e3', '20,5', '<b>20</b>', '🙂', '9'.repeat(10000), '\t\n'])(
  'does not continue with %j', text => {
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
