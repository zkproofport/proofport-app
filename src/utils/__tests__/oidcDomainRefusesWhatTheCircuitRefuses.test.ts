/**
 * The app's OIDC v2 builder refuses, with a reason, every token the v2 circuit
 * would refuse for a claim reason -- before a minute of proving ends in a
 * witness failure that names nothing.
 *
 * Matrix: aud (missing / empty / array / number / 128 vs 129 UTF-8 bytes),
 * iss per provider (both Google spellings, foreign, Microsoft uppercase
 * tenant, v1 issuer, provider swap both ways), iat/exp (missing, quoted,
 * fractional, exponent, negative, iat >= exp), `now` boundaries (iat, exp-1,
 * exp, 300 s and 301 s behind iat, NaN clock), nonce (malformed request nonce
 * in four shapes, token nonce missing / different), email_verified and
 * xms_edov as anything but literal true, email over 128 bytes, a domain that
 * is not the email's.
 */
import * as crypto from 'node:crypto';
import {ethers} from 'ethers';
import {
  OIDC_MAX_CLOCK_BEHIND_SECONDS,
  prepareOidcInputs,
  proofTimeFor,
  type PrepareOidcParams,
} from '../oidcDomain';
import {deriveOidcNonce} from '../../oidc/oidcNonce';

