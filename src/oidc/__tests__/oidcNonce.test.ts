/**
 * The nonce an OIDC proof's ID token must carry, and the refusal of one that
 * does not. Vectors were computed independently with foundry's `cast keccak`
 * over the same 87-byte layout, not with this code.
 */
import {
  OIDC_MAX_ID_TOKEN_LENGTH,
  OIDC_MAX_SCOPE_BYTES,
  OIDC_NONCE_DOMAIN,
  checkIdTokenNonce,
  deriveOidcNonce,
  isCanonicalRequestId,
  newStandaloneRequestId,
} from '../oidcNonce';
import {computeScope} from '../../utils/circuitHelpers';
import {ethers} from 'ethers';
import {jwt, rawJwt} from './jwt';

const RID = '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b';
const NONCE = '1dd297f01d4567260b8519ab54aabdf7138fe1b04c89a3aea3c05a1f82a0e0ff';

describe('deriveOidcNonce', () => {
  it('matches the cast-computed vector (ASCII scope)', () => {
    expect(deriveOidcNonce('proofport:default', RID)).toBe(NONCE);
  });

  it('matches the cast-computed vector (Korean + emoji scope)', () => {
    expect(deriveOidcNonce('zkproofport-community:topic:한국어 🚀', '00000000-0000-4000-8000-000000000000'))
      .toBe('195a68271d8edd1b89808d43f29c898e1bff6ea1bad80e05da2272932b26a08f');
  });

  it('is keccak(tag || the proof scope hash || requestId), 87 bytes, lowercase hex without 0x', () => {
    const preimage = ethers.utils.concat([
      ethers.utils.toUtf8Bytes(OIDC_NONCE_DOMAIN),
      computeScope('proofport:default'),
      ethers.utils.toUtf8Bytes(RID),
    ]);
    expect(preimage.length).toBe(87);
    expect(OIDC_NONCE_DOMAIN).toBe('zkproofport-oidc-v1');
    expect(deriveOidcNonce('proofport:default', RID)).toBe(ethers.utils.keccak256(preimage).slice(2));
    expect(NONCE).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the scope and with the request id', () => {
    expect(deriveOidcNonce('proofport:default ', RID)).not.toBe(NONCE);
    expect(deriveOidcNonce('proofport:default', '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7c')).not.toBe(NONCE);
  });

  it.each([
    ['uppercase', RID.toUpperCase()],
    ['braces', `{${RID}}`],
    ['no dashes', RID.replace(/-/g, '')],
    ['whitespace', ` ${RID}`],
    ['trailing newline', `${RID}\n`],
    ['relay-style label', 'req-oidc_domain_attestation'],
    ['empty', ''],
    ['sql shape', "' OR 1=1 --"],
    ['wildcards', '%_%_%'],
  ])('refuses a requestId that is not a canonical lowercase UUID (%s)', (_label, id) => {
    expect(() => deriveOidcNonce('proofport:default', id)).toThrow(/lowercase UUID/);
  });

  it.each([
    ['undefined', undefined, /must be a string/],
    ['null', null, /must be a string/],
    ['number', 42, /must be a string/],
    ['empty', '', /empty/],
    ['whitespace only', ' \t\n', /empty/],
    ['lone surrogate', 'a\uD800b', /not valid Unicode/],
  ])('refuses a scope that is %s', (_label, scope, why) => {
    expect(() => deriveOidcNonce(scope as never, RID)).toThrow(why);
  });

  it('accepts scope at the byte cap and refuses one byte over (counted in UTF-8 bytes)', () => {
    expect(deriveOidcNonce('a'.repeat(OIDC_MAX_SCOPE_BYTES), RID)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => deriveOidcNonce('a'.repeat(OIDC_MAX_SCOPE_BYTES + 1), RID)).toThrow(/4097 bytes/);
    // 1366 Hangul syllables = 4098 bytes though only 1366 characters.
    expect(() => deriveOidcNonce('한'.repeat(1366), RID)).toThrow(/4098 bytes/);
  });

  it('hashes hostile scope text as-is, without escaping or trimming', () => {
    for (const scope of ['<script>alert(1)</script>', '%_\\', 'line1\nline2\ttab', '\u0000\u001f']) {
      expect(deriveOidcNonce(scope, RID)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(deriveOidcNonce('a\\b', RID)).not.toBe(deriveOidcNonce('a\\\\b', RID));
  });
});

describe('newStandaloneRequestId', () => {
  it('mints a canonical v4 UUID from the random source', () => {
    const id = newStandaloneRequestId(b => b.fill(0xff));
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(newStandaloneRequestId(b => b.fill(0))).toBe('00000000-0000-4000-8000-000000000000');
    expect(isCanonicalRequestId(newStandaloneRequestId())).toBe(true);
  });

  it('is fresh per call with the real random source', () => {
    const ids = new Set(Array.from({length: 50}, () => newStandaloneRequestId()));
    expect(ids.size).toBe(50);
  });

  it('refuses to mint without a secure random source', () => {
    const saved = (globalThis as {crypto?: unknown}).crypto;
    Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
    try {
      expect(() => newStandaloneRequestId()).toThrow(/getRandomValues/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {value: saved, configurable: true});
    }
  });
});

describe('checkIdTokenNonce', () => {
  it('accepts a token carrying exactly the nonce', () => {
    expect(checkIdTokenNonce(jwt({nonce: NONCE, email: 'a@b.com'}), NONCE)).toEqual({ok: true});
  });

  it.each([
    ['no nonce claim', jwt({email: 'a@b.com'}), 'missing'],
    ['another request’s nonce', jwt({nonce: deriveOidcNonce('other', RID)}), 'mismatch'],
    ['uppercase hex of the same nonce', jwt({nonce: NONCE.toUpperCase()}), 'mismatch'],
    ['0x-prefixed', jwt({nonce: `0x${NONCE}`}), 'mismatch'],
    ['nonce with trailing space', jwt({nonce: `${NONCE} `}), 'mismatch'],
    ['nonce as number', jwt({nonce: 1}), 'mismatch'],
    ['nonce as null', jwt({nonce: null}), 'mismatch'],
    ['nonce as array', jwt({nonce: [NONCE]}), 'mismatch'],
    ['nonce only nested', jwt({inner: {nonce: NONCE}}), 'missing'],
    ['nonce twice, right one last', rawJwt(`{"nonce":"evil","nonce":"${NONCE}"}`), 'duplicated'],
    ['nonce twice via escape', rawJwt(`{"nonce":"${NONCE}","non\\u0063e":"${NONCE}"}`), 'duplicated'],
    ['payload is an array', rawJwt('[1,2]'), 'malformed'],
    ['payload is a string', rawJwt('"x"'), 'malformed'],
    ['payload is null', rawJwt('null'), 'malformed'],
    ['payload is not JSON', rawJwt('{nonce:1}'), 'malformed'],
    ['payload is not UTF-8', `h.${Buffer.from([0xff, 0xfe]).toString('base64url')}.s`, 'malformed'],
    ['payload uses standard base64 characters', `h.${'+/+/'}.s`, 'malformed'],
    ['two parts', 'h.p', 'malformed'],
    ['four parts', 'h.p.s.x', 'malformed'],
    ['empty signature', `h.${Buffer.from('{}').toString('base64url')}.`, 'malformed'],
    ['empty string', '', 'malformed'],
    ['not a string', 12345, 'malformed'],
    ['undefined', undefined, 'malformed'],
  ])('refuses: %s', (_label, token, reason) => {
    const r = checkIdTokenNonce(token, NONCE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(reason);
  });

  it('does not count a key named inside a string value, or a quote in a key', () => {
    const tricky = rawJwt(`{"note":"\\"nonce\\":","z\\"nonce":"x","nonce":"${NONCE}"}`);
    expect(checkIdTokenNonce(tricky, NONCE)).toEqual({ok: true});
  });

  it('keeps Korean and emoji claims readable', () => {
    expect(checkIdTokenNonce(jwt({nonce: NONCE, name: '홍길동 🚀'}), NONCE)).toEqual({ok: true});
  });

  it('refuses a token over the length cap, and accepts one at it', () => {
    const base = jwt({nonce: NONCE});
    const padTo = (n: number) => base + 'A'.repeat(n - base.length);
    expect(checkIdTokenNonce(padTo(OIDC_MAX_ID_TOKEN_LENGTH), NONCE)).toEqual({ok: true});
    const over = checkIdTokenNonce(padTo(OIDC_MAX_ID_TOKEN_LENGTH + 1), NONCE);
    expect(!over.ok && over.reason).toBe('malformed');
  });

  it('throws on an expected nonce that is not one (a caller bug, not a token problem)', () => {
    expect(() => checkIdTokenNonce(jwt({nonce: 'x'}), 'x')).toThrow(/64 lowercase hex/);
    expect(() => checkIdTokenNonce(jwt({nonce: ''}), '')).toThrow(/64 lowercase hex/);
  });
});
