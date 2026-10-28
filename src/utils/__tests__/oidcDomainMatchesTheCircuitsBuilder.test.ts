/**
 * The app's OIDC v2 input builder produces exactly what the circuits repo's
 * reference builder produces for the same token.
 *
 * The reference (`circuits/oidc-domain-attestation/scripts/oidc-inputs.ts`) is
 * the one the circuit's acceptance run proves and verifies with, so agreeing
 * with it byte for byte is how this builder is known to agree with the
 * circuit. It is copied into test-reference/ by
 * scripts/sync-oidc-reference-builder.sh and must stay unedited: the first
 * test compares its sha256 with the one the script recorded.
 *
 * Tokens are synthetic (RS256, a key generated here), shaped like real ones:
 * Google's claim order, a Microsoft work tenant with aud first and a 200-char
 * aio, Korean and emoji in a display name, and headers sized so the
 * header/payload '.' lands at 60, 63, 64 and 102 -- cut 0 / 0 / 64 / 64,
 * offsets 61 / 64 / 1 / 39.
 *
 * The provider-key statement's signer (circuits c970a4c): the app signs
 * through its real App Attest path (prepareOidcAppSigner) against a synthetic
 * device; the reference's `appSigner` is given that device's OWN bytes
 * (certificate TBS, DER signatures converted here), not the app's parse of
 * them. Both vectors, all 3,889 values, must be identical, and the hash the
 * app asked App Attest to sign must be SHA256 of the reference's
 * `providerKeyStatement` for the public provider, now and modulus.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ethers} from 'ethers';
import {
  OIDC_FLAT_INPUT_COUNT,
  OIDC_MAX_PARTIAL_DATA_LENGTH,
  OIDC_PUBLIC_INPUT_COUNT,
  flattenOidcInputs,
  prepareOidcInputs,
  type PrepareOidcParams,
} from '../oidcDomain';
import {deriveOidcNonce} from '../../oidc/oidcNonce';
import {__resetAppAttestKeyForTests} from '../../appAttest/appAttestKey';
import {sha256} from '../../appAttest/__tests__/syntheticAppAttest';
import {prepareOidcAppSigner} from '../../oidc/oidcAppSigner';
import {modulusBytes, PROVIDER_KEY_STATEMENT_LEN} from '../../oidc/providerKeyStatement';
import {fakeAppAttest} from '../../oidc/__tests__/syntheticOidcSigner';

const REF_DIR = path.join(__dirname, '..', '..', '..', 'test-reference', 'circuits');

type RefSigner = {
  signer_kind: number;
  statement_sig: Uint8Array;
  credential_tbs: Uint8Array;
  credential_tbs_len: number;
  credential_sig: Uint8Array;
  att_auth_data: Uint8Array;
  att_auth_data_len: number;
  att_client_data_hash: Uint8Array;
  assertion_auth_data: Uint8Array;
  assertion_auth_data_len: number;
};
type RefModule = {
  MAX_PARTIAL_DATA_LENGTH: number;
  PUBLIC_INPUT_COUNT: number;
  STATEMENT_LEN: number;
  buildInputs: (jwt: string, n: string, opts: Record<string, unknown>) => RefInputs;
  providerKeyStatement: (provider: number, now: bigint, n: string) => Uint8Array;
  modulusBytes: (n: string) => Uint8Array;
  appSigner: (a: Record<string, Uint8Array>) => RefSigner;
  publicInputs: (i: RefInputs) => bigint[];
  deriveNonceBinding: (scope: string, requestId: string) => Uint8Array;
  signJwt: (payloadJson: string, key: crypto.KeyObject, kid?: string) => string;
};
type RefInputs = {
  pubkey_modulus_limbs: bigint[];
  domain: {storage: Uint8Array; len: number};
  scope: Uint8Array;
  nullifier: Uint8Array;
  provider: number;
  aud_hash: Uint8Array;
  nonce_mode: number;
  nonce_binding: Uint8Array;
  now: bigint;
  partial_data: {storage: Uint8Array; len: number};
  partial_hash: Uint32Array;
  full_data_length: number;
  base64_decode_offset: number;
  redc_params_limbs: bigint[];
  signature_limbs: bigint[];
} & RefSigner;

// The reference imports ethers v6's top-level `keccak256`; this app has
// ethers v5, whose keccak256 (same function) lives under `utils`.
let ref!: RefModule;
jest.isolateModules(() => {
  jest.doMock('ethers', () => {
    const actual = jest.requireActual('ethers');
    return {...actual, keccak256: actual.utils.keccak256};
  });
  ref = require(path.join(REF_DIR, 'oidc-inputs.ts'));
});

const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const N = (publicKey.export({format: 'jwk'}) as {n: string}).n;
const JWKS_URL = 'https://keys.test/jwks';

const SCOPE = 'openstoa:community:한국어 🌏';
const REQUEST_ID = '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b';
const NONCE = deriveOidcNonce(SCOPE, REQUEST_ID);
const IAT = 1793000000;
const EXP = IAT + 3600;
const CLOCK = IAT + 120;

let fetchedUrls: string[] = [];
function jwksServes(kid: string) {
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    fetchedUrls.push(url);
    if (url !== JWKS_URL) return {ok: false, status: 404, json: async () => ({})};
    return {ok: true, json: async () => ({keys: [{kid, kty: 'RSA', n: N, e: 'AQAB'}]})};
  });
}

beforeEach(() => {
  fetchedUrls = [];
});

/** A kid whose header puts the '.' at exactly `dot`. */
function kidForDot(dot: number): string {
  for (let len = 1; len < 400; len++) {
    const kid = 'k'.repeat(len);
    const header = Buffer.from(JSON.stringify({alg: 'RS256', kid, typ: 'JWT'})).toString('base64url');
    if (header.length === dot) return kid;
  }
  throw new Error(`no kid gives a ${dot}-character header`);
}

function googlePayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    iss: 'https://accounts.google.com',
    azp: '491923400813-android.apps.googleusercontent.com',
    aud: '491923400813-5bb3upweb.apps.googleusercontent.com',
    sub: '110169484474386276334',
    hd: 'corp.example',
    email: 'alice@corp.example',
    email_verified: true,
    nonce: NONCE,
    name: '앨리스 🦊 Alice',
    iat: IAT,
    exp: EXP,
    ...extra,
  });
}

function microsoftPayload(): string {
  return JSON.stringify({
    aud: '8b09c842-0000-4000-8000-000000000001',
    iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    iat: IAT,
    nbf: IAT,
    exp: EXP,
    aio: 'A'.repeat(200),
    email: 'bob@contoso.example',
    name: 'Bob',
    nonce: NONCE,
    oid: '00000000-0000-0000-66f3-3332eca7ea81',
    preferred_username: 'bob@contoso.example',
    rh: '0.AXEAv4j5cvGGr0GRqy180BHbR0IIC4sAAAAAAAAAAAAAAA.',
    sub: 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ',
    tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    uti: 'fqiBqXLPj0eQa82S-IYFAA',
    ver: '2.0',
    xms_edov: true,
  });
}

const dec = (b: Uint8Array) => Array.from(b, x => String(x));

/** The reference's inputs flattened in the circuit's main() order. */
function refFlat(i: RefInputs): string[] {
  return [
    ...i.pubkey_modulus_limbs.map(String),
    ...dec(i.domain.storage), String(i.domain.len),
    ...dec(i.scope),
    ...dec(i.nullifier),
    String(i.provider),
    ...dec(i.aud_hash),
    String(i.nonce_mode),
    ...dec(i.nonce_binding),
    i.now.toString(),
    ...dec(i.partial_data.storage), String(i.partial_data.len),
    ...Array.from(i.partial_hash, x => String(x >>> 0)),
    String(i.full_data_length),
    String(i.base64_decode_offset),
    ...i.redc_params_limbs.map(String),
    ...i.signature_limbs.map(String),
    String(i.signer_kind),
    ...dec(i.statement_sig),
    ...dec(i.credential_tbs), String(i.credential_tbs_len),
    ...dec(i.credential_sig),
    ...dec(i.att_auth_data), String(i.att_auth_data_len),
    ...dec(i.att_client_data_hash),
    ...dec(i.assertion_auth_data), String(i.assertion_auth_data_len),
  ];
}

const PROVIDER_ID = {google: 0, microsoft: 1} as const;

/** The app's real App Attest signer over a synthetic device, and a spy on it. */
async function appSigner() {
  __resetAppAttestKeyForTests();
  const fake = fakeAppAttest();
  const signer = await prepareOidcAppSigner(() => {}, {native: fake.native, keyDeps: fake.keyDeps});
  return {fake, sign: jest.fn(signer)};
}

