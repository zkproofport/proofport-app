/**
 * signStatementOnAndroid: one native call per statement, the statement
 * handed over byte for byte, the chain checked before anything is converted,
 * the signature put in low form, and every native failure mapped to its
 * ErrorModal code -- an unknown one included.
 *
 * The native module is a fake returning Google's real tegu chain (made for
 * Google's test app, so the trust anchors here name that app) and a
 * signature over the statement by a throwaway P-256 key: the app does not
 * verify the signature against the leaf (the circuit does), so any P-256
 * DER signature exercises the conversion.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const rn = jest.requireMock('react-native') as {NativeModules: Record<string, unknown>; Platform: {OS: string}};

import * as crypto from 'node:crypto';
import {AppAttestError} from '../../appAttest/appAttestError';
import {N_P256} from '../../appAttest/constants';
import {GOOGLE_KEY_ATTESTATION_CA1, androidChainInputs} from '../../utils/androidKeyAttestation';
import vectors from '../../utils/__tests__/fixtures/androidChainVectors.json';
import {ANDROID_CIRCUIT_TRUST, signStatementOnAndroid} from '../androidSigner';
import {ANDROID_NATIVE_CODE, androidNativeFailure, getAndroidKeyAttestationNative} from '../nativeAndroidKeyAttestation';

const cases = vectors.cases as unknown as Record<string, {chain: string[]}>;
const TEGU = cases['tegu-sdk36-tee-ec-2026-root'].chain;
const TRUST = {
  app: {packageName: 'com.google.android.attestation', signingCertSha256: '103938ee4537e59e8ee792f654504fb8346fc6b346d0bbc4415fc339fcfc8ec1'},
  rootKey: GOOGLE_KEY_ATTESTATION_CA1,
};
const NOW = Date.UTC(2026, 2, 1) / 1000;
const STATEMENT = Uint8Array.from({length: 313}, (_v, i) => (i * 7) & 0xff);
const KEY = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});

function derSignature(highS: boolean): string {
  for (;;) {
    const der = crypto.sign('sha256', Buffer.from(STATEMENT), KEY.privateKey);
    // Read s from the DER and keep trying until it is in the half asked for.
    const rLen = der[3];
    const sLen = der[4 + rLen + 1];
    const s = BigInt('0x' + der.subarray(4 + rLen + 2, 4 + rLen + 2 + sLen).toString('hex'));
    if ((s > N_P256 / 2n) === highS) return der.toString('base64');
  }
}

function fakeNative(result: unknown | (() => Promise<unknown>)) {
  const calls: string[] = [];
  return {
    calls,
    native: {
      attestAndSign: jest.fn(async (b64: string) => {
        calls.push(b64);
        return typeof result === 'function' ? (result as () => Promise<unknown>)() : result;
      }),
    } as never,
  };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppAttestError ? e.code : `not ours: ${String(e)}`;
  }
  return 'ok';
}

describe('a real chain', () => {
  it.each([[false], [true]])('returns the circuit inputs, statement_sig in low form (device s high: %s)', async highS => {
    const signature = derSignature(highS);
    const {native, calls} = fakeNative({chain: TEGU, signature, strongBox: false, sdkInt: 36});
    const logs: string[] = [];
    const out = await signStatementOnAndroid(STATEMENT, {now: NOW, log: m => logs.push(m), native, trust: TRUST});

    expect(calls).toEqual([Buffer.from(STATEMENT).toString('base64')]);
    expect(out.variant).toBe('android');
    const chain = androidChainInputs(TEGU.map(b => Uint8Array.from(Buffer.from(b, 'base64'))), GOOGLE_KEY_ATTESTATION_CA1);
    expect(Buffer.from(out.leaf_tbs).toString('hex')).toBe(Buffer.from(chain.leaf_tbs).toString('hex'));
    expect(out.ca2_tbs_len).toBe(chain.ca2_tbs_len);
    expect(out).not.toHaveProperty('leaf_key');

    expect(out.statement_sig).toHaveLength(64);
    const s = BigInt('0x' + Buffer.from(out.statement_sig.slice(32)).toString('hex'));
    expect(s <= N_P256 / 2n).toBe(true);
    // r || s (low s) verifies under the key that signed: the same signature.
    expect(crypto.verify('sha256', Buffer.from(STATEMENT), {key: KEY.publicKey, dsaEncoding: 'ieee-p1363'}, Buffer.from(out.statement_sig))).toBe(true);

    expect(logs.join('\n')).toMatch(/Key made in the TEE \(SDK 36\); chain of 5 certificates/);
    expect(logs.join('\n')).not.toContain(Buffer.from(STATEMENT).toString('base64'));
  });

  it('refuses, before converting anything, a chain made for another app (the real trust anchors)', async () => {
    const {native} = fakeNative({chain: TEGU, signature: derSignature(false), strongBox: true, sdkInt: 36});
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native, trust: ANDROID_CIRCUIT_TRUST}))).toBe('E2015');
  });

  it('refuses a chain whose attestation key has expired at the statement time', async () => {
    const {native} = fakeNative({chain: TEGU, signature: derSignature(false), strongBox: false, sdkInt: 36});
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: Date.UTC(2026, 5, 1) / 1000, log: () => {}, native, trust: TRUST}))).toBe('E2015');
  });
});

describe('what the native module returns', () => {
  it.each([
    ['an empty chain', {chain: [], signature: 'AA==', strongBox: false, sdkInt: 36}, 'E2015'],
    ['no chain', {signature: 'AA==', strongBox: false, sdkInt: 36}, 'E2016'],
    ['null', null, 'E2016'],
    ['a certificate that is not base64', {chain: ['***', ...TEGU.slice(1)], signature: 'AA==', strongBox: false, sdkInt: 36}, 'E2016'],
    ['a certificate that is an empty string', {chain: ['', ...TEGU.slice(1)], signature: 'AA==', strongBox: false, sdkInt: 36}, 'E2016'],
    ['no signature', {chain: TEGU, strongBox: false, sdkInt: 36}, 'E2016'],
    ['a signature that is not DER', {chain: TEGU, signature: Buffer.from('not a signature').toString('base64'), strongBox: false, sdkInt: 36}, 'E2016'],
    ['a P-384-sized signature', {chain: TEGU, signature: Buffer.from('3066023100' + 'ff'.repeat(48) + '023100' + '7f'.repeat(48), 'hex').toString('base64'), strongBox: false, sdkInt: 36}, 'E2016'],
  ])('%s -> %s', async (_l, result, code) => {
    const {native} = fakeNative(result);
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native, trust: TRUST}))).toBe(code);
  });

  it.each([
    [ANDROID_NATIVE_CODE.unsupported, 'E2015'],
    [ANDROID_NATIVE_CODE.keyGeneration, 'E2015'],
    [ANDROID_NATIVE_CODE.emptyChain, 'E2015'],
    [ANDROID_NATIVE_CODE.signing, 'E2016'],
    [ANDROID_NATIVE_CODE.invalidInput, 'E2016'],
    ['SOMETHING_NEW', 'E2016'],
    [undefined, 'E2016'],
  ])('a native rejection %s -> %s, naming the code', async (nativeCode, code) => {
    const {native} = fakeNative(async () => {
      throw Object.assign(new Error('boom'), {code: nativeCode});
    });
    expect(await codeOf(signStatementOnAndroid(STATEMENT, {now: NOW, log: () => {}, native, trust: TRUST}))).toBe(code);
    expect(androidNativeFailure(Object.assign(new Error('boom'), {code: nativeCode})).message).toContain(String(nativeCode));
  });
});

describe('the native module lookup', () => {
  afterEach(() => {
    rn.Platform.OS = 'android';
    delete rn.NativeModules.AndroidKeyAttestation;
  });

  it('missing from an Android build is E2015, not a crash', () => {
    let code = '';
    try {
      getAndroidKeyAttestationNative();
    } catch (e) {
      code = (e as AppAttestError).code;
    }
    expect(code).toBe('E2015');
  });

  it('is never asked for on iOS', () => {
    rn.Platform.OS = 'ios';
    rn.NativeModules.AndroidKeyAttestation = {attestAndSign: jest.fn()};
    expect(() => getAndroidKeyAttestationNative()).toThrow(/runs on Android only; this is ios/);
  });

  it('is the registered module on Android', () => {
    const mod = {attestAndSign: jest.fn()};
    rn.NativeModules.AndroidKeyAttestation = mod;
    expect(getAndroidKeyAttestationNative()).toBe(mod);
  });
});
