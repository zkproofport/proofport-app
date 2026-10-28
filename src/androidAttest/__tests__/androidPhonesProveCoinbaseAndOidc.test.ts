/**
 * On Android, Coinbase KYC v2 and the OIDC domain proof are made with the
 * Android signer -- the refusal they used to end at (E2010, "not available on
 * Android") is gone, and App Attest is never touched there. On iPhone nothing
 * changed: both still go to App Attest.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
  },
}));
const rn = jest.requireMock('react-native') as {NativeModules: Record<string, unknown>; Platform: {OS: string}};

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ethers} from 'ethers';
import {AppAttestError} from '../../appAttest/appAttestError';
import {COINBASE_ATTESTER, COINBASE_KYC_SCHEMA_UID} from '../../appAttest/clientData';
import {coinbaseRequestDigest, prepareCoinbaseKycStatement} from '../../appAttest/coinbaseKycStatement';
import {prepareOidcAppSigner} from '../../oidc/oidcAppSigner';
import {fetchLiveProviderKeys, modulusBytes, providerKeyStatement} from '../../oidc/providerKeyStatement';
import {GOOGLE_KEY_ATTESTATION_CA1} from '../../utils/androidKeyAttestation';
import vectors from '../../utils/__tests__/fixtures/androidChainVectors.json';
import {isAndroidSignerInputs, isAndroidStatementWitness} from '../androidSignerInputs';
import {ANDROID_CIRCUIT_TRUST} from '../androidSigner';
import {__setAndroidChainKindForTests, knownAndroidChainKind} from '../../config/signerPlatform';

const TEGU = (vectors.cases as unknown as Record<string, {chain: string[]}>)['tegu-sdk36-sb-ec-2026-root'].chain;
const TRUST = {
  ...ANDROID_CIRCUIT_TRUST,
  app: {packageName: 'com.google.android.attestation', signingCertSha256: '103938ee4537e59e8ee792f654504fb8346fc6b346d0bbc4415fc339fcfc8ec1'},
  rootKey: GOOGLE_KEY_ATTESTATION_CA1,
};
const NO_INTEGRITY = {decrypt: async (): Promise<never> => {
  throw new Error('an RKP chain asked for a Play Integrity verdict');
}};
const NOW = Date.UTC(2026, 2, 1) / 1000;
const WALLET = ethers.Wallet.createRandom().address;
const UID = '0x' + 'ab'.repeat(32);
const KEY = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});

function fakeAndroid() {
  const signed: Uint8Array[] = [];
  return {
    signed,
    native: {
      attestAndSign: jest.fn(async (b64: string) => {
        const statement = Buffer.from(b64, 'base64');
        signed.push(Uint8Array.from(statement));
        return {chain: TEGU, signature: crypto.sign('sha256', statement, KEY.privateKey).toString('base64'), strongBox: true, sdkInt: 36};
      }),
      requestIntegrityToken: jest.fn(async () => {
        throw new Error('an RKP chain asked for a Play Integrity token');
      }),
    },
  };
}

const appAttestSpy = () => ({isSupported: jest.fn(), generateKey: jest.fn(), attestKey: jest.fn(), generateAssertion: jest.fn()});
const fetchStatus = jest.fn(async (uid: string) => ({uid, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET, revoked: false}));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppAttestError ? e.code : `not ours: ${String(e)}`;
  }
  return 'ok';
}

beforeEach(() => {
  __setAndroidChainKindForTests(null);
  mockDisk.clear();
  rn.Platform.OS = 'android';
  rn.NativeModules.AppAttest = appAttestSpy();
  delete rn.NativeModules.AndroidKeyAttestation;
  fetchStatus.mockClear();
});

describe('Coinbase KYC v2 on Android', () => {
  it('signs the 225-byte clientData with the Android key, at attested_at, and never asks App Attest', async () => {
    const android = fakeAndroid();
    const w = await prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {android: {native: android.native as never, trust: TRUST, integrity: NO_INTEGRITY}, revocation: {fetchStatus, now: () => NOW}},
    );
    expect(isAndroidStatementWitness(w)).toBe(true);
    if (!isAndroidStatementWitness(w)) return;
    expect(w.attestedAt).toBe(NOW);
    expect(w.clientData).toHaveLength(225);
    expect(android.signed).toEqual([w.clientData]);
    expect(ethers.utils.hexlify(w.clientData.slice(161, 193))).toBe(coinbaseRequestDigest(WALLET, 'scope').toLowerCase());
    expect(isAndroidSignerInputs(w.signer)).toBe(true);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    const appAttest = rn.NativeModules.AppAttest as ReturnType<typeof appAttestSpy>;
    expect(appAttest.isSupported).not.toHaveBeenCalled();
    expect(appAttest.generateAssertion).not.toHaveBeenCalled();
  });

  it('a revoked verification is refused (E2011) and nothing is signed', async () => {
    const android = fakeAndroid();
    fetchStatus.mockResolvedValueOnce({uid: UID, schemaId: COINBASE_KYC_SCHEMA_UID, attester: COINBASE_ATTESTER, recipient: WALLET, revoked: true});
    expect(await codeOf(prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {android: {native: android.native as never, trust: TRUST, integrity: NO_INTEGRITY}, revocation: {fetchStatus, now: () => NOW}},
    ))).toBe('E2011');
    expect(android.signed).toEqual([]);
  });

  it('with the real trust anchors, a chain for another app is E2015 -- not E2010', async () => {
    rn.NativeModules.AndroidKeyAttestation = fakeAndroid().native;
    expect(await codeOf(prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {revocation: {fetchStatus, now: () => NOW}},
    ))).toBe('E2015');
  });

  it('a build without the native module is E2015, before any lookup', async () => {
    expect(await codeOf(prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {revocation: {fetchStatus, now: () => NOW}},
    ))).toBe('E2015');
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('on iPhone the same call still goes to App Attest (E2009 without its module), never to Android', async () => {
    rn.Platform.OS = 'ios';
    delete rn.NativeModules.AppAttest;
    const android = fakeAndroid();
    rn.NativeModules.AndroidKeyAttestation = android.native;
    expect(await codeOf(prepareCoinbaseKycStatement(
      {walletAddress: WALLET, attestationUid: UID, scopeString: 'scope', log: () => {}},
      {revocation: {fetchStatus, now: () => NOW}},
    ))).toBe('E2009');
    expect(android.native.attestAndSign).not.toHaveBeenCalled();
  });
});

describe('the OIDC provider-key statement on Android', () => {
  const N = (crypto.generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({format: 'jwk'}) as {n: string}).n;

  it('signs exactly the 313-byte statement for the public provider and now', async () => {
    const android = fakeAndroid();
    const sign = await prepareOidcAppSigner(() => {}, {android: {native: android.native as never, trust: TRUST, integrity: NO_INTEGRITY}, nowSeconds: () => NOW});
    const f = jest.fn(async () => ({ok: true, status: 200, json: async () => ({keys: [{kid: 'k', kty: 'RSA', n: N, e: 'AQAB'}]})}));
    const live = await fetchLiveProviderKeys(0, 'unused', {jwksUrl: 'https://keys.test/jwks', fetchImpl: f as never, nowSeconds: () => NOW});
    // Before sign-in: one probe key, to learn which circuit's files to fetch.
    expect(knownAndroidChainKind()).toBe('android');
    expect(android.signed).toHaveLength(1);
    const out = await sign({provider: 0, now: NOW, modulus: modulusBytes(N), live});
    expect(isAndroidSignerInputs(out)).toBe(true);
    expect(android.signed.slice(1)).toEqual([providerKeyStatement(0, NOW, modulusBytes(N))]);
    expect(android.signed[1]).toHaveLength(313);
  });

  it('refuses a modulus the live list does not hold, signing nothing', async () => {
    const android = fakeAndroid();
    const sign = await prepareOidcAppSigner(() => {}, {android: {native: android.native as never, trust: TRUST, integrity: NO_INTEGRITY}, nowSeconds: () => NOW});
    const f = jest.fn(async () => ({ok: true, status: 200, json: async () => ({keys: [{kid: 'k', kty: 'RSA', n: N, e: 'AQAB'}]})}));
    const live = await fetchLiveProviderKeys(0, 'unused', {jwksUrl: 'https://keys.test/jwks', fetchImpl: f as never, nowSeconds: () => NOW});
    const other = (crypto.generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({format: 'jwk'}) as {n: string}).n;
    const probes = android.signed.length;
    await expect(sign({provider: 0, now: NOW, modulus: modulusBytes(other), live})).rejects.toThrow();
    expect(android.signed).toHaveLength(probes);
  });
});

describe('E2010 is gone', () => {
  it('from the error codes, both locales and every source file', () => {
    const src = path.join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.(tsx?|json)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('E2010')) {
          offenders.push(path.relative(src, p));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });

  it('E2015 and E2016 have English and Korean text with no "not yet" wording', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {ErrorCodes} = require('../../constants/errorCodes');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require('../../i18n/locales/en.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ko = require('../../i18n/locales/ko.json');
    for (const code of ['E2015', 'E2016']) {
      expect(ErrorCodes[code].code).toBe(code);
      const find = (o: unknown): {title: string; description: string} | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        const rec = o as Record<string, unknown>;
        if (rec[code] && typeof rec[code] === 'object' && 'title' in (rec[code] as object)) return rec[code] as {title: string; description: string};
        for (const v of Object.values(rec)) {
          const f = find(v);
          if (f) return f;
        }
        return undefined;
      };
      for (const [locale, text] of [['en', find(en)], ['ko', find(ko)]] as const) {
        expect([locale, typeof text?.title, typeof text?.description]).toEqual([locale, 'string', 'string']);
        expect(`${text!.title} ${text!.description}`).not.toMatch(/not yet|아직|미지원|지원하지 않/i);
      }
    }
  });
});
