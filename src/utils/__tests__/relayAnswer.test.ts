/**
 * A relay proof request gets exactly one answer — src/utils/relayAnswer.ts.
 *
 * The real responder and the real `postRelayCallback` run here; only `fetch`,
 * the relay host list, storage and the ErrorModal bridge are stubbed.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage here
 *   boundary   → first answer sends; 2nd and 3rd for the same id send nothing;
 *                a different id is independent ("once per requestId")
 *   race       → two answers in the same tick (no await between) send one;
 *                the claim is taken before the POST resolves
 *   hostile    → untrusted host, look-alike host, non-relay path: no POST;
 *                requestId `__proto__` is an ordinary key
 *   empty      → no request / empty requestId: nothing sent; an empty error
 *                message is replaced by the code's registry text
 *   UTF-8      → a Korean error message reaches the body byte-for-byte
 *   very large → a 64 KiB error message is sent whole (no truncation)
 *   integrity  → body shape per status matches the relay contract, and every
 *                registry code matches ^E\d{4}$
 *   409        → "already answered" is quiet for error/cancel, E1007 for a
 *                proof; "timed out" shows E1003 (with the failure kept in the
 *                detail) and is never retried
 *   external   → network failure / 5xx: no throw, logged, kept for the next
 *                launch; other 4xx: definitive, forgotten
 *   kill       → a request left open by an earlier run is answered once at
 *                launch (cancelled, or the undelivered error), requests of this
 *                run are not, and the re-send stops after 3 launches
 *   authz      → N/A as a caller identity: the app has none here. The trust
 *                boundary is the relay host list, covered under "hostile".
 */
const mockShowError = jest.fn();
const mockStorage = new Map<string, string>();

jest.mock('../errorBridge', () => ({showGlobalError: (...args: unknown[]) => mockShowError(...args)}));
jest.mock('../../config/environment', () => ({
  getRelayConfig: () => ({trustedHosts: ['relay.zkproofport.app'], allowPrivateIps: false}),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {mockStorage.set(key, value);},
  removeItem: async (key: string) => {mockStorage.delete(key);},
}}));

import {ErrorCodes} from '../../constants/errorCodes';
import {conflictSaysTimedOut} from '../deeplink';
import {
  answerRelayRequest,
  answerRequestsLeftOpen,
  isRelayRequestAnswered,
  rememberOpenRelayRequest,
  resetRelayAnswersForTests,
  type RelayRequestRef,
} from '../relayAnswer';

const CALLBACK = 'https://relay.zkproofport.app/api/v1/proof/callback';
const OPEN_KEY = '@zkproofport:relay:openRequests';

function req(requestId = 'req-1', callbackUrl = CALLBACK): RelayRequestRef {
  return {requestId, circuit: 'coinbase_attestation', callbackUrl};
}

let fetchMock: jest.Mock;
let logs: jest.SpyInstance;
let errors: jest.SpyInstance;

function reply(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function bodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(call => JSON.parse(call[1].body));
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function openRecords(): Array<Record<string, any>> {
  return JSON.parse(mockStorage.get(OPEN_KEY) ?? '[]');
}

beforeEach(() => {
  mockStorage.clear();
  mockShowError.mockReset();
  resetRelayAnswersForTests();
  fetchMock = jest.fn().mockResolvedValue(reply(200, {received: true}));
  (global as any).fetch = fetchMock;
  logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  errors = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logs.mockRestore();
  errors.mockRestore();
});

describe('once per requestId', () => {
  it('sends the first answer and nothing for the second and third', async () => {
    await expect(answerRelayRequest(req(), {status: 'error', errorCode: 'E2005', error: 'no attestation'}))
      .resolves.toBe('delivered');
    await expect(answerRelayRequest(req(), {status: 'cancelled', reason: 'left'})).resolves.toBe('duplicate');
    await expect(answerRelayRequest(req(), {status: 'completed', fields: {proof: '0x1'}})).resolves.toBe('duplicate');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies()[0]).toMatchObject({status: 'error', errorCode: 'E2005'});
  });

  it('claims the request before the POST resolves (same-tick double trigger)', async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {release = () => resolve(reply(200));}));
    const first = answerRelayRequest(req(), {status: 'error', errorCode: 'E2001', error: 'a'});
    const second = answerRelayRequest(req(), {status: 'error', errorCode: 'E2003', error: 'b'});
    expect(isRelayRequestAnswered('req-1')).toBe(true);
    await expect(second).resolves.toBe('duplicate');
    release();
    await expect(first).resolves.toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats different requestIds independently', async () => {
    await answerRelayRequest(req('a'), {status: 'cancelled', reason: 'x'});
    await answerRelayRequest(req('b'), {status: 'cancelled', reason: 'x'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats __proto__ as an ordinary requestId', async () => {
    await expect(answerRelayRequest(req('__proto__'), {status: 'cancelled', reason: 'x'})).resolves.toBe('delivered');
    expect(isRelayRequestAnswered('constructor')).toBe(false);
    await expect(answerRelayRequest(req('__proto__'), {status: 'cancelled', reason: 'x'})).resolves.toBe('duplicate');
  });
});

