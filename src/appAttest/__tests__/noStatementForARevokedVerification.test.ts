/**
 * The statement is made only after a fresh lookup finds THIS wallet's Coinbase
 * verification unrevoked. Every other answer -- revoked, missing, another
 * wallet's, a lookup that did not finish -- ends with an ErrorModal code and
 * no assertion at all.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import {ethers} from 'ethers';
import {__resetAppAttestKeyForTests, type KeyStorage} from '../appAttestKey';
import {AppAttestError} from '../appAttestError';
import {COINBASE_ATTESTER, COINBASE_KYC_SCHEMA_UID} from '../clientData';
import {APP_ATTEST_APP_ID} from '../constants';
import {coinbaseRequestDigest, prepareCoinbaseKycStatement} from '../coinbaseKycStatement';
import {
  checkStatementAge,
  fetchAttestationStatus,
  STATEMENT_MAX_AGE_SECONDS,
  type AttestationStatus,
} from '../revocationStatement';
import type {AppAttestNative} from '../nativeAppAttest';
import * as crypto from 'crypto';
import {cbor, ecKey, sha256, syntheticDevice, verifyP1363} from './syntheticAppAttest';

const WALLET = '0x5a7D0f4ecc8bBFDE105ab34c1a5d1A2f4372580F';
const UID = '0x' + 'ab'.repeat(32);
const NOW = 1792740823;

function harness(opts: {supported?: boolean} = {}) {
  __resetAppAttestKeyForTests();
  const ca = ecKey('secp384r1');
  const device = syntheticDevice(APP_ATTEST_APP_ID, ca);
  const calls = {assert: 0, status: 0};
  const native: AppAttestNative = {
    isSupported: async () => opts.supported ?? true,
    generateKey: async () => device.keyId,
    attestKey: async (_k, cdh) => Buffer.from(device.attestation(new Uint8Array(Buffer.from(cdh, 'base64')))).toString('base64'),
    generateAssertion: async (_k, hash) => {
      calls.assert++;
      // The device signs authData || the hash it is given.
      const c = Buffer.alloc(4);
      c.writeUInt32BE(calls.assert);
      const authData = new Uint8Array([...sha256(new Uint8Array(Buffer.from(APP_ATTEST_APP_ID))), 0, ...c]);
      const nonce = sha256(authData, new Uint8Array(Buffer.from(hash, 'base64')));
      const sig = crypto.sign('sha256', nonce, {key: device.cred.privateKey, dsaEncoding: 'der'});
      return Buffer.from(cbor(new Map<string, unknown>([['signature', new Uint8Array(sig)], ['authenticatorData', authData]]))).toString('base64');
    },
  };
  const storage: KeyStorage = (() => {
    const m = new Map<string, string>();
    return {getItem: async k => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async k => void m.delete(k)};
  })();
  const status = (s: Partial<AttestationStatus> | Error) => async () => {
    calls.status++;
    if (s instanceof Error) throw s;
    return {uid: UID, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET.toLowerCase(), revoked: false, ...s};
  };
  const run = (s: Partial<AttestationStatus> | Error, scopeString = 'proofport') =>
    prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString, log: () => {}},
      {
        native,
        keyDeps: {storage, pinnedCaKeyHash: '0x' + Buffer.from(sha256(ca.x, ca.y)).toString('hex')},
        revocation: {fetchStatus: status(s) as never, now: () => NOW},
      },
    ).catch((e: unknown) => e);
  return {device, calls, run, storage, ca};
}

const codeOf = (e: unknown) => (e instanceof AppAttestError ? e.code : e instanceof Error ? e.message : 'no error');

describe('the revocation statement', () => {
  it('is refused for a REVOKED attestation with E2011, and nothing is signed', async () => {
    const h = harness();
    expect(codeOf(await h.run({revoked: true}))).toBe('E2011');
    expect(h.calls.assert).toBe(0);
  });

  it('is refused for an attestation of another wallet with E2005, and nothing is signed', async () => {
    const h = harness();
    expect(codeOf(await h.run({recipient: '0x' + '11'.repeat(20)}))).toBe('E2005');
    expect(h.calls.assert).toBe(0);
  });

  it('is refused for another schema or another attester with E2005', async () => {
    const h = harness();
    expect(codeOf(await h.run({schemaId: '0x' + '22'.repeat(32)}))).toBe('E2005');
    expect(codeOf(await h.run({attester: '0x' + '33'.repeat(20)}))).toBe('E2005');
    expect(h.calls.assert).toBe(0);
  });

  it('carries a lookup failure through with its own code, and nothing is signed', async () => {
    const h = harness();
    expect(codeOf(await h.run(new AppAttestError('E3002', 'EAS down')))).toBe('E3002');
    expect(h.calls.assert).toBe(0);
  });

  it('is refused on a device without App Attest BEFORE the lookup (E2009)', async () => {
    const h = harness({supported: false});
    expect(codeOf(await h.run({}))).toBe('E2009');
    expect(h.calls.status).toBe(0);
  });

  it('is made for an unrevoked attestation: clientData names wallet, time, request, scope, and the key signed it', async () => {
    const h = harness();
    const w = await h.run({});
    if (w instanceof Error) throw w;
    const cd = (w as {clientData: Uint8Array}).clientData;
    const witness = w as {clientData: Uint8Array; attestedAt: number; assertion: {authenticatorData: Uint8Array; signature: Uint8Array}};
    expect(witness.attestedAt).toBe(NOW);
    expect(ethers.utils.getAddress(ethers.utils.hexlify(cd.slice(48, 68)))).toBe(WALLET);
    expect(cd[160]).toBe(0);
    expect(ethers.utils.hexlify(cd.slice(128, 160))).toBe(UID);
    expect(ethers.utils.hexlify(cd.slice(161, 193))).toBe(coinbaseRequestDigest(WALLET, 'proofport'));
    const nonce = sha256(witness.assertion.authenticatorData, sha256(cd));
    expect(verifyP1363(h.device.cred, nonce, witness.assertion.signature)).toBe(true);
  });
});

describe('the lookup itself', () => {
  const answer = (body: unknown, ok = true, status = 200) =>
    jest.fn(async () => ({ok, status, json: async () => body}));

  it('asks for the one uid, every time (no cache)', async () => {
    const f = answer({data: {attestation: {id: UID, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET, revoked: false}}});
    await fetchAttestationStatus(UID, () => {}, f);
    await fetchAttestationStatus(UID, () => {}, f);
    expect(f).toHaveBeenCalledTimes(2);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, {body: string}])[1].body);
    expect(sent.variables).toEqual({id: UID});
    expect(sent.query).toMatch(/revoked/);
  });

  it('turns HTTP errors, thrown fetches and GraphQL errors into E3002', async () => {
    const c = (p: Promise<unknown>) => p.then(() => 'ok', codeOf);
    expect(await c(fetchAttestationStatus(UID, () => {}, answer({}, false, 503)))).toBe('E3002');
    expect(await c(fetchAttestationStatus(UID, () => {}, jest.fn(async () => { throw new Error('offline'); })))).toBe('E3002');
    expect(await c(fetchAttestationStatus(UID, () => {}, answer({errors: [{message: 'x'}]})))).toBe('E3002');
  });

  it('reads a record without a revoked flag as unknown (E3002), never as unrevoked', async () => {
    const f = answer({data: {attestation: {id: UID, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET}}});
    expect(await fetchAttestationStatus(UID, () => {}, f).then(() => 'ok', codeOf)).toBe('E3002');
  });

  it('reads an unknown uid as "no attestation" (E2005)', async () => {
    expect(await fetchAttestationStatus(UID, () => {}, answer({data: {attestation: null}})).then(() => 'ok', codeOf)).toBe('E2005');
  });

  it('refuses a uid that is not 32 bytes of hex without asking', async () => {
    const f = answer({});
    expect(await fetchAttestationStatus("0x12' OR 1=1", () => {}, f).then(() => 'ok', codeOf)).toBe('E2005');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('a statement that has aged', () => {
  it('is accepted up to the verifier window and refused past it', () => {
    expect(() => checkStatementAge(NOW, NOW + STATEMENT_MAX_AGE_SECONDS)).not.toThrow();
    expect(() => checkStatementAge(NOW, NOW + STATEMENT_MAX_AGE_SECONDS + 1)).toThrow(/600s/);
  });

  it('is refused from the future beyond clock skew', () => {
    expect(() => checkStatementAge(NOW + 61, NOW)).toThrow();
    expect(() => checkStatementAge(NOW + 60, NOW)).not.toThrow();
  });
});
