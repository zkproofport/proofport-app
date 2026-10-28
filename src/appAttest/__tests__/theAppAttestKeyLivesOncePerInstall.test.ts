/**
 * The App Attest key's lifecycle, against a fake DCAppAttestService that
 * produces real-shaped objects (syntheticAppAttest.ts).
 *
 * Apple's rules (developer.apple.com/documentation/devicecheck): attest once
 * per key; on serverUnavailable retry with the same key and clientDataHash; on
 * any other attestation error start over with a new key; keys do not survive
 * reinstall, migration or restore; invalidKey means the key is gone.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
// The mocked module's own objects, mutated per test (a factory runs before
// this file's top-level constants exist, so it cannot close over them).
const rn = jest.requireMock('react-native') as {NativeModules: Record<string, unknown>; Platform: {OS: string}};
const mockPlatform = rn.Platform;
const mockNativeModules = rn.NativeModules;
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import {
  __resetAppAttestKeyForTests,
  APP_ATTEST_KEY_STORAGE,
  assertClientData,
  attestClientDataHash,
  ensureAttestedKey,
  type KeyStorage,
} from '../appAttestKey';
import {AppAttestError} from '../appAttestError';
import {APP_ATTEST_APP_ID} from '../constants';
import {getAppAttestNative, NATIVE_CODE, type AppAttestNative} from '../nativeAppAttest';
import * as crypto from 'crypto';
import {AAGUID, cbor, ecKey, sha256, syntheticDevice, verifyP1363, type SyntheticDevice} from './syntheticAppAttest';

const rnError = (code: string) => Object.assign(new Error(code), {code});

class MemoryStorage implements KeyStorage {
  map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  async removeItem(k: string) {
    this.map.delete(k);
  }
}

/** A fake service with one synthetic device per generated key. */
function fakeService(opts: {supported?: boolean; aaguid?: Uint8Array} = {}) {
  // One "Apple" CA for every key this fake makes, as on a real phone.
  const ca = ecKey('secp384r1');
  const pin = '0x' + Buffer.from(sha256(ca.x, ca.y)).toString('hex');
  const devices = new Map<string, SyntheticDevice>();
  const attested = new Set<string>();
  const counters = new Map<string, number>();
  const calls = {generateKey: 0, attestKey: [] as Array<[string, string]>, generateAssertion: 0};
  const failNext: {attest?: string[]; assert?: string[]} = {attest: [], assert: []};
  const native: AppAttestNative = {
    isSupported: async () => opts.supported ?? true,
    generateKey: async () => {
      calls.generateKey++;
      const d = syntheticDevice(APP_ATTEST_APP_ID, ca);
      devices.set(d.keyId, d);
      return d.keyId;
    },
    attestKey: async (keyId, cdhB64) => {
      calls.attestKey.push([keyId, cdhB64]);
      const f = failNext.attest!.shift();
      if (f) throw rnError(f);
      const d = devices.get(keyId);
      if (!d || attested.has(keyId)) throw rnError(NATIVE_CODE.invalidKey);
      attested.add(keyId);
      return Buffer.from(d.attestation(new Uint8Array(Buffer.from(cdhB64, 'base64')), {aaguid: opts.aaguid})).toString('base64');
    },
    generateAssertion: async (keyId, hashB64) => {
      calls.generateAssertion++;
      const f = failNext.assert!.shift();
      if (f) throw rnError(f);
      const d = devices.get(keyId);
      if (!d || !attested.has(keyId)) throw rnError(NATIVE_CODE.invalidKey);
      const n = (counters.get(keyId) ?? 0) + 1;
      counters.set(keyId, n);
      // The fake signs the hash it was given, as the Secure Enclave does: we
      // pass SHA256(clientData), and the device hashes authData || that.
      return Buffer.from(assertionOverHash(d, new Uint8Array(Buffer.from(hashB64, 'base64')), n)).toString('base64');
    },
  };
  return {native, devices, calls, failNext, pin, forget: (keyId: string) => devices.delete(keyId)};
}

