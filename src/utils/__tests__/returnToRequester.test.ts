/* eslint-disable no-script-url -- 'javascript://' is test data here: these
   cases exist precisely to prove the validator refuses it. */
/**
 * `returnScheme` — handing the user back to wherever they came from.
 *
 * Row numbers refer to the edge-case matrix planned before implementation.
 */

const mockOpenURL = jest.fn();
const mockMoveTaskToBack = jest.fn();
const mockPlatform = {OS: 'ios'};
const mockNativeModules: {AppSwitcher?: {moveTaskToBack?: unknown}} = {};

jest.mock('react-native', () => ({
  Linking: {
    openURL: (...args: unknown[]) => mockOpenURL(...args),
    // Deliberately absent from the implementation's code path: canOpenURL
    // returns false on iOS for any scheme missing from LSApplicationQueriesSchemes,
    // so relying on it would break every integrator's scheme.
    canOpenURL: jest.fn().mockResolvedValue(false),
  },
  get Platform() {
    return mockPlatform;
  },
  get NativeModules() {
    return mockNativeModules;
  },
}));

import {
  normalizeReturnScheme,
  returnToRequester,
  sendProofResponseAndReturn,
  parseProofRequestUrl,
  MAX_RETURN_SCHEME_LENGTH,
  type ProofResponse,
} from '../deeplink';
import {
  registerReturnNoticeHandler,
  resetReturnNoticeHandler,
  type ReturnNoticeKind,
} from '../returnNoticeBridge';

/** Records every notice the code under test raises. */
let noticesShown: ReturnNoticeKind[] = [];

/** Put the platform on Android WITH a working native module. */
function onAndroid(moved = true) {
  mockPlatform.OS = 'android';
  mockMoveTaskToBack.mockResolvedValue(moved);
  mockNativeModules.AppSwitcher = {moveTaskToBack: mockMoveTaskToBack};
}

beforeEach(() => {
  mockOpenURL.mockReset();
  mockOpenURL.mockResolvedValue(true);
  mockMoveTaskToBack.mockReset();
  mockMoveTaskToBack.mockResolvedValue(true);
  // iOS with no native module is the default: it is the case with the fewest
  // escape hatches, so anything that passes here passes everywhere.
  mockPlatform.OS = 'ios';
  delete mockNativeModules.AppSwitcher;
  noticesShown = [];
  registerReturnNoticeHandler(kind => noticesShown.push(kind));
});

afterEach(() => {
  resetReturnNoticeHandler();
});