describe('what is sent', () => {
  it('error carries status, errorCode and the message', async () => {
    await answerRelayRequest(req(), {status: 'error', errorCode: 'E2007', error: 'no issuance'});
    expect(fetchMock).toHaveBeenCalledWith(CALLBACK, expect.objectContaining({method: 'POST'}));
    expect(bodies()[0]).toEqual({
      requestId: 'req-1', circuit: 'coinbase_attestation', status: 'error', errorCode: 'E2007', error: 'no issuance',
    });
  });

  it('cancelled carries the reason and no errorCode', async () => {
    await answerRelayRequest(req(), {status: 'cancelled', reason: 'User rejected the request'});
    expect(bodies()[0]).toEqual({
      requestId: 'req-1', circuit: 'coinbase_attestation', status: 'cancelled', error: 'User rejected the request',
    });
  });

  it('completed carries the proof fields and no error', async () => {
    await answerRelayRequest(req(), {status: 'completed', fields: {
      proof: '0xabc', publicInputs: ['0x01'], verifierAddress: '0x1111111111111111111111111111111111111111',
      chainId: 8453, nullifier: '0x02',
    }});
    const body = bodies()[0];
    expect(body).toMatchObject({requestId: 'req-1', circuit: 'coinbase_attestation', status: 'completed',
      proof: '0xabc', publicInputs: ['0x01'], chainId: 8453, nullifier: '0x02'});
    expect(body).not.toHaveProperty('error');
    expect(body).not.toHaveProperty('errorCode');
  });

  it('cannot let completed fields overwrite the envelope', async () => {
    await answerRelayRequest(req(), {status: 'completed', fields: {
      proof: '0x1', requestId: 'forged', status: 'error',
    } as never});
    expect(bodies()[0]).toMatchObject({requestId: 'req-1', status: 'completed'});
  });

  it('replaces an empty error message with the code text', async () => {
    await answerRelayRequest(req(), {status: 'error', errorCode: 'E2001', error: ''});
    expect(bodies()[0].error).toBe(ErrorCodes.E2001.description);
  });

  it('sends a Korean message intact', async () => {
    const msg = '로그인 실패: 사용자 취소 🙅 — 다시 시도해 주세요.\n\t끝';
    await answerRelayRequest(req(), {status: 'error', errorCode: 'E2001', error: msg});
    expect(bodies()[0].error).toBe(msg);
  });

  it('sends a 64 KiB message whole', async () => {
    const msg = 'x'.repeat(64 * 1024);
    await answerRelayRequest(req(), {status: 'error', errorCode: 'E2001', error: msg});
    expect((bodies()[0].error as string).length).toBe(64 * 1024);
  });

  it('every registry code has the shape the relay accepts', () => {
    for (const code of Object.keys(ErrorCodes)) expect(code).toMatch(/^E\d{4}$/);
  });
});