async function both(jwt: string, provider: 'google' | 'microsoft', kid: string, extra: Partial<PrepareOidcParams> = {}) {
  jwksServes(kid);
  const {fake, sign} = await appSigner();
  const app = await prepareOidcInputs({
    jwt, scope: SCOPE, provider, nonce: NONCE, clockSeconds: CLOCK, jwksUrl: JWKS_URL, signProviderKey: sign, ...extra,
  });
  const reference = ref.buildInputs(jwt, N, {
    provider: PROVIDER_ID[provider],
    scope: SCOPE,
    nonceMode: 1,
    nonceBinding: ref.deriveNonceBinding(SCOPE, REQUEST_ID),
    now: BigInt(CLOCK),
    signer: ref.appSigner(fake.rawSignerParts()),
  });
  return {app, reference, fake, sign};
}

describe('the vendored reference builder', () => {
  it('is byte-identical to the circuits copy recorded by the sync script', () => {
    const source = fs.readFileSync(path.join(REF_DIR, 'SOURCE'), 'utf8');
    const recorded = /^sha256 ([0-9a-f]{64})$/m.exec(source)?.[1];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(REF_DIR, 'oidc-inputs.ts'))).digest('hex');
    expect(recorded).toBe(actual);
  });

  it('agrees with the app on the circuit constants', () => {
    expect(ref.STATEMENT_LEN).toBe(PROVIDER_KEY_STATEMENT_LEN);
    expect(ref.MAX_PARTIAL_DATA_LENGTH).toBe(OIDC_MAX_PARTIAL_DATA_LENGTH);
    expect(ref.PUBLIC_INPUT_COUNT).toBe(OIDC_PUBLIC_INPUT_COUNT);
    expect(OIDC_PUBLIC_INPUT_COUNT).toBe(214);
    expect(OIDC_MAX_PARTIAL_DATA_LENGTH).toBe(2048);
  });

  it("derives the same nonce binding as the app's nonce", () => {
    expect(ethers.utils.hexlify(ref.deriveNonceBinding(SCOPE, REQUEST_ID)).slice(2)).toBe(NONCE);
  });
});

describe('identical input vectors for the same token', () => {
  it.each([
    ['Google, synthetic header (dot 60)', 60, 'google', googlePayload(), 0, 61],
    ['Google, dot 63 -> offset 64', 63, 'google', googlePayload(), 0, 64],
    ['Google, dot 64 -> offset 1', 64, 'google', googlePayload(), 64, 1],
    ['Google, 40-hex kid like a real token (dot 102)', 102, 'google', googlePayload(), 64, 39],
    ['Google, accounts.google.com spelling', 102, 'google', googlePayload({iss: 'accounts.google.com'}), 64, 39],
    ['Microsoft work tenant, aud first, 200-char aio', 102, 'microsoft', microsoftPayload(), 64, 39],
  ] as const)('%s', async (_label, dot, provider, payload, cut, offset) => {
    const kid = kidForDot(dot);
    const jwt = ref.signJwt(payload, privateKey, kid);
    const {app, reference, fake, sign} = await both(jwt, provider, kid);

    const flat = flattenOidcInputs(app);
    expect(flat).toHaveLength(OIDC_FLAT_INPUT_COUNT);
    expect(flat).toEqual(refFlat(reference));
    // Exactly one statement, signed over SHA256 of the reference's bytes for
    // the PUBLIC provider and now: byte 48 = flat[147], bytes 49..57 = flat[213].
    const statement = ref.providerKeyStatement(PROVIDER_ID[provider], BigInt(CLOCK), N);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(fake.calls.assertionHashes).toEqual([Buffer.from(sha256(statement)).toString('base64')]);
    expect(String(statement[48])).toBe(flat[147]);
    expect(BigInt('0x' + Buffer.from(statement.slice(49, 57)).toString('hex')).toString()).toBe(flat[213]);
    expect(flat[214 + 2095]).toBe('1'); // signer_kind: app
    expect(flat.slice(0, OIDC_PUBLIC_INPUT_COUNT)).toEqual(ref.publicInputs(reference).map(String));
    expect(app.base64_decode_offset).toBe(offset);
    expect(app.full_data_length - app.partial_data.len).toBe(cut);
    expect(app.nonce_mode).toBe(1);
    expect(app.now).toBe(String(CLOCK));
    expect(fetchedUrls).toEqual([JWKS_URL]);
  });

  it('flattens to 214 public values then the private ones, in main() order', async () => {
    const kid = kidForDot(102);
    const {app} = await both(ref.signJwt(googlePayload(), privateKey, kid), 'google', kid);
    const flat = flattenOidcInputs(app);
    expect(flat).toHaveLength(214 + (2048 + 1) + 8 + 1 + 1 + 18 + 18 + (1 + 64 + 1000 + 1 + 96 + 256 + 1 + 32 + 128 + 1));
    // provider, then aud_hash, nonce_mode, nonce_binding, now
    expect(flat[147]).toBe('0');
    expect(flat.slice(148, 180)).toEqual(dec(ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('491923400813-5bb3upweb.apps.googleusercontent.com')))));
    expect(flat[180]).toBe('1');
    expect(flat.slice(181, 213)).toEqual(dec(ethers.utils.arrayify(`0x${NONCE}`)));
    expect(flat[213]).toBe(String(CLOCK));
  });
});

