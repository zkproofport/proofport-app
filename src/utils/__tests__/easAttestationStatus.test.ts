/**
 * The on-chain "still good?" check for GIWA attestations (GIWA KYC, Dojang
 * Playground): every refusal, and the decoding of a REAL answer from GIWA
 * Sepolia's EAS predeploy (getAttestation of the Dojang Playground issuance
 * 0xabeac22b…8eb6, read 2026-11-27: issued 1791907446, expires 1794499446 =
 * 2026-11-12T16:04:06Z, 30 days, not revoked).
 */
import {ethers} from 'ethers';
import {
  ATTESTATION_REFUSAL_CODE,
  AttestationNotLiveError,
  attestedUidInReceipt,
  judgeAttestation,
  requireLiveAttestation,
} from '../easAttestationStatus';

const EAS = '0x4200000000000000000000000000000000000021';
const WALLET = '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c';
const UID = '0x2045041b8869d46fecf5e7ae6ab99b4a6165086555175f0f26a4c703eadb2c48';
const SCHEMA = '0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08';
const REAL_ANSWER = '0x00000000000000000000000000000000000000000000000000000000000000202045041b8869d46fecf5e7ae6ab99b4a6165086555175f0f26a4c703eadb2c48072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08000000000000000000000000000000000000000000000000000000006ace5676000000000000000000000000000000000000000000000000000000006af5e376000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005a3e649208ae15ec52496c1ae23b2ff89ac02f0c00000000000000000000000063cce2b569a7bc35895ee24306c1512fefc061210000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001';
const ISSUED = 1791907446;
const EXPIRES = 1794499446;
const noLog = () => {};

function rpcAnswer(result: unknown, opts: {status?: number; error?: unknown} = {}) {
  return jest.fn(async () => ({
    ok: (opts.status ?? 200) === 200,
    status: opts.status ?? 200,
    json: async () => (opts.error !== undefined ? {jsonrpc: '2.0', id: 1, error: opts.error} : {jsonrpc: '2.0', id: 1, result}),
  })) as unknown as typeof fetch;
}

async function refusal(p: Promise<unknown>): Promise<AttestationNotLiveError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AttestationNotLiveError);
    return e as AttestationNotLiveError;
  }
  throw new Error('expected a refusal');
}

const base = {uid: UID, schema: SCHEMA, time: ISSUED, expirationTime: EXPIRES, revocationTime: 0, recipient: WALLET};
const q = (nowSeconds: number, over: Partial<{recipient: string; schemaUid: string; uid: string}> = {}) =>
  ({uid: UID, recipient: WALLET, nowSeconds, ...over});

describe('judging one record', () => {
  it('live: not revoked and before its expiry', () => {
    expect(judgeAttestation(base, q(EXPIRES - 1))).toEqual({uid: UID, expirationTime: EXPIRES, time: ISSUED});
  });
  it('no expiry (0) never expires', () => {
    expect(judgeAttestation({...base, expirationTime: 0}, q(4_000_000_000)).expirationTime).toBe(0);
  });
  it('expired at exactly its expiry second, and after (E2026)', () => {
    for (const now of [EXPIRES, EXPIRES + 1, EXPIRES * 2]) {
      expect(() => judgeAttestation(base, q(now))).toThrow(/expired at 2026-11-12T16:04:06/);
      try { judgeAttestation(base, q(now)); } catch (e) { expect((e as AttestationNotLiveError).code).toBe('E2026'); }
    }
  });
  it('revoked, even before its expiry (E2025)', () => {
    for (const revocationTime of [1, ISSUED + 10]) {
      try {
        judgeAttestation({...base, revocationTime}, q(ISSUED + 20));
        throw new Error('not refused');
      } catch (e) {
        expect((e as AttestationNotLiveError).kind).toBe('revoked');
        expect((e as AttestationNotLiveError).code).toBe('E2025');
      }
    }
  });
  it('revoked AND expired reads as revoked', () => {
    try { judgeAttestation({...base, revocationTime: ISSUED + 5}, q(EXPIRES + 5)); } catch (e) { expect((e as AttestationNotLiveError).kind).toBe('revoked'); }
  });
  it('a missing record (EAS answers zeros) is "missing", not live', () => {
    expect(() => judgeAttestation({...base, uid: ethers.constants.HashZero, time: 0, expirationTime: 0}, q(1))).toThrow(/no attestation/);
  });
  it("another wallet's record, another uid, another schema", () => {
    expect(() => judgeAttestation(base, q(ISSUED, {recipient: '0x1111111111111111111111111111111111111234'}))).toThrow(/is for/);
    expect(() => judgeAttestation(base, q(ISSUED, {uid: '0x' + '11'.repeat(32)}))).toThrow(/answered attestation/);
    expect(() => judgeAttestation(base, q(ISSUED, {schemaUid: '0x' + '22'.repeat(32)}))).toThrow(/is schema/);
    expect(judgeAttestation(base, q(ISSUED, {schemaUid: SCHEMA.toUpperCase().replace('0X', '0x')})).uid).toBe(UID);
  });
  it('every refusal has a modal code', () => {
    expect(ATTESTATION_REFUSAL_CODE).toEqual({missing: 'E2007', revoked: 'E2025', expired: 'E2026', other_wallet: 'E2007', wrong_schema: 'E2007', lookup: 'E3002'});
  });
});