describe('who is answered', () => {
  it.each([
    ['an untrusted host', 'https://attacker.test/api/v1/proof/callback'],
    ['a look-alike host', 'https://relay.zkproofport.app.evil.test/api/v1/proof/callback'],
    ['a non-relay path', 'https://relay.zkproofport.app/collect'],
    ['an empty url', ''],
  ])('does not POST to %s', async (_label, url) => {
    await expect(answerRelayRequest(req('r', url), {status: 'error', errorCode: 'E1002', error: 'bad'}))
      .resolves.toBe('untrusted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, undefined, {requestId: '', circuit: 'coinbase_attestation', callbackUrl: CALLBACK}])(
    'sends nothing for a request without a requestId (%j)',
    async request => {
      await expect(answerRelayRequest(request as never, {status: 'cancelled', reason: 'x'})).resolves.toBe('invalid');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('the relay says 409', () => {
  it('already answered: no retry, no modal for an error answer', async () => {
    fetchMock.mockResolvedValue(reply(409, {error: 'Request already has a terminal result'}));
    await expect(answerRelayRequest(req(), {status: 'error', errorCode: 'E2005', error: 'x'}))
      .resolves.toBe('already-answered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('already answered: tells the person their proof was not delivered', async () => {
    fetchMock.mockResolvedValue(reply(409, {error: 'already completed'}));
    await answerRelayRequest(req(), {status: 'completed', fields: {proof: '0x1'}});
    expect(mockShowError).toHaveBeenCalledWith('E1007', expect.stringContaining('req-1'));
  });

  it.each([
    {reason: 'timeout'},
    {status: 'expired'},
    {code: 'TIMED_OUT'},
    {error: 'Request timed out'},
    'request expired',
  ])('timed out (%j): shows E1003 once and keeps the failure in the detail', async body => {
    fetchMock.mockResolvedValue(reply(409, body));
    await expect(answerRelayRequest(req(), {status: 'error', errorCode: 'E2005', error: 'no attestation'}))
      .resolves.toBe('expired');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledWith('E1003', expect.stringContaining('[E2005] no attestation'));
  });

  it('timed out at launch recovery: logged, no modal', async () => {
    fetchMock.mockResolvedValue(reply(409, {reason: 'timeout'}));
    await expect(answerRelayRequest(req(), {status: 'cancelled', reason: 'x'}, {notifyUser: false}))
      .resolves.toBe('expired');
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('reads an unparseable or unrelated 409 as already answered', () => {
    expect(conflictSaysTimedOut('')).toBe(false);
    expect(conflictSaysTimedOut('<html>conflict</html>')).toBe(false);
    expect(conflictSaysTimedOut(JSON.stringify({error: 'duplicate'}))).toBe(false);
    expect(conflictSaysTimedOut('null')).toBe(false);
  });
});

describe('the callback fails', () => {
  it('a network failure does not throw, is logged, and is kept for the next launch', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(answerRelayRequest(req(), {status: 'error', errorCode: 'E2001', error: 'prover crashed'}))
      .resolves.toBe('undelivered');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Failed to send response'), expect.any(TypeError));
    await settle();
    expect(openRecords()).toEqual([expect.objectContaining({
      requestId: 'req-1', pending: {status: 'error', errorCode: 'E2001', error: 'prover crashed'},
    })]);
  });

  it('a failed proof delivery tells the person (E3003) and is re-sent as a cancel, never as a stale proof', async () => {
    fetchMock.mockResolvedValue(reply(503, 'down'));
    await expect(answerRelayRequest(req(), {status: 'completed', fields: {proof: '0xsecret'}}))
      .resolves.toBe('undelivered');
    expect(mockShowError).toHaveBeenCalledWith('E3003', expect.stringContaining('503'));
    await settle();
    expect(JSON.stringify(openRecords())).not.toContain('0xsecret');
    expect(openRecords()[0].pending.status).toBe('cancelled');
  });

  it('a 404 is definitive and forgotten', async () => {
    await rememberOpenRelayRequest(req());
    fetchMock.mockResolvedValue(reply(404, {error: 'Unknown or expired requestId'}));
    await expect(answerRelayRequest(req(), {status: 'cancelled', reason: 'x'})).resolves.toBe('rejected');
    await settle();
    expect(openRecords()).toEqual([]);
  });

  it('a storage failure never blocks or breaks the answer', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const original = AsyncStorage.getItem;
    AsyncStorage.getItem = async () => { throw new Error('disk full'); };
    try {
      await expect(answerRelayRequest(req(), {status: 'cancelled', reason: 'x'})).resolves.toBe('delivered');
      expect(errors).toHaveBeenCalledWith('[RelayAnswer] Open-request storage failed:', expect.any(Error));
    } finally {
      AsyncStorage.getItem = original;
    }
  });
});

describe('requests left open by an earlier run', () => {
  it('a delivered answer removes the open record', async () => {
    await rememberOpenRelayRequest(req());
    expect(openRecords()).toHaveLength(1);
    await answerRelayRequest(req(), {status: 'cancelled', reason: 'x'});
    await settle();
    expect(openRecords()).toEqual([]);
  });

  it('answers a killed request cancelled at launch, once, and silently', async () => {
    await rememberOpenRelayRequest(req('killed'));
    resetRelayAnswersForTests(Date.now() + 1); // a new run
    await expect(answerRequestsLeftOpen()).resolves.toBe(1);
    expect(bodies()).toEqual([expect.objectContaining({requestId: 'killed', status: 'cancelled'})]);
    expect(mockShowError).not.toHaveBeenCalled();
    await settle();
    await expect(answerRequestsLeftOpen()).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-sends an undelivered error with its code', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await answerRelayRequest(req(), {status: 'error', errorCode: 'E2007', error: 'none'});
    await settle();
    resetRelayAnswersForTests(Date.now() + 1);
    await answerRequestsLeftOpen();
    expect(bodies()[1]).toMatchObject({status: 'error', errorCode: 'E2007', error: 'none'});
  });

  it('leaves requests opened in this run alone', async () => {
    resetRelayAnswersForTests(Date.now() - 1000);
    await rememberOpenRelayRequest(req('current'));
    await expect(answerRequestsLeftOpen()).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up after three launches', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await rememberOpenRelayRequest(req('stuck'));
    let sent = 0;
    for (let launch = 1; launch <= 5; launch++) {
      resetRelayAnswersForTests(Date.now() + launch);
      sent += await answerRequestsLeftOpen();
      await settle();
    }
    expect(sent).toBe(3);
    expect(openRecords()).toEqual([]);
  });
});