/** syntheticDevice.assertion takes clientData; this one takes its hash. */
function assertionOverHash(d: SyntheticDevice, clientDataHash: Uint8Array, counter: number): Uint8Array {
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter);
  const authData = new Uint8Array([...sha256(new Uint8Array(Buffer.from(APP_ATTEST_APP_ID))), 0, ...c]);
  const nonce = sha256(authData, clientDataHash);
  const sig = new Uint8Array(crypto.sign('sha256', nonce, {key: d.cred.privateKey, dsaEncoding: 'der'}));
  return cbor(new Map<string, unknown>([['signature', sig], ['authenticatorData', authData]]));
}

function setup(opts: {supported?: boolean; aaguid?: Uint8Array} = {}) {
  __resetAppAttestKeyForTests();
  const svc = fakeService(opts);
  const storage = new MemoryStorage();
  const logs: string[] = [];
  const deps = () => ({native: svc.native, storage, log: (m: string) => logs.push(m), pinnedCaKeyHash: svc.pin});
  return {svc, storage, logs, deps};
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppAttestError ? e.code : String(e);
  }
  return 'ok';
};

describe('the key', () => {
  it('is refused on a device without App Attest (the simulator) before any key is made', async () => {
    const {svc, deps} = setup({supported: false});
    expect(await code(ensureAttestedKey(deps()))).toBe('E2009');
    expect(svc.calls.generateKey).toBe(0);
  });

  it('is generated and attested once, then reused', async () => {
    const {svc, storage, deps} = setup();
    const first = await ensureAttestedKey(deps());
    const second = await ensureAttestedKey(deps());
    expect(second.keyId).toBe(first.keyId);
    expect(svc.calls.generateKey).toBe(1);
    expect(svc.calls.attestKey).toHaveLength(1);
    const stored = JSON.parse((await storage.getItem(APP_ATTEST_KEY_STORAGE))!);
    expect(stored.keyId).toBe(first.keyId);
    expect(typeof stored.attestation).toBe('string');
  });

  it('is attested with the clientDataHash derived from its id, 32 bytes', async () => {
    const {svc, deps} = setup();
    const k = await ensureAttestedKey(deps());
    const [, cdh] = svc.calls.attestKey[0];
    expect(cdh).toBe(Buffer.from(attestClientDataHash(k.keyId)).toString('base64'));
    expect(Buffer.from(cdh, 'base64')).toHaveLength(32);
  });

  it('is attested ONCE when two proofs start together', async () => {
    const {svc, deps} = setup();
    const [a, b] = await Promise.all([ensureAttestedKey(deps()), ensureAttestedKey(deps())]);
    expect(a.keyId).toBe(b.keyId);
    expect(svc.calls.generateKey).toBe(1);
    expect(svc.calls.attestKey).toHaveLength(1);
  });

  it('survives Apple being unreachable: E3006, then the SAME key and hash are retried', async () => {
    const {svc, deps} = setup();
    svc.failNext.attest = [NATIVE_CODE.serverUnavailable];
    expect(await code(ensureAttestedKey(deps()))).toBe('E3006');
    await ensureAttestedKey(deps());
    expect(svc.calls.generateKey).toBe(1);
    expect(svc.calls.attestKey).toHaveLength(2);
    expect(svc.calls.attestKey[1]).toEqual(svc.calls.attestKey[0]);
  });

  it('starts over with a new key after any other attestation failure', async () => {
    const {svc, deps} = setup();
    svc.failNext.attest = [NATIVE_CODE.unknownFailure];
    expect(await code(ensureAttestedKey(deps()))).toBe('E2014');
    await ensureAttestedKey(deps());
    expect(svc.calls.generateKey).toBe(2);
    expect(svc.calls.attestKey[1][0]).not.toBe(svc.calls.attestKey[0][0]);
  });

  it('replaces a key that was already attested but never saved (invalidKey on attest)', async () => {
    const {svc, storage, deps} = setup();
    svc.failNext.attest = [NATIVE_CODE.invalidKey];
    const k = await ensureAttestedKey(deps());
    expect(svc.calls.generateKey).toBe(2);
    expect(JSON.parse((await storage.getItem(APP_ATTEST_KEY_STORAGE))!).keyId).toBe(k.keyId);
  });

  it('is regenerated after a reinstall (storage empty)', async () => {
    const {svc, storage, deps} = setup();
    await ensureAttestedKey(deps());
    await storage.removeItem(APP_ATTEST_KEY_STORAGE); // uninstall deletes AsyncStorage
    await ensureAttestedKey(deps());
    expect(svc.calls.generateKey).toBe(2);
  });

  it('discards an unreadable record and makes a new key', async () => {
    const {svc, storage, deps} = setup();
    await storage.setItem(APP_ATTEST_KEY_STORAGE, '{not json');
    await ensureAttestedKey(deps());
    expect(svc.calls.generateKey).toBe(1);
  });

  it('reports the environment from the AAGUID: production and development', async () => {
    const prod = setup({aaguid: AAGUID.production});
    expect((await ensureAttestedKey(prod.deps())).credential.production).toBe(true);
    const dev = setup({aaguid: AAGUID.development});
    expect((await ensureAttestedKey(dev.deps())).credential.production).toBe(false);
  });

  it('refuses an AAGUID that is neither (e.g. "appattestsandbox") with E2014', async () => {
    const {deps, storage} = setup({aaguid: AAGUID.sandbox});
    expect(await code(ensureAttestedKey(deps()))).toBe('E2014');
    expect(await storage.getItem(APP_ATTEST_KEY_STORAGE)).toBeNull();
  });
});

