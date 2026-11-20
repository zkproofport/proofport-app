import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ProofRequestModal} from '../ProofRequestModal';
import type {ProofRequest} from '../../utils/deeplink';

let mockLanguage: 'en' | 'ko' | undefined;

jest.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', Text: 'Text', ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity', Image: 'Image', TextInput: 'TextInput',
  StyleSheet: {create: (styles: unknown) => styles, hairlineWidth: 1},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider'}));
jest.mock('../../context/ThemeContext', () => ({
  useThemeColors: () => ({colors: jest.requireActual('../../theme').darkColors}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string, options: Record<string, unknown> = {}) => {
    if (!mockLanguage) return key;
    const bundles = {
      en: jest.requireActual('../../i18n/locales/en.json'),
      ko: jest.requireActual('../../i18n/locales/ko.json'),
    };
    const value = key.split('.').reduce((entry, part) => entry?.[part], bundles[mockLanguage]) ?? key;
    return typeof value === 'string' ? value.replace(/{{(\w+)}}/g, (_, name) => String(options[name] ?? '')) : key;
  }}),
}));
jest.mock('../ProofUiIcon', () => ({ProofUiIcon: 'ProofUiIcon'}));

/**
 * The OPRF domain and scope a wallet credential proof is keyed by are shown
 * on the review screen beside the requester's name, in the identity block --
 * not only inside the collapsed original request -- in every shipped locale,
 * as plain text. User decision 2026-11-20. Removing either row from the
 * visible area fails here.
 */
function request(inputs: Record<string, unknown>, circuit = 'coinbase_attestation'): ProofRequest {
  return {requestId: 'review-oprf', circuit, inputs, callbackUrl: 'https://relay.example/delivery',
    dappName: 'Vote desk', createdAt: 1} as ProofRequest;
}

const textOf = (node: {children: unknown[]}): string =>
  node.children.map(c => (typeof c === 'string' ? c : textOf(c as {children: unknown[]}))).join('');

describe('the OPRF domain and scope are shown beside the requester', () => {
  let renderer: ReactTestRenderer;
  let errors: jest.SpyInstance;
  beforeEach(() => {
    mockLanguage = 'en';
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    const consoleError = console.error;
    errors = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      consoleError(...args);
    });
  });
  afterEach(() => {
    if (renderer) act(() => renderer.unmount());
    errors.mockRestore();
  });
  const render = (r: ProofRequest) => act(() => {
    renderer = create(React.createElement(ProofRequestModal, {visible: true, request: r, onAccept: () => true, onReject: () => {}}));
  });
  const row = (id: string) => textOf(renderer.root.findByProps({testID: id}) as never);
  const inIdentityBlock = (id: string) => {
    // The row sits in the same block as the requester's name, outside every collapsible section.
    let node = renderer.root.findByProps({testID: id}).parent;
    while (node && node.props.accessibilityState?.expanded === undefined && node.props.testID !== 'request-card') node = node.parent;
    return node?.props.testID === 'request-card';
  };

  it.each(['en', 'ko'] as const)('shows both, labelled, in %s', lang => {
    mockLanguage = lang;
    const labels = jest.requireActual(`../../i18n/locales/${lang}.json`).host.proofRequest.review;
    render(request({scope: 'community-vote-2026', oprfDomain: 'vote.example'}));
    expect(row('request-oprf-domain')).toBe(`${labels.oprfDomain}  vote.example`);
    expect(row('request-oprf-scope')).toBe(`${labels.oprfScope}  community-vote-2026`);
    expect(inIdentityBlock('request-oprf-domain')).toBe(true);
    expect(inIdentityBlock('request-oprf-scope')).toBe(true);
    expect(labels.oprfDomain).not.toMatch(/^host\./);
    expect(labels.oprfScope).not.toMatch(/^host\./);
  });

  it('shows hostile text as plain text, control characters made visible, nothing interpreted', () => {
    render(request({scope: '<script>alert(1)</script>\n\u202e', oprfDomain: '한국어 🔐 <b>x</b>'}));
    expect(row('request-oprf-domain')).toContain('한국어 🔐 <b>x</b>');
    expect(row('request-oprf-scope')).toContain('<script>alert(1)</script>⟦U+000A⟧⟦U+202E⟧');
  });

  it('a request without a domain says so rather than showing nothing', () => {
    render(request({scope: 's'}));
    const missing = jest.requireActual('../../i18n/locales/en.json').host.proofRequest.review.values.missing;
    expect(typeof missing).toBe('string');
    expect(row('request-oprf-domain')).toBe(`Domain  ${missing}`);
  });

  it('a long value is kept whole (wrapping is the screen\'s, never a cut in the value)', () => {
    const long = 'a'.repeat(256);
    render(request({scope: long, oprfDomain: 'd.example'}));
    expect(row('request-oprf-scope')).toContain(long);
  });

  it('is shown for every wallet credential circuit and not for the OIDC one', () => {
    for (const c of ['coinbase_attestation', 'coinbase_country_attestation', 'giwa_attestation', 'dojang_playground', 'human_passport_score']) {
      render(request({scope: 's', oprfDomain: 'd.example'}, c));
      expect(row('request-oprf-domain')).toContain('d.example');
      act(() => renderer.unmount());
    }
    render(request({scope: 's', domain: 'masselabs.com', provider: 'google'}, 'oidc_domain_attestation'));
    expect(renderer.root.findAllByProps({testID: 'request-oprf-names'})).toHaveLength(0);
  });
});
