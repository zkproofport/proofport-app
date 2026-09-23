import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {darkColors, lightColors} from '../../theme';
import {filterProofCatalog, type ProofPurpose, type ProofSurface} from '../proof/proofCatalog';

let mockLocale: 'en' | 'ko' = 'en';
let mockColors = darkColors;
let mockMode = 'dark';
const mockNavigate = jest.fn();
const mockUpdateSettings = jest.fn();

jest.mock('react-native', () => ({
  SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', Text: 'Text',
  TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: {create: (styles: unknown) => styles, hairlineWidth: 1},
}));
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('../../components/ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: mockColors})}));
jest.mock('../../context/ThemeContext', () => ({useThemeColors: () => ({colors: mockColors, mode: mockMode})}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dictionaries = {en: require('../../i18n/locales/en.json'), ko: require('../../i18n/locales/ko.json')};
      return key.split('.').reduce((value: any, part: string) => value?.[part], dictionaries[mockLocale]) ?? key;
    },
  }),
}));
// Make an accidental network-preference write observable during interaction.
jest.mock('../../hooks', () => ({
  useSettings: () => ({settings: {developerMode: false, defaultNetwork: 'arc'}, loading: false, updateSettings: mockUpdateSettings}),
}));

import {CircuitSelectionScreen} from '../proof/CircuitSelectionScreen';

let screen: ReactTestRenderer;
let consoleError: jest.SpyInstance;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    originalError(...args);
  });
});
afterAll(() => consoleError.mockRestore());
beforeEach(() => {
  mockLocale = 'en';
  mockColors = darkColors;
  mockMode = 'dark';
  mockNavigate.mockClear();
  mockUpdateSettings.mockClear();
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
});

function renderHome() {
  act(() => {screen = create(React.createElement(CircuitSelectionScreen));});
}
function node(testID: string) {
  return screen.root.findByProps({testID});
}
function visibleProofs() {
  return screen.root.findAll(n => typeof n.type === 'string' && n.props.testID?.startsWith('proof-card-'))
    .map(n => n.props.testID.replace('proof-card-', ''));
}
function press(testID: string) {
  act(() => node(testID).props.onPress());
}
function search(query: string) {
  act(() => node('proof-search').props.onChangeText(query));
}

describe('the proof home', () => {
  it('announces the compact proof rows with their provider names', () => {
    mockLocale = 'ko';
    renderHome();
    expect(node('proof-card-oidc_domain_attestation').props.accessibilityLabel)
      .toBe('조직 계정. Google Workspace · Microsoft 365');
    expect(node('proof-card-coinbase_attestation').props.accessibilityLabel)
      .toBe('KYC 완료 여부. Coinbase');
    expect(node('proof-card-coinbase_country_attestation').props.accessibilityLabel)
      .toBe('국가 조건. Coinbase');
  });
  it('offers the three main proofs with developer mode off and another default network', () => {
    renderHome();
    expect(visibleProofs()).toEqual(['oidc_domain_attestation', 'coinbase_attestation', 'coinbase_country_attestation']);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['oidc_domain_attestation', ['DomainInput']],
    ['coinbase_attestation', ['ProofGeneration', {circuitId: 'coinbase_attestation'}]],
    ['coinbase_country_attestation', ['CountryInput']],
  ])('opens the existing input route for %s', (id, destination) => {
    renderHome();
    press(`proof-card-${id}`);
    expect(mockNavigate.mock.calls).toEqual([destination]);
  });

  it('opens the scanner and laboratory through their own entry points', () => {
    renderHome();
    press('proof-scan');
    press('proof-laboratory');
    expect(mockNavigate.mock.calls).toEqual([['ScanTab', {screen: 'ScanMain'}], ['Laboratory']]);
  });

  it.each(['en', 'ko'] as const)('combines provider search with purpose filters in %s', locale => {
    mockLocale = locale;
    mockColors = lightColors;
    mockMode = 'light';
    renderHome();
    search('  mICROsoft\t365  ');
    expect(visibleProofs()).toEqual(['oidc_domain_attestation']);
    press('proof-purpose-identity');
    expect(visibleProofs()).toEqual([]);
    expect(node('proof-empty')).toBeDefined();
    expect(node('proof-laboratory').props.disabled).not.toBe(true);
    press('proof-clear-search');
    expect(visibleProofs()).toEqual(['coinbase_attestation']);
    press('proof-purpose-country');
    expect(visibleProofs()).toEqual(['coinbase_country_attestation']);
    press('proof-purpose-all');
    expect(visibleProofs()).toHaveLength(3);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['en', 'organization', ['oidc_domain_attestation']],
    ['ko', '소속', ['oidc_domain_attestation']],
    ['ko', '신원', ['coinbase_attestation']],
    ['en', 'Ｃｏｉｎｂａｓｅ', ['coinbase_attestation', 'coinbase_country_attestation']],
  ] as const)('searches the displayed words in %s for %s', (locale, query, expected) => {
    mockLocale = locale;
    renderHome();
    search(query);
    expect(visibleProofs()).toEqual(expected);
  });

  it.each(['', ' \n\t '])('keeps all main proofs for empty search %j', query => {
    renderHome();
    search(query);
    expect(visibleProofs()).toHaveLength(3);
  });

  it.each(['%', '_', '\\', "' OR 1=1 --", '<script>alert(1)</script>', '\u0000', '🪪', 'x'.repeat(10000)])('treats hostile or unmatched search case %# as literal text', query => {
    renderHome();
    search(query);
    expect(visibleProofs()).toEqual([]);
    press('proof-laboratory');
    expect(mockNavigate).toHaveBeenCalledWith('Laboratory');
  });

  it.each([
    ['en', 'What would you like to prove?'],
    ['ko', '무엇을 증명할까요?'],
  ] as const)('renders translated home content in %s', (locale, title) => {
    mockLocale = locale;
    renderHome();
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).toContain(title);
    expect(rendered).not.toContain('host.proof.');
  });
});