describe('an assertion', () => {
  const clientData = new Uint8Array(225).fill(7);

  it('is signed by the attested key over SHA256(SHA256(authData || SHA256(clientData)))', async () => {
    const {deps, svc} = setup();
    const r = await assertClientData(deps(), clientData);
    const device = svc.devices.get(r.keyId)!;
    const nonce = sha256(r.assertion.authenticatorData, sha256(clientData));
    expect(verifyP1363(device.cred, nonce, r.assertion.signature)).toBe(true);
    expect(r.assertion.counter).toBe(1);
  });

  it('replaces a key Apple no longer knows (restore from backup) and retries once', async () => {
    const {deps, svc} = setup();
    const k = await ensureAttestedKey(deps());
    svc.forget(k.keyId);
    const r = await assertClientData(deps(), clientData);
    expect(r.keyId).not.toBe(k.keyId);
    expect(svc.calls.generateKey).toBe(2);
  });

  it('gives up with E2014 when even a fresh key is refused', async () => {
    const {deps, svc} = setup();
    svc.failNext.assert = [NATIVE_CODE.invalidKey, NATIVE_CODE.invalidKey];
    expect(await code(assertClientData(deps(), clientData))).toBe('E2014');
  });
});

describe('the native module', () => {
  afterEach(() => {
    mockPlatform.OS = 'ios';
    delete mockNativeModules.AppAttest;
  });

  it('is never asked for on Android: doing so throws, naming the Android signer, with no modal code', () => {
    mockPlatform.OS = 'android';
    mockNativeModules.AppAttest = {};
    expect(() => getAppAttestNative()).toThrow(/App Attest is iOS-only; this is android\. The Android signer is src\/androidAttest\/androidSigner\.ts/);
    try {
      getAppAttestNative();
    } catch (e) {
      expect(e).not.toBeInstanceOf(AppAttestError);
    }
  });

  it('missing from an iOS build is E2009, not a crash', () => {
    let c = '';
    try {
      getAppAttestNative();
    } catch (e) {
      c = (e as AppAttestError).code;
    }
    expect(c).toBe('E2009');
  });
});
