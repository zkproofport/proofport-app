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

const action = {
  domain: {name: '문서 🧾', version: '1', chainId: 504200},
  primaryType: 'AuthorizeDocument',
  types: {AuthorizeDocument: [{name: 'document', type: 'Document'}], Document: [{name: 'title', type: 'string'}]},
  message: {
    document: {title: '계약서 📄', enabled: false, count: 0},
    approvals: ['9007199254740993123456789', null, '', {}, []],
    note: '<script>alert("x")</script>\n\t\u0000',
    absent: undefined,
  },
};

function request(overrides: Partial<ProofRequest> = {}): ProofRequest {
  return {
    requestId: 'review-me', circuit: 'giwa_attestation',
    inputs: {scope: 'docs.example', action},
    callbackUrl: 'https://relay.example/delivery', dappName: 'Document desk',
    message: 'Read the requested document', createdAt: 1,
    ...overrides,
  };
}

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType('Text' as never)
    .map(node => node.children.filter(child => typeof child === 'string').join(''))
    .join('\n');
}

function expandEverything(renderer: ReactTestRenderer): void {
  for (let depth = 0; depth < 120; depth++) {
    const collapsed = renderer.root.findAll(node => node.props.accessibilityState?.expanded === false);
    if (!collapsed.length) return;
    act(() => collapsed.forEach(node => node.props.onPress()));
  }
  throw new Error('Review content could not be fully expanded');
}

