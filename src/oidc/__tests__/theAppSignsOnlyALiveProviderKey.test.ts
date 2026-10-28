/**
 * The app as the OIDC circuit's provider-key signer (App Attest, kind 1).
 *
 * Before sign-in (prepareOidcAppSigner): Android goes to the Android signer
 * (no App Attest module touched; a build without its module -> E2015), no
 * App Attest / simulator -> E2009, a development key -> E2014, each with no assertion and,
 * for the first two, no key made. When signing: a modulus not in the live
 * list -> refused with no assertion; the assertion is asked for over exactly
 * SHA256(statement) and verifies over SHA256(authData || that); a high-s DER
 * signature from the device is put in low form (as for Coinbase KYC v2); a
 * credential under another intermediate -> E2014.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));
const rn = jest.requireMock('react-native') as {NativeModules: Record<string, unknown>; Platform: {OS: string}};

import * as crypto from 'node:crypto';
import {ethers} from 'ethers';
import {__resetAppAttestKeyForTests} from '../../appAttest/appAttestKey';
import {AppAttestError} from '../../appAttest/appAttestError';
import {appSignerInputs, type AppSignerInputs} from '../../appAttest/appSignerInputs';
import {N_P256} from '../../appAttest/constants';
import {sha256, verifyP1363} from '../../appAttest/__tests__/syntheticAppAttest';
import {prepareOidcAppSigner} from '../oidcAppSigner';
import {__setAndroidChainKindForTests} from '../../config/signerPlatform';
import {
  fetchLiveProviderKeys,
  modulusBytes,
  OidcProviderKeyError,
  providerKeyStatement,
  type LiveProviderKeys,
} from '../providerKeyStatement';
import {fakeAppAttest, type FakeAppAttestOptions} from './syntheticOidcSigner';

const rsaN = () =>
  (crypto.generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({format: 'jwk'}) as {n: string}).n;
const N = rsaN();
const OTHER_N = rsaN();
const NOW = 1793000000;

async function liveList(provider: 0 | 1 = 0, keys: unknown[] = [{kid: 'k1', kty: 'RSA', n: N, e: 'AQAB'}]): Promise<LiveProviderKeys> {
  const f = jest.fn(async () => ({ok: true, status: 200, json: async () => ({keys})}));
  return fetchLiveProviderKeys(provider, 'unused', {jwksUrl: 'https://keys.test/jwks', fetchImpl: f as never, nowSeconds: () => NOW});
}

function setup(opts: FakeAppAttestOptions = {}) {
  __resetAppAttestKeyForTests();
  rn.Platform.OS = 'ios';
  const fake = fakeAppAttest(opts);
  const logs: string[] = [];
  const prepare = () =>
    prepareOidcAppSigner(m => logs.push(m), {native: fake.native, keyDeps: fake.keyDeps, nowSeconds: () => NOW});
  return {fake, logs, prepare};
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppAttestError || e instanceof OidcProviderKeyError ? e.code : `not ours: ${String(e)}`;
  }
  return 'ok';
};

describe('before sign-in', () => {
  afterEach(() => {
    rn.Platform.OS = 'ios';
    delete rn.NativeModules.AppAttest;
  });

  it('uses the Android signer on Android, touching no App Attest module', async () => {
    rn.Platform.OS = 'android';
    const native = {isSupported: jest.fn(), generateKey: jest.fn(), attestKey: jest.fn(), generateAssertion: jest.fn()};
    rn.NativeModules.AppAttest = native;
    const android = {attestAndSign: jest.fn(), requestIntegrityToken: jest.fn()};
    rn.NativeModules.AndroidKeyAttestation = android;
    __resetAppAttestKeyForTests();
    // The chain kind is already known (kept from an earlier proof): no probe key.
    __setAndroidChainKindForTests('android');
    const logs: string[] = [];
    const sign = await prepareOidcAppSigner(m => logs.push(m));
    expect(typeof sign).toBe('function');
    expect(logs.join('\n')).toMatch(/AndroidAttest/);
    expect(native.isSupported).not.toHaveBeenCalled();
    expect(native.generateKey).not.toHaveBeenCalled();
    expect(native.generateAssertion).not.toHaveBeenCalled();
    // Nothing is signed before the sign-in: the key is made per statement.
    expect(android.attestAndSign).not.toHaveBeenCalled();
    delete rn.NativeModules.AndroidKeyAttestation;
    __setAndroidChainKindForTests(null);
  });

  it('refuses an Android build without the AndroidKeyAttestation module with E2015, before any sign-in', async () => {
    rn.Platform.OS = 'android';
    expect(await codeOf(prepareOidcAppSigner(() => {}))).toBe('E2015');
  });

  it('throws, naming it, for a platform with no signer', async () => {
    rn.Platform.OS = 'web';
    expect(await codeOf(prepareOidcAppSigner(() => {}))).toMatch(/not ours: Error: No statement signer for platform 'web'/);
  });

  it('refuses an iOS build without the native module with E2009', async () => {
    __resetAppAttestKeyForTests();
    expect(await codeOf(prepareOidcAppSigner(() => {}))).toBe('E2009');
  });

  it('refuses a device without App Attest (the simulator) with E2009, and makes no key', async () => {
    const {fake, prepare} = setup({supported: false});
    expect(await codeOf(prepare())).toBe('E2009');
    expect(fake.calls.generateKey).toBe(0);
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });

  it('refuses a development (sandbox) key with E2014, and signs nothing', async () => {
    const {fake, prepare} = setup({development: true});
    expect(await codeOf(prepare())).toBe('E2014');
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });

  it('refuses a credential under another intermediate than the pinned one with E2014', async () => {
    const {fake, prepare} = setup({pinOtherCa: true});
    expect(await codeOf(prepare())).toBe('E2014');
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });

  it('certifies the key once and is ready to sign', async () => {
    const {fake, prepare} = setup();
    await prepare();
    expect(fake.calls.attestKey).toBe(1);
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });
});

describe('signing', () => {
  it('asks App Attest for exactly SHA256(statement), and the assertion verifies over it', async () => {
    const {fake, prepare} = setup();
    const sign = await prepare();
    const live = await liveList(1);
    const modulus = modulusBytes(N);
    const out = (await sign({provider: 1, now: NOW, modulus, live})) as AppSignerInputs;

    const statement = providerKeyStatement(1, NOW, modulus);
    expect(fake.calls.assertionHashes).toEqual([Buffer.from(sha256(statement)).toString('base64')]);
    expect(out.signer_kind).toBe(1);
    const authData = out.assertion_auth_data.slice(0, out.assertion_auth_data_len);
    const nonce = sha256(authData, sha256(statement));
    expect(verifyP1363(fake.device.cred, nonce, out.statement_sig)).toBe(true);
    // ...and over nothing else: not the bare statement, not another provider's.
    expect(verifyP1363(fake.device.cred, sha256(authData, statement), out.statement_sig)).toBe(false);
    expect(verifyP1363(fake.device.cred, sha256(authData, sha256(providerKeyStatement(0, NOW, modulus))), out.statement_sig)).toBe(false);
  });

  it('puts a high-s device signature in low form, as for Coinbase KYC v2', async () => {
    const {fake, prepare} = setup({highS: true});
    const sign = await prepare();
    const out = (await sign({provider: 0, now: NOW, modulus: modulusBytes(N), live: await liveList(0)})) as AppSignerInputs;
    const s = BigInt(ethers.utils.hexlify(out.statement_sig.slice(32)));
    expect(s <= N_P256 / 2n).toBe(true);
    const authData = out.assertion_auth_data.slice(0, out.assertion_auth_data_len);
    const statement = providerKeyStatement(0, NOW, modulusBytes(N));
    expect(verifyP1363(fake.device.cred, sha256(authData, sha256(statement)), out.statement_sig)).toBe(true);
  });

  it.each([
    ['a modulus the live list does not hold', async () => ({provider: 0 as const, modulus: modulusBytes(OTHER_N), live: await liveList(0)})],
    ['a list fetched for the other provider', async () => ({provider: 0 as const, modulus: modulusBytes(N), live: await liveList(1)})],
    ['a list the app did not fetch', async () => ({provider: 0 as const, modulus: modulusBytes(N), live: {...(await liveList(0))}})],
  ])('refuses %s with E2008, and makes no assertion', async (_l, make) => {
    const {fake, prepare} = setup();
    const sign = await prepare();
    const {provider, modulus, live} = await make();
    expect(await codeOf(sign({provider, now: NOW, modulus, live}))).toBe('E2008');
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });
});

describe('the shared signer inputs (both circuits)', () => {
  it('refuse a raw high-s signature, a development key and another intermediate with E2014', async () => {
    const {fake, prepare} = setup();
    const sign = await prepare();
    await sign({provider: 0, now: NOW, modulus: modulusBytes(N), live: await liveList(0)});
    const parts = fake.rawSignerParts();
    const credential = {
      caKey: new Uint8Array(97),
      caKeyHash: fake.pinnedCaKeyHash,
      credentialTbs: parts.credentialTbs,
      credentialSig: parts.credentialSig,
      attAuthData: parts.attAuthData,
      attClientDataHash: parts.attClientDataHash,
      credentialKey: new Uint8Array(65),
      production: true,
    };
    const low = parts.assertionSig;
    const s = BigInt(ethers.utils.hexlify(low.slice(32)));
    const high = new Uint8Array([...low.slice(0, 32), ...ethers.utils.arrayify(ethers.utils.hexZeroPad('0x' + (N_P256 - s).toString(16), 32))]);
    const assertion = (signature: Uint8Array) => ({authenticatorData: parts.assertionAuthData, signature, counter: 1});

    expect(appSignerInputs(credential, assertion(low), fake.pinnedCaKeyHash).signer_kind).toBe(1);
    const e2014 = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof AppAttestError ? e.code : String(e);
      }
      return 'ok';
    };
    expect(e2014(() => appSignerInputs(credential, assertion(high), fake.pinnedCaKeyHash))).toBe('E2014');
    expect(e2014(() => appSignerInputs({...credential, production: false}, assertion(low), fake.pinnedCaKeyHash))).toBe('E2014');
    expect(e2014(() => appSignerInputs(credential, assertion(low), '0x' + '11'.repeat(32)))).toBe('E2014');
  });
});
