/**
 * Who is waiting for this proof, and is it us?
 *
 * The defect: signing into OpenStoa on Android dropped the user out of the app
 * the moment the proof was delivered. The OpenStoa mini-app logs in by asking
 * its own server for a proof request and feeding the deep link straight back
 * into this app's pipeline (`runSelfRelayLogin` -> `triggerDeepLink`). That
 * pipeline ends by handing the user back to "the requester" — and on Android,
 * with no `returnScheme` to open, handing back means `moveTaskToBack()`. The
 * requester was this app. It backgrounded itself mid-login, and only
 * re-entering it revealed the poll had carried on and succeeded.
 *
 * Nothing about the request itself distinguished the two cases: a self-issued
 * request and a dapp's request are byte-identical by the time they reach the
 * parser. The only thing that differs is the DOOR the request came in through,
 * which is why `origin` is a required parameter of `parseProofRequestUrl` and
 * not a field the URL can carry.
 *
 * Edge-case matrix rows are named per test. Rows marked N/A here: UTF-8 and
 * very-large input (origin is a three-value union, not free text — TypeScript
 * covers the shape and the runtime guard covers everything else), and
 * authorization (this decision is about window management, not access).
 */

const mockOpenURL = jest.fn();
const mockMoveTaskToBack = jest.fn();
const mockPlatform = {OS: 'ios'};
const mockNativeModules: {AppSwitcher?: {moveTaskToBack?: unknown}} = {};

jest.mock('react-native', () => ({
  Linking: {openURL: (...args: unknown[]) => mockOpenURL(...args)},
  get Platform() {
    return mockPlatform;
  },
  get NativeModules() {
    return mockNativeModules;
  },
}));

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {
  parseProofRequestUrl,
  requesterIsAnotherApp,
  sendProofResponseAndReturn,
  type ProofRequestOrigin,
  type ProofResponse,
} from '../deeplink';
import {
  registerReturnNoticeHandler,
  resetReturnNoticeHandler,
  type ReturnNoticeKind,
} from '../returnNoticeBridge';

let noticesShown: ReturnNoticeKind[] = [];

const callbackUrl = 'https://relay.zkproofport.app/api/v1/proof/callback';
const response: ProofResponse = {
  requestId: 'req-1',
  circuit: 'oidc_domain_attestation',
  status: 'completed',
  proof: '0xproof',
  publicInputs: ['0x01'],
};

/** Android WITH a working native module — the platform where the bug bit. */
function onAndroid() {
  mockPlatform.OS = 'android';
  mockNativeModules.AppSwitcher = {moveTaskToBack: mockMoveTaskToBack};
}

beforeEach(() => {
  mockOpenURL.mockReset();
  mockOpenURL.mockResolvedValue(true);
  mockMoveTaskToBack.mockReset();
  mockMoveTaskToBack.mockResolvedValue(true);
  mockPlatform.OS = 'ios';
  delete mockNativeModules.AppSwitcher;
  noticesShown = [];
  registerReturnNoticeHandler(kind => noticesShown.push(kind));
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
  });
});

afterEach(() => resetReturnNoticeHandler());