describe('the partial-data cap', () => {
  // Pad a claim so the signed data after the cut is exactly `size` bytes.
  // partial = (dot + 1 - 64) + payload, and a base64url payload is never
  // 1 mod 4 characters long: dot 103 reaches 2048, dot 102 reaches 2049.
  async function tokenWithPartial(size: number, dot = 103) {
    const kid = kidForDot(dot);
    let pad = 0;
    for (;;) {
      const jwt = ref.signJwt(googlePayload({pad: 'x'.repeat(pad)}), privateKey, kid);
      const signedLen = jwt.lastIndexOf('.');
      const partial = signedLen - 64;
      if (partial === size) return {jwt, kid};
      if (partial > size) return null;
      pad++;
    }
  }

  it('builds the same vector at exactly 2048 bytes', async () => {
    const found = await tokenWithPartial(2048);
    expect(found).not.toBeNull();
    const {app, reference} = await both(found!.jwt, 'google', found!.kid);
    expect(flattenOidcInputs(app)).toEqual(refFlat(reference));
    expect(app.partial_data.len).toBe(2048);
  });

  it('refuses a token one byte over the cap (2049), as the reference does', async () => {
    const found = await tokenWithPartial(2049, 102);
    expect(found).not.toBeNull();
    const {jwt, kid} = found!;
    expect(jwt.lastIndexOf('.') - 64).toBe(2049);
    jwksServes(kid);
    const {fake, sign} = await appSigner();
    await expect(prepareOidcInputs({jwt, scope: SCOPE, provider: 'google', nonce: NONCE, clockSeconds: CLOCK, jwksUrl: JWKS_URL, signProviderKey: sign}))
      .rejects.toThrow(/ID token too large: \d+ bytes after the SHA precompute; the circuit holds 2048/);
    // Refused before the statement: nothing was signed for a token that cannot be proved.
    expect(sign).not.toHaveBeenCalled();
    expect(fake.calls.assertionHashes).toHaveLength(0);
    expect(() => ref.buildInputs(jwt, N, {provider: 0, scope: SCOPE, nonceMode: 1, nonceBinding: ref.deriveNonceBinding(SCOPE, REQUEST_ID), now: BigInt(CLOCK), signer: {}}))
      .toThrow(/too large/);
  });
});

describe('the provider key the statement names', () => {
  it('is read from the JWKS n exactly as the reference reads it, leading zero byte included', () => {
    const withZero = Buffer.from([0, ...Buffer.from(N, 'base64url')]).toString('base64url');
    expect(Array.from(modulusBytes(N))).toEqual(Array.from(ref.modulusBytes(N)));
    expect(Array.from(modulusBytes(withZero))).toEqual(Array.from(ref.modulusBytes(withZero)));
  });

  it('is refused when it is not 2048 bits, by both builders, before anything is signed', async () => {
    const small = (crypto.generateKeyPairSync('rsa', {modulusLength: 1024}).publicKey.export({format: 'jwk'}) as {n: string}).n;
    expect(() => ref.modulusBytes(small)).toThrow(/2048-bit/);
    const kid = kidForDot(102);
    (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: true, json: async () => ({keys: [{kid, kty: 'RSA', n: small, e: 'AQAB'}]})}));
    const {fake, sign} = await appSigner();
    await expect(prepareOidcInputs({
      jwt: ref.signJwt(googlePayload(), privateKey, kid), scope: SCOPE, provider: 'google', nonce: NONCE, clockSeconds: CLOCK, jwksUrl: JWKS_URL, signProviderKey: sign,
    })).rejects.toThrow(/not a 2048-bit RSA modulus/);
    expect(sign).not.toHaveBeenCalled();
    expect(fake.calls.assertionHashes).toHaveLength(0);
  });
});