describe('the active laboratory', () => {
  it('names the test sections and active mobile ID proofs without an unavailable state', () => {
    mockLocale = 'ko';
    const {LaboratoryScreen} = require('../proof/LaboratoryScreen');
    act(() => {screen = create(React.createElement(LaboratoryScreen));});
    const text = screen.root.findAllByType('Text' as never)
      .map(item => item.children.filter(child => typeof child === 'string').join(''));
    for (const label of ['GIWA', 'Arc', '한국 모바일 신분증', '신분증 보유', '나이 조건', '거주 지역']) {
      expect(text).toContain(label);
    }
    expect(text.join(' ')).not.toMatch(/연동 준비|이용할 수 없|준비 중/);
    press('proof-card-mdl_kr_ownership');
    expect(mockNavigate).toHaveBeenCalledWith('MdlKrInput', {variant: 'ownership'});
  });
  it.each(['en', 'ko'] as const)('opens every experimental proof and all three mobile ID variants in %s', locale => {
    mockLocale = locale;
    const {LaboratoryScreen} = require('../proof/LaboratoryScreen');
    act(() => {screen = create(React.createElement(LaboratoryScreen));});
    expect(visibleProofs()).toEqual([
      'giwa_attestation', 'arc_eligibility', 'mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region',
    ]);
    for (const id of visibleProofs()) {
      expect(node(`proof-card-${id}`).props.disabled).not.toBe(true);
      press(`proof-card-${id}`);
    }
    expect(mockNavigate.mock.calls).toEqual([
      ['ArcActionInput', {circuit: 'giwa_attestation'}],
      ['ArcActionInput', {circuit: 'arc_eligibility'}],
      ['MdlKrInput', {variant: 'ownership'}],
      ['MdlKrInput', {variant: 'age'}],
      ['MdlKrInput', {variant: 'region'}],
    ]);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(screen.toJSON())).not.toContain('host.proof.');
  });
});

describe('invalid catalog filter input', () => {
  const translate = (key: string) => key;
  it.each(['missing', '', '__proto__', 'constructor'])('rejects unknown purpose %j instead of choosing another', purpose => {
    expect(() => filterProofCatalog('home', purpose as ProofPurpose, '', translate))
      .toThrow(`Unknown proof purpose '${purpose}'.`);
  });
  it.each(['missing', '', '__proto__', 'constructor'])('rejects unknown surface %j instead of choosing another', surface => {
    expect(() => filterProofCatalog(surface as ProofSurface, 'all', '', translate))
      .toThrow(`Unknown proof surface '${surface}'.`);
  });
  it.each([null, undefined])('rejects a non-text query %s explicitly', query => {
    expect(() => filterProofCatalog('home', 'all', query as unknown as string, translate))
      .toThrow('Proof search must be a string.');
  });
});