// ---------------------------------------------------------------------------
// Row: boundary — every value of the union, plus the unclassified case
// ---------------------------------------------------------------------------
describe('requesterIsAnotherApp', () => {
  it('is true for a link opened by another app on this device', () => {
    expect(requesterIsAnotherApp('link')).toBe(true);
  });

  it.each<ProofRequestOrigin>(['scan', 'self'])(
    'is false for %j — the requester is not on this device',
    origin => {
      expect(requesterIsAnotherApp(origin)).toBe(false);
    },
  );

  // Row: empty / undefined, kept separate from the enum cases on purpose.
  // An unclassified request must fail CLOSED. If this ever returns true,
  // every path that forgot to name an origin silently regains the old bug.
  it.each([undefined, '', ' ', 'LINK', 'external', null])(
    'is false for the unclassified value %j',
    value => {
      expect(requesterIsAnotherApp(value as ProofRequestOrigin)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// Row: integrity — THE regression. Android, self-issued, no returnScheme.
// ---------------------------------------------------------------------------
describe('the OpenStoa self-relay login on Android', () => {
  it('never backgrounds the app it is logging into', async () => {
    onAndroid();

    await expect(
      sendProofResponseAndReturn(response, {origin: 'self', callbackUrl}),
    ).resolves.toBe(true);

    // The defect, stated directly. Revert the guard in
    // sendProofResponseAndReturn and this is the assertion that goes red.
    expect(mockMoveTaskToBack).not.toHaveBeenCalled();
  });

  it('does not tell the user to switch back to an app they never left', async () => {
    // iOS has no moveTaskToBack, so the same request took the other ending:
    // a "your proof was delivered — now switch back" bottom sheet, raised on
    // top of a login the user is still inside. Less destructive than Android,
    // equally wrong.
    await expect(
      sendProofResponseAndReturn(response, {origin: 'self', callbackUrl}),
    ).resolves.toBe(true);

    expect(noticesShown).toEqual([]);
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Row: contract invocation — delivery is independent of the return decision
// ---------------------------------------------------------------------------
describe('proof delivery is unaffected by origin', () => {
  it.each<ProofRequestOrigin>(['link', 'scan', 'self'])(
    'still POSTs the proof for origin %j',
    async origin => {
      onAndroid();
      await expect(
        sendProofResponseAndReturn(response, {origin, callbackUrl}),
      ).resolves.toBe(true);
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
    },
  );

  // Guards the fix from over-correcting into "nobody is ever handed back".
  it('still hands an external requester back on Android', async () => {
    onAndroid();
    await expect(
      sendProofResponseAndReturn(response, {origin: 'link', callbackUrl}),
    ).resolves.toBe(true);
    expect(mockMoveTaskToBack).toHaveBeenCalled();
  });

  it('still opens an external requester scheme', async () => {
    await expect(
      sendProofResponseAndReturn(response, {
        origin: 'link',
        callbackUrl,
        returnScheme: 'mydapp://',
      }),
    ).resolves.toBe(true);
    expect(mockOpenURL).toHaveBeenCalledWith('mydapp://');
  });
});

// ---------------------------------------------------------------------------
// Row: hostile input — the URL does not get to describe where it came from
// ---------------------------------------------------------------------------
describe('origin cannot be supplied by the deep link', () => {
  function relayDeepLink(request: Record<string, unknown>): string {
    const data = Buffer.from(JSON.stringify(request)).toString('base64url');
    return `zkproofport://proof-request?data=${data}`;
  }

  const base = {
    requestId: 'req-1',
    circuitId: 'oidc_domain_attestation',
    inputs: {},
    callbackUrl,
  };

  it('ignores an origin smuggled into the format-1 data blob', () => {
    // The blob is decoded wholesale, so this field really does arrive. The
    // parser must assign over it, not merge with it.
    const parsed = parseProofRequestUrl(
      relayDeepLink({...base, origin: 'link'}),
      'self',
    );
    expect(parsed?.origin).toBe('self');
  });

  it('ignores an origin passed as a query parameter', () => {
    const url =
      'zkproofport://proof-request?circuit=oidc_domain_attestation&requestId=req-1' +
      `&callbackUrl=${encodeURIComponent(callbackUrl)}&origin=link`;
    expect(parseProofRequestUrl(url, 'scan')?.origin).toBe('scan');
  });

  it.each<ProofRequestOrigin>(['link', 'scan', 'self'])(
    'stamps %j onto both deep-link shapes',
    origin => {
      expect(parseProofRequestUrl(relayDeepLink(base), origin)?.origin).toBe(origin);
      const url =
        'zkproofport://proof-request?circuit=oidc_domain_attestation&requestId=req-1' +
        `&callbackUrl=${encodeURIComponent(callbackUrl)}`;
      expect(parseProofRequestUrl(url, origin)?.origin).toBe(origin);
    },
  );
});

// ---------------------------------------------------------------------------
// Row: the guard dying at a distance.
//
// The guard lives in sendProofResponseAndReturn, but the ANSWER is chosen at
// the door — every triggerDeepLink() call site. A future third caller that
// omits the argument is the exact shape of this bug returning, and no test of
// the guard itself would see it. TypeScript already requires the parameter;
// this sweep is what survives someone reaching for `as any` or a default.
// ---------------------------------------------------------------------------
describe('every in-app deep-link entry point names its origin', () => {
  const SRC = join(__dirname, '..', '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(full, out);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('CONTRACT: no triggerDeepLink() call omits the origin argument', () => {
    const offenders: string[] = [];
    let callSites = 0;

    for (const file of walk(SRC)) {
      const body = readFileSync(file, 'utf8');
      if (relative(SRC, file) === 'utils/deepLinkBridge.ts') continue;
      for (const match of body.matchAll(/triggerDeepLink\(([^)]*)\)/g)) {
        callSites += 1;
        if (!match[1].includes(',')) {
          offenders.push(`${relative(SRC, file)}: triggerDeepLink(${match[1]})`);
        }
      }
    }

    // Fails loudly if the call sites are renamed away rather than fixed —
    // an empty sweep would otherwise pass forever while proving nothing.
    expect(callSites).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