// ---------------------------------------------------------------------------
// normalizeReturnScheme
// ---------------------------------------------------------------------------
describe('normalizeReturnScheme', () => {
  it('accepts a bare custom scheme and lowercases it', () => {
    expect(normalizeReturnScheme('mydapp://')).toBe('mydapp://');
    expect(normalizeReturnScheme('MyDapp://')).toBe('mydapp://');
    expect(normalizeReturnScheme('my-dapp.v2+alpha://')).toBe('my-dapp.v2+alpha://');
  });

  it('accepts googlechrome://, which the SDK sends for Chrome on iOS', () => {
    expect(normalizeReturnScheme('googlechrome://')).toBe('googlechrome://');
    expect(normalizeReturnScheme('GoogleChrome://')).toBe('googlechrome://');
  });

  /**
   * The https-origin form is gone. Opening one launches a NEW browser tab on a
   * freshly loaded page instead of returning the user to the tab they started
   * from, which is the opposite of what this field is for. Defence in depth:
   * the relay already rejects these, but nothing that arrives inside a deep
   * link is trusted on arrival.
   */
  it.each([
    'https://myapp.com',
    'https://myapp.com:8443',
    'https://demo.zkproofport.app',
    'https://stg-demo.zkproofport.app',
    'HTTPS://MyApp.COM',
    'https://localhost',
  ])('rejects the https origin %s', value => {
    expect(normalizeReturnScheme(value)).toBeNull();
  });

  // With no host these are shaped exactly like a bare custom scheme and sail
  // through the shape regex — only the denied list stops them.
  it.each(['https://', 'http://', 'HTTPS://', 'HtTp://'])(
    'rejects the host-less browser scheme %s',
    value => {
      expect(normalizeReturnScheme(value)).toBeNull();
    },
  );

  // Rows 1, 11
  it('returns null for undefined and null, checked separately', () => {
    expect(normalizeReturnScheme(undefined)).toBeNull();
    expect(normalizeReturnScheme(null)).toBeNull();
  });

  it('returns null for non-string types', () => {
    for (const value of [0, 1, true, false, {}, [], ['mydapp://']]) {
      expect(normalizeReturnScheme(value)).toBeNull();
    }
  });

  // Rows 9, 10
  it('returns null for empty and whitespace-only values, each shape separately', () => {
    expect(normalizeReturnScheme('')).toBeNull();
    expect(normalizeReturnScheme('   ')).toBeNull();
    expect(normalizeReturnScheme('\t')).toBeNull();
    expect(normalizeReturnScheme('\n')).toBeNull();
    expect(normalizeReturnScheme(' mydapp:// ')).toBeNull();
  });

  // Rows 2-5, 13
  it('honours the length boundary', () => {
    const atCap = 'a'.repeat(MAX_RETURN_SCHEME_LENGTH - 3) + '://';
    const overCap = 'a'.repeat(MAX_RETURN_SCHEME_LENGTH - 2) + '://';
    expect(atCap).toHaveLength(MAX_RETURN_SCHEME_LENGTH);
    expect(normalizeReturnScheme('a://')).toBe('a://');
    expect(normalizeReturnScheme(atCap)).toBe(atCap);
    expect(normalizeReturnScheme(overCap)).toBeNull();
    expect(normalizeReturnScheme('a'.repeat(MAX_RETURN_SCHEME_LENGTH * 2) + '://')).toBeNull();
  });

  it('rejects a 100k-character value without running the regexes on it', () => {
    const started = Date.now();
    expect(normalizeReturnScheme('a'.repeat(100_000) + '://')).toBeNull();
    expect(Date.now() - started).toBeLessThan(100);
  });

  // Row 6
  it.each([
    'javascript://',
    'data://',
    'file://',
    'about://',
    'blob://',
    'content://',
    'intent://',
    'tel://',
    'sms://',
    'mailto://',
    'facetime://',
    'JavaScript://',
    'FILE://',
  ])('rejects the denied scheme %s', value => {
    expect(normalizeReturnScheme(value)).toBeNull();
  });

  // Row 7 — this is the guard that matters: an app, at its front door, never an action
  it.each([
    'mydapp://x',
    'mydapp://transfer?to=0xattacker',
    'mydapp://a#b',
    'https://evil.example.com/pay?amount=1000',
    'https://evil.example.com/',
    'https://evil.example.com#frag',
    'https://user:pass@evil.example.com',
    'googlechrome://evil.example.com',
  ])('rejects the URL-shaped value %s', value => {
    expect(normalizeReturnScheme(value)).toBeNull();
  });

  // Rows 8, 12, 19
  it.each([
    'mydapp://\n',
    'my\ndapp://',
    'mydapp\t://',
    'mydapp://\u0000',
    'my dapp://',
    'mydapp://%0Ajavascript:alert(1)',
    '<script>://',
    'my_dapp://',
    '1mydapp://',
    '앱://',
    '🚀://',
    'mydapp://한글',
    'https://한글.com',
    'notaurl',
    'mydapp:/',
    'mydapp:',
    '://',
    '//mydapp',
    'mydapp:///',
  ])('rejects the malformed value %j', value => {
    expect(normalizeReturnScheme(value)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// returnToRequester — the scheme path
// ---------------------------------------------------------------------------
describe('returnToRequester — opening a scheme', () => {
  it('opens the normalised scheme and reports a switch', async () => {
    await expect(returnToRequester('MyDapp://')).resolves.toBe('switched');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith('mydapp://');
    expect(noticesShown).toEqual([]);
  });

  it.each(['googlechrome://', 'firefox://'])(
    'opens %s bare, with no URL appended',
    async scheme => {
      // The bare form is the whole point: with a URL appended, these browsers
      // open a NEW tab instead of foregrounding the one the user was reading.
      await expect(returnToRequester(scheme)).resolves.toBe('switched');
      expect(mockOpenURL).toHaveBeenCalledWith(scheme);
    },
  );
});

// ---------------------------------------------------------------------------
// returnToRequester — iOS with nothing to open (matrix row 1)
// ---------------------------------------------------------------------------
describe('returnToRequester — iOS with no usable target', () => {
  it('shows the notice when the field is absent', async () => {
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(noticesShown).toEqual(['delivered']);
  });

  // Rows 9, 10, 19 — an unusable value is treated exactly like an absent one
  it.each(['', '   ', 'notaurl', 'javascript://', 'https://evil.example.com/pay?amount=1', 'https://'])(
    'opens nothing and shows the notice for %j',
    async value => {
      await expect(returnToRequester(value)).resolves.toBe('stay');
      expect(mockOpenURL).not.toHaveBeenCalled();
      expect(noticesShown).toEqual(['delivered']);
    },
  );

  it('shows the notice for the https origin the demo used to send', async () => {
    await expect(returnToRequester('https://demo.zkproofport.app')).resolves.toBe('stay');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(noticesShown).toEqual(['delivered']);
  });

  it('says "declined" instead of "delivered" when asked to', async () => {
    await expect(returnToRequester(undefined, 'declined')).resolves.toBe('stay');
    expect(noticesShown).toEqual(['declined']);
  });

  // Rows 15, 18 — a failed switch must never escape as an error
  it('falls back to the notice when openURL rejects', async () => {
    mockOpenURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(returnToRequester('mydapp://')).resolves.toBe('stay');
    expect(noticesShown).toEqual(['delivered']);
  });

  it('falls back to the notice when the Linking module throws synchronously', async () => {
    mockOpenURL.mockImplementation(() => {
      throw new Error('Linking unavailable');
    });
    await expect(returnToRequester('mydapp://')).resolves.toBe('stay');
    expect(noticesShown).toEqual(['delivered']);
  });

  it('never calls moveTaskToBack on iOS, even when a module is somehow present', async () => {
    mockNativeModules.AppSwitcher = {moveTaskToBack: mockMoveTaskToBack};
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(mockMoveTaskToBack).not.toHaveBeenCalled();
  });

  it('does not break when no notice handler is registered at all', async () => {
    resetReturnNoticeHandler();
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
  });
});

// ---------------------------------------------------------------------------
// returnToRequester — Android backgrounds itself instead
// ---------------------------------------------------------------------------
describe('returnToRequester — Android', () => {
  it('backgrounds the app when no scheme was supplied, and shows no notice', async () => {
    onAndroid();
    await expect(returnToRequester(undefined)).resolves.toBe('backgrounded');
    expect(mockMoveTaskToBack).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).not.toHaveBeenCalled();
    // The previous app resumed on its own — there is nothing to tell the user.
    expect(noticesShown).toEqual([]);
  });

  it('backgrounds the app when the supplied value was unusable', async () => {
    onAndroid();
    await expect(returnToRequester('https://demo.zkproofport.app')).resolves.toBe('backgrounded');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockMoveTaskToBack).toHaveBeenCalledTimes(1);
  });

  // An explicit scheme is the requester's own decision and still wins.
  it('prefers the requester scheme over backgrounding', async () => {
    onAndroid();
    await expect(returnToRequester('mydapp://')).resolves.toBe('switched');
    expect(mockOpenURL).toHaveBeenCalledWith('mydapp://');
    expect(mockMoveTaskToBack).not.toHaveBeenCalled();
  });

  it('falls back to backgrounding when the scheme could not be opened', async () => {
    onAndroid();
    mockOpenURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(returnToRequester('mydapp://')).resolves.toBe('backgrounded');
    expect(mockMoveTaskToBack).toHaveBeenCalledTimes(1);
    expect(noticesShown).toEqual([]);
  });

  // External dependency failure: an older native binary under a newer JS bundle.
  it('shows the notice when the native module is missing', async () => {
    mockPlatform.OS = 'android';
    delete mockNativeModules.AppSwitcher;
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(noticesShown).toEqual(['delivered']);
  });

  it('shows the notice when the native module exists but has no method', async () => {
    mockPlatform.OS = 'android';
    mockNativeModules.AppSwitcher = {};
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(noticesShown).toEqual(['delivered']);
  });

  it('shows the notice when moveTaskToBack reports it could not move', async () => {
    onAndroid(false);
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(mockMoveTaskToBack).toHaveBeenCalledTimes(1);
    expect(noticesShown).toEqual(['delivered']);
  });

  it('shows the notice when moveTaskToBack rejects, without throwing', async () => {
    mockPlatform.OS = 'android';
    mockMoveTaskToBack.mockRejectedValue(new Error('no activity'));
    mockNativeModules.AppSwitcher = {moveTaskToBack: mockMoveTaskToBack};
    await expect(returnToRequester(undefined)).resolves.toBe('stay');
    expect(noticesShown).toEqual(['delivered']);
  });

  // Only a literal `true` counts as moved — a truthy string must not pass.
  it.each([[undefined], ['true'], [1], [null]])(
    'treats a non-true moveTaskToBack result (%p) as not moved',
    async result => {
      mockPlatform.OS = 'android';
      mockMoveTaskToBack.mockResolvedValue(result);
      mockNativeModules.AppSwitcher = {moveTaskToBack: mockMoveTaskToBack};
      await expect(returnToRequester(undefined)).resolves.toBe('stay');
    },
  );
});

// ---------------------------------------------------------------------------
// Contract: the success path must hand the user back (matrix row 16)
// ---------------------------------------------------------------------------
describe('sendProofResponseAndReturn — completion contract', () => {
  const response: ProofResponse = {
    requestId: 'req-1',
    circuit: 'coinbase_attestation',
    status: 'completed',
    proof: '0xproof',
    publicInputs: ['0x01'],
  };
  const callbackUrl = 'https://relay.zkproofport.app/api/v1/proof/callback';

  function mockCallbackOk() {
    const fetchMock = jest.fn().mockResolvedValue({ok: true, status: 200, statusText: 'OK'});
    (global as any).fetch = fetchMock;
    return fetchMock;
  }

  it('posts the result and THEN opens the return scheme', async () => {
    const order: string[] = [];
    (global as any).fetch = jest.fn().mockImplementation(async () => {
      order.push('callback');
      return {ok: true, status: 200, statusText: 'OK'};
    });
    mockOpenURL.mockImplementation(async () => {
      order.push('openURL');
      return true;
    });

    await expect(
      sendProofResponseAndReturn(response, {callbackUrl, returnScheme: 'mydapp://'}),
    ).resolves.toBe(true);

    // Removing the returnToRequester() call from the success path fails here.
    expect(mockOpenURL).toHaveBeenCalledWith('mydapp://');
    // Opening another app backgrounds this one; the POST must already be done.
    expect(order).toEqual(['callback', 'openURL']);
  });

  it('posts the result BEFORE backgrounding itself on Android', async () => {
    onAndroid();
    const order: string[] = [];
    (global as any).fetch = jest.fn().mockImplementation(async () => {
      order.push('callback');
      return {ok: true, status: 200, statusText: 'OK'};
    });
    mockMoveTaskToBack.mockImplementation(async () => {
      order.push('moveTaskToBack');
      return true;
    });

    await expect(sendProofResponseAndReturn(response, {callbackUrl})).resolves.toBe(true);
    expect(order).toEqual(['callback', 'moveTaskToBack']);
  });

  // Row 1: no returnScheme on iOS -> proof still delivered, user still told
  it('delivers the proof and shows the notice when no returnScheme was supplied', async () => {
    const fetchMock = mockCallbackOk();

    await expect(sendProofResponseAndReturn(response, {callbackUrl})).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(noticesShown).toEqual(['delivered']);
  });

  // Row 15: the proof already succeeded — a failed handoff is not a proof error
  it('still reports delivery success when the handoff fails', async () => {
    mockCallbackOk();
    mockOpenURL.mockRejectedValue(new Error('No app handles mydapp://'));

    await expect(
      sendProofResponseAndReturn(response, {callbackUrl, returnScheme: 'mydapp://'}),
    ).resolves.toBe(true);
  });

  it('reports delivery failure without being affected by the handoff', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ok: false, status: 500, statusText: 'err'});

    await expect(
      sendProofResponseAndReturn(response, {callbackUrl, returnScheme: 'mydapp://'}),
    ).resolves.toBe(false);
    expect(mockOpenURL).toHaveBeenCalledWith('mydapp://');
  });

  // Rows 6, 7, 14 — a hostile value delivered in a deep link is ignored, not obeyed
  it.each([
    'javascript://',
    'mydapp://transfer?to=0xattacker',
    'https://evil.example.com/pay?amount=1',
    'https://demo.zkproofport.app',
  ])('delivers the proof but refuses to open %j', async value => {
    mockCallbackOk();

    await expect(
      sendProofResponseAndReturn(response, {callbackUrl, returnScheme: value}),
    ).resolves.toBe(true);
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Row 17: the value survives the relay deep link intact
// ---------------------------------------------------------------------------
describe('deep link round trip', () => {
  function buildRelayDeepLink(request: Record<string, unknown>): string {
    const data = Buffer.from(JSON.stringify(request)).toString('base64url');
    return `zkproofport://proof-request?data=${data}`;
  }

  const base = {
    requestId: 'req-1',
    circuitId: 'coinbase_attestation',
    scope: 'myapp.com',
    inputs: {scope: 'myapp.com'},
    callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback',
    createdAt: new Date().toISOString(),
  };

  it('carries returnScheme through the relay data payload', () => {
    const parsed = parseProofRequestUrl(buildRelayDeepLink({...base, returnScheme: 'mydapp://'}));
    expect(parsed?.returnScheme).toBe('mydapp://');
  });

  it('carries googlechrome:// through the relay data payload', () => {
    const parsed = parseProofRequestUrl(
      buildRelayDeepLink({...base, returnScheme: 'googlechrome://'}),
    );
    expect(parsed?.returnScheme).toBe('googlechrome://');
  });

  it('leaves returnScheme undefined when the relay did not set it', () => {
    const parsed = parseProofRequestUrl(buildRelayDeepLink(base));
    expect(parsed?.returnScheme).toBeUndefined();
  });

  it('carries returnScheme through the query-parameter deep link shape', () => {
    const url =
      'zkproofport://proof-request?circuit=coinbase_attestation&requestId=req-1' +
      '&callbackUrl=https%3A%2F%2Frelay.zkproofport.app%2Fapi%2Fv1%2Fproof%2Fcallback' +
      '&returnScheme=mydapp%3A%2F%2F';
    expect(parseProofRequestUrl(url)?.returnScheme).toBe('mydapp://');
  });
});