const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const N = (publicKey.export({format: 'jwk'}) as {n: string}).n;
const KID = 'test-key';
const JWKS_URL = 'https://keys.test/jwks';
const SCOPE = 'scope';
const NONCE = deriveOidcNonce(SCOPE, '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b');
const IAT = 1793000000;
const EXP = IAT + 3600;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
function sign(payloadJson: string): string {
  const header = b64(JSON.stringify({alg: 'RS256', kid: KID, typ: 'JWT'}));
  const body = b64(payloadJson);
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${sig}`;
}

const GOOGLE = {
  iss: 'https://accounts.google.com',
  aud: 'web-client.apps.googleusercontent.com',
  email: 'alice@corp.example',
  email_verified: true,
  nonce: NONCE,
  iat: IAT,
  exp: EXP,
};
const MS_ISS = 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0';
const MICROSOFT = {...GOOGLE, iss: MS_ISS, email_verified: undefined, xms_edov: true};

beforeEach(() => {
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({keys: [{kid: KID, kty: 'RSA', n: N, e: 'AQAB'}]}),
  }));
});

function build(payload: Record<string, unknown> | string, extra: Partial<PrepareOidcParams> = {}) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return prepareOidcInputs({
    jwt: sign(json),
    scope: SCOPE,
    provider: 'google',
    nonce: NONCE,
    clockSeconds: IAT + 60,
    jwksUrl: JWKS_URL,
    ...extra,
  });
}

describe('aud', () => {
  it.each([
    ['missing', {...GOOGLE, aud: undefined}],
    ['empty', {...GOOGLE, aud: ''}],
    ['an array', {...GOOGLE, aud: ['a', 'b']}],
    ['a number', {...GOOGLE, aud: 7}],
  ])('refuses aud %s', async (_l, p) => {
    await expect(build(p)).rejects.toThrow(/aud must be one non-empty string/);
  });

  it('accepts 128 bytes and refuses 129', async () => {
    await expect(build({...GOOGLE, aud: 'a'.repeat(128)})).resolves.toBeDefined();
    await expect(build({...GOOGLE, aud: 'a'.repeat(129)})).rejects.toThrow(/aud is 129 bytes; the circuit holds 128/);
  });

  it('counts UTF-8 bytes, not characters (43 Hangul = 129 bytes)', async () => {
    await expect(build({...GOOGLE, aud: '가'.repeat(43)})).rejects.toThrow(/aud is 129 bytes/);
  });

  it('hashes the aud string itself', async () => {
    const i = await build({...GOOGLE, aud: 'client-🦊'});
    expect(i.aud_hash).toEqual(Array.from(ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('client-🦊')))));
  });
});

describe('iss', () => {
  it.each(['https://accounts.google.com', 'accounts.google.com'])('Google accepts %s', async iss => {
    await expect(build({...GOOGLE, iss})).resolves.toBeDefined();
  });

  it.each([
    ['a foreign issuer', 'https://evil.example'],
    ['Google with a trailing slash', 'https://accounts.google.com/'],
    ["Microsoft's issuer", MS_ISS],
  ])('Google refuses %s', async (_l, iss) => {
    await expect(build({...GOOGLE, iss})).rejects.toThrow(/is not Google/);
  });

  it('Microsoft accepts a lowercase v2.0 tenant issuer', async () => {
    await expect(build(MICROSOFT, {provider: 'microsoft'})).resolves.toMatchObject({provider: 1});
  });

  it.each([
    ['an uppercase tenant', MS_ISS.replace('72f988bf', '72F988BF')],
    ['the v1.0 issuer', 'https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/'],
    ["Google's issuer", 'https://accounts.google.com'],
    ['a tenant that is not a GUID', 'https://login.microsoftonline.com/common/v2.0'],
  ])('Microsoft refuses %s', async (_l, iss) => {
    await expect(build({...MICROSOFT, iss}, {provider: 'microsoft'})).rejects.toThrow(/not a Microsoft v2.0 tenant issuer/);
  });
});

describe('iat / exp', () => {
  const base = JSON.stringify({...GOOGLE, iat: 0, exp: 0});
  it.each([
    ['missing iat', JSON.stringify({...GOOGLE, iat: undefined}), /iat claim is not a whole number/],
    ['quoted iat', base.replace('"iat":0', `"iat":"${IAT}"`).replace('"exp":0', `"exp":${EXP}`), /iat claim/],
    ['fractional exp', base.replace('"iat":0', `"iat":${IAT}`).replace('"exp":0', `"exp":${EXP}.5`), /exp claim/],
    ['exp as 1.0', base.replace('"iat":0', `"iat":${IAT}`).replace('"exp":0', `"exp":${EXP}.0`), /exp claim/],
    ['exp in exponent form', base.replace('"iat":0', `"iat":${IAT}`).replace('"exp":0', '"exp":1.7931e9'), /exp claim/],
    ['negative iat', base.replace('"iat":0', '"iat":-1').replace('"exp":0', `"exp":${EXP}`), /iat claim/],
  ])('refuses %s', async (_l, json, re) => {
    await expect(build(json)).rejects.toThrow(re);
  });

  it('puts the clock in `now` when iat <= clock < exp', async () => {
    expect((await build(GOOGLE, {clockSeconds: IAT})).now).toBe(String(IAT));
    expect((await build(GOOGLE, {clockSeconds: EXP - 1})).now).toBe(String(EXP - 1));
  });

  it('refuses an expired token (clock == exp)', async () => {
    await expect(build(GOOGLE, {clockSeconds: EXP})).rejects.toThrow(/expired/);
  });
});

describe('proofTimeFor', () => {
  it(`uses iat when the clock is up to ${OIDC_MAX_CLOCK_BEHIND_SECONDS}s behind it`, () => {
    expect(proofTimeFor(IAT - 300, IAT, EXP)).toBe(IAT);
    expect(proofTimeFor(IAT - 1, IAT, EXP)).toBe(IAT);
  });

  it('refuses a clock 301s behind', () => {
    expect(() => proofTimeFor(IAT - 301, IAT, EXP)).toThrow(/301s behind/);
  });

  it.each([NaN, 1.5, -1, Infinity])('refuses clock %p', c => {
    expect(() => proofTimeFor(c, IAT, EXP)).toThrow(/Device clock/);
  });

  it('refuses iat >= exp', () => {
    expect(() => proofTimeFor(IAT, IAT, IAT)).toThrow(/not before exp/);
  });

  it('refuses iat > exp in a token', async () => {
    await expect(build({...GOOGLE, iat: EXP, exp: IAT})).rejects.toThrow(/not before exp/);
  });
});

describe('nonce', () => {
  it('binds the request nonce: nonce_mode 1 and its 32 bytes', async () => {
    const i = await build(GOOGLE);
    expect(i.nonce_mode).toBe(1);
    expect(ethers.utils.hexlify(i.nonce_binding).slice(2)).toBe(NONCE);
  });

  it.each([
    ['uppercase', NONCE.toUpperCase()],
    ['63 characters', NONCE.slice(1)],
    ['0x-prefixed', `0x${NONCE}`],
    ['empty', ''],
  ])('refuses a request nonce that is %s', async (_l, nonce) => {
    await expect(build({...GOOGLE, nonce}, {nonce})).rejects.toThrow(/64 lowercase hex/);
  });

  it('refuses a token without the nonce', async () => {
    await expect(build({...GOOGLE, nonce: undefined})).rejects.toThrow(/is not this request's nonce/);
  });

  it("refuses a token carrying another request's nonce", async () => {
    const other = deriveOidcNonce(SCOPE, '00000000-0000-4000-8000-000000000000');
    await expect(build({...GOOGLE, nonce: other})).rejects.toThrow(/is not this request's nonce/);
  });
});

describe('email', () => {
  it.each([['the string "true"', 'true'], ['1', 1], ['missing', undefined]])(
    'refuses email_verified as %s', async (_l, v) => {
      await expect(build({...GOOGLE, email_verified: v})).rejects.toThrow(/email_verified is not true/);
    },
  );

  it.each([['the string "true"', 'true'], ['missing', undefined]])(
    'refuses xms_edov as %s', async (_l, v) => {
      await expect(build({...MICROSOFT, xms_edov: v}, {provider: 'microsoft'})).rejects.toThrow(/xms_edov is not true/);
    },
  );

  it('accepts a 128-byte email and refuses 129', async () => {
    const at = '@corp.example';
    await expect(build({...GOOGLE, email: 'a'.repeat(128 - at.length) + at})).resolves.toBeDefined();
    await expect(build({...GOOGLE, email: 'a'.repeat(129 - at.length) + at})).rejects.toThrow(/129 bytes; the circuit holds 128/);
  });

  it('refuses a requested domain that is not the email domain', async () => {
    await expect(build(GOOGLE, {domain: 'other.example'})).rejects.toThrow(/is not the requested domain/);
    await expect(build(GOOGLE, {domain: 'Corp.example'})).rejects.toThrow(/is not the requested domain/);
  });

  it('refuses a domain over 64 bytes', async () => {
    const domain = `${'d'.repeat(61)}.com`;
    await expect(build({...GOOGLE, email: `a@${domain}`})).rejects.toThrow(/exceeds max length 64/);
  });
});