describe('a request is reviewed before it is approved', () => {
  let renderer: ReactTestRenderer;
  let errors: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
    mockLanguage = undefined;
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    const consoleError = console.error;
    errors = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      consoleError(...args);
    });
  });
  afterEach(() => {
    if (renderer) act(() => renderer.unmount());
    jest.useRealTimers();
    errors.mockRestore();
  });
  function render(current: ProofRequest, onAccept = jest.fn<boolean, [ProofRequest]>(() => true), onReject = jest.fn()) {
    act(() => { renderer = create(React.createElement(ProofRequestModal, {
      visible: true, request: current, onAccept, onReject,
    })); });
    return {onAccept, onReject};
  }
  const button = (id: string) => renderer.root.findByProps({testID: id});

  it('retains the native host with visible false until dismissal can acknowledge the next modal', () => {
    const incoming = request();
    const onAccept = jest.fn(() => true);
    const onReject = jest.fn();
    const onDismiss = jest.fn();
    act(() => {renderer = create(React.createElement(ProofRequestModal, {
      visible: true, request: incoming, onAccept, onReject, onDismiss,
    }));});
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: false, request: null, onAccept, onReject, onDismiss,
    })));
    const nativeModal = renderer.root.findByType('Modal' as never);
    expect(nativeModal.props.visible).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => nativeModal.props.onDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('measures safe-area insets inside the native modal and stacks condition values across the available width', () => {
    mockLanguage = 'en';
    render(request({circuit: 'oidc_domain_attestation', inputs: {scope: 'app', domain: 'masselabs.com', provider: 'google'}}));
    const modal = renderer.root.findByType('Modal' as never);
    expect(modal.findByType('SafeAreaView' as never).parent?.type).toBe('SafeAreaProvider');
    const domain = renderer.root.findAllByType('Text' as never).find(node => node.children.includes('An account at masselabs.com'))!;
    const style = Object.assign({}, ...domain.props.style.flat().filter(Boolean));
    expect(style.textAlign).toBe('left');
    const rowStyle = Object.assign({}, ...domain.parent!.parent!.props.style.flat().filter(Boolean));
    expect(rowStyle.flexDirection).toBe('column');
  });

  it('opens exact action rows from a compact primary-type card and returns without approving', () => {
    const {onAccept, onReject} = render(request());
    const summary = button('request-action');
    expect(summary.props.accessibilityRole).toBe('button');
    expect(renderedText(renderer)).toContain('AuthorizeDocument');
    expect(renderedText(renderer)).not.toContain('chainId');
    expect(button('request-card').findByProps({testID: 'request-accept'})).toBeTruthy();
    expect(button('request-card').findByProps({testID: 'request-reject'})).toBeTruthy();
    act(() => summary.props.onPress());
    expect(button('action-review-details')).toBeTruthy();
    expect(renderedText(renderer)).toContain('document');
    expect(renderedText(renderer)).not.toContain('chainId');
    expandEverything(renderer);
    expect(renderedText(renderer)).toContain('chainId\n504200');
    expect(renderedText(renderer)).not.toContain('"chainId"');
    expect(renderedText(renderer)).not.toContain('{3}');
    expect(renderer.root.findAllByProps({testID: 'request-accept'})).toHaveLength(0);
    act(() => button('action-review-back').props.onPress());
    expect(button('request-accept')).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('keeps the action details bound to the displayed request and closes them on replacement', () => {
    const first = request();
    const {onAccept, onReject} = render(first);
    const oldOpen = button('request-action').props.onPress;
    const oldAccept = button('request-accept').props.onPress;
    act(() => oldOpen());
    const oldClose = button('action-review-back').props.onPress;
    act(() => oldAccept());
    expect(onAccept).not.toHaveBeenCalled();
    const next = request({inputs: {scope: 'new', action: {...action, primaryType: 'ApproveReport'}}});
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: true, request: next, onAccept, onReject,
    })));
    expect(renderer.root.findAllByProps({testID: 'action-review-details'})).toHaveLength(0);
    expect(renderedText(renderer)).toContain('ApproveReport');
    act(() => { oldOpen(); oldClose(); });
    expect(renderer.root.findAllByProps({testID: 'action-review-details'})).toHaveLength(0);
    act(() => button('request-accept').props.onPress());
    expect(onAccept.mock.calls[0][0]).toBe(next);
  });

  it('system back closes action details without cancelling and expiry still disables approval', () => {
    const {onAccept, onReject} = render(request({expiresAt: 11000}));
    act(() => button('request-action').props.onPress());
    act(() => jest.advanceTimersByTime(1000));
    act(() => renderer.root.findByType('Modal' as never).props.onRequestClose());
    expect(button('request-accept').props.disabled).toBe(true);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    act(() => button('request-reject').props.onPress());
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('uses plain requester prose, full selectable addresses and outline icons', () => {
    const address = '0x0123456789abcdef0123456789abcdef01234567';
    render(request({inputs: {scope: 'docs', action: {...action, message: {Account: address, Amount: '99999999999999999999999999999'}}}}));
    expect(renderedText(renderer)).toContain('Read the requested document');
    expect(renderedText(renderer)).not.toContain('"Read the requested document"');
    expect(renderer.root.findAllByProps({name: 'identity'})).not.toHaveLength(0);
    act(() => button('request-action').props.onPress());
    const text = renderedText(renderer);
    expect(text).toContain(`Account\n${address}`);
    expect(text).toContain('Amount\n99999999999999999999999999999');
    const addressText = renderer.root.findAllByType('Text' as never).find(node => node.children.includes(address));
    expect(addressText?.props.selectable).toBe(true);
    expect(addressText?.props.numberOfLines).toBeUndefined();
    expect(text).not.toMatch(/USDC|ETH|Deposit|Withdraw/);
  });

  it('keeps malformed metadata objects and null inputs reviewable and cancellable', () => {
    const malformed = request({
      dappName: {toString: null, valueOf: false} as unknown as string,
      dappIcon: {uri: null} as unknown as string,
      message: {toString: null, body: {enabled: false, count: 0}} as unknown as string,
      inputs: null as unknown as ProofRequest['inputs'],
    });
    const original = JSON.stringify(malformed);
    const {onAccept, onReject} = render(malformed);
    expandEverything(renderer);
    const text = renderedText(renderer);
    expect(text).toContain('dappName');
    expect(text).toContain('toString');
    expect(text).toContain('values.null');
    expect(text).toContain('enabled');
    expect(text).toContain('false');
    expect(text).not.toContain('[object Object]');
    expect(renderer.root.findAllByType('Image' as never)).toHaveLength(0);
    expect(JSON.stringify(malformed)).toBe(original);
    act(() => button('request-reject').props.onPress());
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('shows the original arbitrary action read-only before any approval', () => {
    const current = request();
    const before = JSON.stringify(current);
    const {onAccept} = render(current);
    expect(renderedText(renderer)).toContain('AuthorizeDocument');
    act(() => button('request-action').props.onPress());
    expandEverything(renderer);
    let text = renderedText(renderer);
    expect(text).toContain('AuthorizeDocument');
    expect(text).toContain('chainId');
    expect(text).toContain('504200');
    expect(text).toContain('document');
    expandEverything(renderer);
    text = renderedText(renderer);
    for (const value of ['계약서 📄', 'false', '0', '9007199254740993123456789', 'values.null', 'values.emptyString', 'values.emptyObject', 'values.emptyArray', 'values.missing']) {
      expect(text).toContain(value);
    }
    expect(text).toContain('<script>alert("x")</script>⟦U+000A⟧⟦U+0009⟧⟦U+0000⟧');
    expect(text).toContain('Document');
    expect(renderer.root.findAllByType('TextInput' as never)).toHaveLength(0);
    expect(onAccept).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).toBe(before);
    expect(Object.hasOwn(action.message, 'absent')).toBe(true);
    act(() => button('action-review-back').props.onPress());
    act(() => button('request-accept').props.onPress());
    expect(onAccept).toHaveBeenCalledWith(current);
  });

  it('has a full screen, a delivery endpoint label and no requester verification claim', () => {
    render(request());
    expect(renderer.root.findByType('Modal' as never).props.presentationStyle).toBe('fullScreen');
    act(() => button('request-details').props.onPress());
    expect(renderedText(renderer)).toContain('host.proofRequest.review.deliveryEndpoint');
    expect(renderedText(renderer)).toContain('relay.example');
    expect(renderedText(renderer)).not.toMatch(/verifiedRequester|inputsHashVerified/);
  });

  it.each(['oidc_domain_attestation', 'mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'] as const)(
    'reviews %s without asking for a wallet or inventing an action', circuit => {
      render(request({circuit, inputs: {scope: 'app', domain: 'company.example', ageThreshold: 19, targetRegion: '서울'}}));
      expect(button('request-accept').props.disabled).toBe(false);
      expect(renderedText(renderer)).not.toMatch(/willConnectWallet|walletAddress|review.actionTitle/);
      expect(renderer.root.findAllByProps({testID: 'request-action'})).toHaveLength(0);
    },
  );

  it('shows the requested age without adding a fixed age from the circuit description', () => {
    mockLanguage = 'en';
    render(request({circuit: 'mdl_kr_age', inputs: {scope: 'app', ageThreshold: 21}}));
    const text = renderedText(renderer);
    expect(text).toContain('Minimum age');
    expect(text).toContain('21');
    expect(text).not.toContain('19');
  });

  it('does not describe an absent Arc action as a requested authorization', () => {
    render(request({circuit: 'arc_eligibility', inputs: {scope: 'app'}}));
    const text = renderedText(renderer);
    expect(text).toContain('host.proofRequest.presentation.arc.title');
    expect(text).not.toContain('host.proof.circuitSelection.arcEligibility.description');
    expect(renderer.root.findAllByProps({testID: 'request-action'})).toHaveLength(0);
  });

  it.each(['en', 'ko'] as const)('uses accurate %s Arc condition copy when no action was requested', language => {
    mockLanguage = language;
    render(request({circuit: 'arc_eligibility', inputs: {scope: 'app'}}));
    const text = renderedText(renderer);
    const expected = {
      en: ['Prove your Arc eligibility', 'Ownership of a Coinbase-attested wallet', 'when an action is requested'],
      ko: ['Arc 인증 조건을 증명해주세요', 'Coinbase 인증 지갑 보유', '작업 요청 시'],
    };
    for (const phrase of expected[language]) expect(text).toContain(phrase);
    expect(text).not.toMatch(/authorizes the requested action|Prove eligibility for the Arc action|요청 작업 승인|승인 작업과 도메인의 해시값/);
    expect(renderer.root.findAllByProps({testID: 'request-action'})).toHaveLength(0);
  });

  it.each(['unknown_circuit', '__proto__', 'constructor'])(
    'refuses unsupported circuit %s while allowing rejection', circuit => {
      const {onAccept, onReject} = render(request({circuit: circuit as ProofRequest['circuit']}));
      expect(renderedText(renderer)).toContain(circuit);
      expect(button('request-accept').props.disabled).toBe(true);
      act(() => button('request-accept').props.onPress());
      act(() => button('request-reject').props.onPress());
      expect(onAccept).not.toHaveBeenCalled();
      expect(onReject).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0, 10000, 9999, NaN, Infinity])('refuses expired or invalid expiry %s', expiresAt => {
    const {onAccept} = render(request({expiresAt}));
    expect(button('request-accept').props.disabled).toBe(true);
    act(() => button('request-accept').props.onPress());
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('expires while open and checks the clock even before its next timer render', () => {
    const {onAccept} = render(request({expiresAt: 10500}));
    const press = button('request-accept').props.onPress;
    jest.setSystemTime(10500);
    act(() => press());
    expect(onAccept).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1000));
    expect(button('request-accept').props.disabled).toBe(true);
    expect(renderedText(renderer)).toContain('host.proofRequest.review.expired');
  });

  it('keeps a reader’s collapsed values stable across expiry timer updates', () => {
    render(request({expiresAt: 20000}));
    act(() => button('request-action').props.onPress());
    const conditions = renderer.root.findAll(node => node.props.accessibilityState?.expanded === true)[0];
    act(() => conditions.props.onPress());
    expect(conditions.props.accessibilityState.expanded).toBe(false);
    act(() => jest.advanceTimersByTime(1000));
    expect(conditions.props.accessibilityState.expanded).toBe(false);
  });

  it('only accepts once and approves precisely the displayed object', () => {
    const first = request();
    const {onAccept, onReject} = render(first);
    const pressFirst = button('request-accept').props.onPress;
    act(() => { pressFirst(); pressFirst(); });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0][0]).toBe(first);
    const second = request({message: 'changed', inputs: {scope: 'changed'}});
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: true, request: second, onAccept, onReject,
    })));
    expect(renderedText(renderer)).toContain('changed');
    act(() => pressFirst());
    expect(onAccept).toHaveBeenCalledTimes(1);
    act(() => button('request-accept').props.onPress());
    expect(onAccept.mock.calls[1][0]).toBe(second);
  });

  it('allows cancellation when final parent validation refuses acceptance', () => {
    const {onAccept, onReject} = render(request(), jest.fn<boolean, [ProofRequest]>(() => false));
    act(() => button('request-accept').props.onPress());
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(button('request-accept').props.disabled).toBe(false);
    expect(button('request-reject').props.disabled).toBe(false);
    act(() => button('request-reject').props.onPress());
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('allows retry after refused acceptance and locks only after the parent starts it', () => {
    const onAccept = jest.fn<boolean, [ProofRequest]>(() => true).mockReturnValueOnce(false);
    render(request(), onAccept);
    const accept = button('request-accept').props.onPress;
    act(() => accept());
    expect(button('request-accept').props.disabled).toBe(false);
    act(() => { accept(); accept(); });
    expect(onAccept).toHaveBeenCalledTimes(2);
    expect(button('request-accept').props.disabled).toBe(true);
  });

  it('allows cancellation when expiry crosses the modal and parent validation checks', () => {
    const onAccept = jest.fn<boolean, [ProofRequest]>(() => {
      jest.setSystemTime(10500);
      return false;
    });
    const {onReject} = render(request({expiresAt: 10500}), onAccept);
    act(() => button('request-accept').props.onPress());
    expect(button('request-accept').props.disabled).toBe(true);
    expect(button('request-reject').props.disabled).toBe(false);
    act(() => button('request-reject').props.onPress());
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('ignores old accept and cancel events after replacement, even with the same request ID', () => {
    const {onAccept, onReject} = render(request());
    const oldAccept = button('request-accept').props.onPress;
    const oldReject = button('request-reject').props.onPress;
    const next = request({inputs: {scope: 'new content'}});
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: true, request: next, onAccept, onReject,
    })));
    act(() => { oldAccept(); oldReject(); });
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    act(() => button('request-accept').props.onPress());
    expect(onAccept).toHaveBeenCalledWith(next);
  });

  it('ignores a retained event after the review becomes hidden', () => {
    const current = request();
    const {onAccept, onReject} = render(current);
    const accept = button('request-accept').props.onPress;
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: false, request: current, onAccept, onReject,
    })));
    act(() => accept());
    expect(onAccept).not.toHaveBeenCalled();
    expect(renderer.root.findByType('Modal' as never).props.visible).toBe(false);
  });

  it('keeps request details collapsed until asked and resets them for a replacement request', () => {
    const {onAccept, onReject} = render(request());
    expect(button('request-details').props.accessibilityState.expanded).toBe(false);
    expect(renderedText(renderer)).not.toContain('review-me');
    act(() => button('request-details').props.onPress());
    expect(renderedText(renderer)).toContain('review-me');
    const next = request({requestId: 'next-review'});
    act(() => renderer.update(React.createElement(ProofRequestModal, {
      visible: true, request: next, onAccept, onReject,
    })));
    expect(button('request-details').props.accessibilityState.expanded).toBe(false);
    expect(renderedText(renderer)).not.toContain('next-review');
    expect(renderedText(renderer)).toContain('AuthorizeDocument');
  });

  it.each(['request-back', 'request-reject', 'system'])('rejects through %s and cannot accept afterward', method => {
    const {onAccept, onReject} = render(request());
    const accept = button('request-accept').props.onPress;
    const reject = method === 'system'
      ? renderer.root.findByType('Modal' as never).props.onRequestClose
      : button(method).props.onPress;
    act(() => { reject(); reject(); accept(); });
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does not truncate long values or lose deeply nested keys and array entries', () => {
    let nested: unknown = {'deep leaf': '끝'};
    for (let depth = 0; depth < 30; depth++) nested = {['level ' + depth]: nested};
    const long = '한'.repeat(12000);
    render(request({inputs: {scope: 'x', action: {...action, message: {nested, long, many: Array.from({length: 150}, (_, i) => i)}}}}));
    act(() => button('request-action').props.onPress());
    expandEverything(renderer);
    const text = renderedText(renderer);
    expect(text).toContain(long);
    expect(text).toContain('deep leaf');
    expect(text).toContain('149');
    expect(renderer.root.findAllByType('Text' as never).every(node => node.props.numberOfLines === undefined)).toBe(true);
  });

  it('preserves adversarial keys, whitespace, string types and control characters as inert text', () => {
    const values = {
      '%_\\ SQL \' OR 1=1 --': '  ',
      '<html>이름 😀</html>': 'false',
      '\n\tkey': '0',
      direction: '\u202eevil\u2066',
      maximum: Number.MAX_SAFE_INTEGER,
      aboveMaximumString: '9007199254740992',
      twiceMaximumString: '18014398509481982',
      negativeZero: -0,
      one: 1,
    };
    render(request({inputs: {scope: 'app', action: {...action, message: values}}}));
    act(() => button('request-action').props.onPress());
    expandEverything(renderer);
    const text = renderedText(renderer);
    for (const key of Object.keys(values).filter(field => field !== '\n\tkey')) expect(text).toContain(key);
    expect(text).toContain('⟦U+000A⟧⟦U+0009⟧key');
    for (const value of ['␠␠', 'false', '0', '⟦U+202E⟧evil⟦U+2066⟧', '9007199254740991', '9007199254740992', '18014398509481982', '-0', '1', 'host.proofRequest.review.values.text']) {
      expect(text).toContain(value);
    }
  });

  it.each(['en', 'ko'] as const)('localizes review controls in %s without translating request data', language => {
    mockLanguage = language;
    render(request());
    act(() => button('request-details').props.onPress());
    const text = renderedText(renderer);
    const labels = {
      en: ['Proof request', 'Confirm and continue', 'Proof delivery endpoint'],
      ko: ['증명 요청', '확인하고 계속', '증명 전달 주소'],
    };
    for (const label of labels[language]) expect(text).toContain(label);
    expect(text).toContain('AuthorizeDocument');
    expect(text).not.toContain('host.proofRequest.');
    act(() => button('request-action').props.onPress());
    expandEverything(renderer);
    expect(renderedText(renderer)).toContain('문서 🧾');
  });
});