describe('reading the record from the chain', () => {
  it('decodes the real GIWA answer: live before 2026-11-12, expired after', async () => {
    const live = await requireLiveAttestation({rpcUrl: 'https://rpc.test', eas: EAS, uid: UID, recipient: WALLET, schemaUid: SCHEMA, nowSeconds: EXPIRES - 60, fetchImpl: rpcAnswer(REAL_ANSWER)}, noLog);
    expect(live).toEqual({uid: UID, expirationTime: EXPIRES, time: ISSUED});
    const e = await refusal(requireLiveAttestation({rpcUrl: 'https://rpc.test', eas: EAS, uid: UID, recipient: WALLET, nowSeconds: 1795763969, fetchImpl: rpcAnswer(REAL_ANSWER)}, noLog));
    expect(e.kind).toBe('expired');
  });
  it('asks eth_call getAttestation(uid) on the EAS contract at latest', async () => {
    const f = rpcAnswer(REAL_ANSWER);
    await requireLiveAttestation({rpcUrl: 'https://rpc.test', eas: EAS, uid: UID, recipient: WALLET, nowSeconds: ISSUED, fetchImpl: f}, noLog);
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('https://rpc.test');
    const body = JSON.parse(init.body);
    expect(body.method).toBe('eth_call');
    expect(body.params[1]).toBe('latest');
    expect(body.params[0].to).toBe(EAS);
    expect(body.params[0].data).toBe('0xa3112a64' + UID.slice(2));
  });
  it('a lookup that does not finish is E3002, never "live" or "revoked"', async () => {
    const cases: Array<typeof fetch> = [
      rpcAnswer(null, {status: 503}),
      rpcAnswer(null, {error: {message: 'execution reverted'}}),
      rpcAnswer(undefined),
      rpcAnswer('0x1234'),
      jest.fn(async () => { throw new Error('Network request failed'); }) as unknown as typeof fetch,
    ];
    for (const fetchImpl of cases) {
      const e = await refusal(requireLiveAttestation({rpcUrl: 'https://rpc.test', eas: EAS, uid: UID, recipient: WALLET, nowSeconds: ISSUED, fetchImpl}, noLog));
      expect(e.kind).toBe('lookup');
      expect(e.code).toBe('E3002');
    }
  });
  it('refuses a malformed uid without asking the chain', async () => {
    const f = rpcAnswer(REAL_ANSWER);
    for (const uid of ['', '0x', '0x' + '1'.repeat(63), UID + '00', 'not-hex', "0x' OR 1=1"]) {
      const e = await refusal(requireLiveAttestation({rpcUrl: 'https://rpc.test', eas: EAS, uid, recipient: WALLET, fetchImpl: f}, noLog));
      expect(e.kind).toBe('missing');
    }
    expect((f as unknown as jest.Mock).mock.calls).toHaveLength(0);
  });
});

describe("finding the uid in an issuance's receipt", () => {
  const recipientTopic = ethers.utils.hexZeroPad(WALLET, 32).toLowerCase();
  const attested = {address: EAS, topics: ['0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35', recipientTopic], data: UID};
  it('the Attested event from EAS for this wallet', () => {
    expect(attestedUidInReceipt([{address: '0x' + '9'.repeat(40), topics: [], data: '0x'}, attested], EAS, WALLET)).toBe(UID);
  });
  it('none from another contract, another wallet, or another event', () => {
    expect(attestedUidInReceipt([{...attested, address: '0x' + '9'.repeat(40)}], EAS, WALLET)).toBeNull();
    expect(attestedUidInReceipt([attested], EAS, '0x1111111111111111111111111111111111111234')).toBeNull();
    expect(attestedUidInReceipt([{...attested, topics: ['0x' + 'ab'.repeat(32), recipientTopic]}], EAS, WALLET)).toBeNull();
    expect(attestedUidInReceipt([{...attested, data: '0x1234'}], EAS, WALLET)).toBeNull();
    expect(attestedUidInReceipt([], EAS, WALLET)).toBeNull();
  });
});
