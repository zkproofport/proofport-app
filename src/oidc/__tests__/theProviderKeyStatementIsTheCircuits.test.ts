/**
 * The provider-key statement's bytes, and the live key list it may vouch for.
 *
 * Bytes: the known-answer case of circuits `oidc-domain-attestation/src/provider_key.nr`
 * (`the_statement_layout`, `the_modulus_is_big_endian_256_bytes`), the tag
 * recomputed, `now` at u64 boundaries. The reference builder's equality for
 * real-shaped keys is in oidcDomainMatchesTheCircuitsBuilder.test.ts.
 *
 * Key list: fetched fresh (cache bypassed, every call), fail closed on every
 * malformed or failed answer (E3002), and a modulus is vouchable only if it
 * is exactly one of THAT list's RSA keys, for that provider, fetched moments
 * ago (E2008 otherwise).
 */
import * as crypto from 'node:crypto';
import {ethers} from 'ethers';
import {
  fetchLiveProviderKeys,
  LIVE_KEYS_MAX_AGE_SECONDS,
  liveKeyForKid,
  modulusBytes,
  OIDC_CIRCUIT_TAG,
  OidcProviderKeyError,
  providerKeyStatement,
  PROVIDER_KEY_STATEMENT_LEN,
  requireLiveModulus,
  type LiveProviderKeys,
} from '../providerKeyStatement';

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const rsaN = (bits: number) =>
  (crypto.generateKeyPairSync('rsa', {modulusLength: bits}).publicKey.export({format: 'jwk'}) as {n: string}).n;
const N = rsaN(2048);
const OTHER_N = rsaN(2048);
const NOW = 1793000000;

/** n = 2^2047 + 0x0102, provider_key.nr's sample_limbs. */
const SAMPLE_N = (() => {
  const n = new Uint8Array(256);
  n[0] = 0x80;
  n[254] = 0x01;
  n[255] = 0x02;
  return n;
})();

const codeOf = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e instanceof OidcProviderKeyError ? e.code : `not ours: ${String(e)}`;
  }
  return 'ok';
};

describe('the statement bytes', () => {
  it('match provider_key.nr the_statement_layout byte for byte', () => {
    const s = providerKeyStatement(1, 0x0102030405060708n, SAMPLE_N);
    expect(s).toHaveLength(PROVIDER_KEY_STATEMENT_LEN);
    expect(Buffer.from(s.slice(0, 16)).toString('ascii')).toBe('ZKProofport/PK/1');
    expect(ethers.utils.hexlify(s.slice(16, 48))).toBe(OIDC_CIRCUIT_TAG);
    expect(s[48]).toBe(1);
    expect(Array.from(s.slice(49, 57))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s[57]).toBe(0x80);
    expect(Array.from(s.slice(58, 311)).every(b => b === 0)).toBe(true);
    expect(s[311]).toBe(0x01);
    expect(s[312]).toBe(0x02);
  });

  it('carries the circuit id tag, not coinbase_attestation\'s', () => {
    expect(OIDC_CIRCUIT_TAG).toBe(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('oidc_domain_attestation')));
    expect(OIDC_CIRCUIT_TAG).not.toBe(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('coinbase_attestation')));
  });

  it.each([
    ['0', 0n, '0000000000000000'],
    ['1', 1n, '0000000000000001'],
    ['2^32', 2n ** 32n, '0000000100000000'],
    ['MAX_SAFE_INTEGER', BigInt(Number.MAX_SAFE_INTEGER), '001fffffffffffff'],
    ['u64 max', 2n ** 64n - 1n, 'ffffffffffffffff'],
  ])('writes now = %s big-endian at 49..57', (_l, now, hex) => {
    expect(Buffer.from(providerKeyStatement(0, now, SAMPLE_N).slice(49, 57)).toString('hex')).toBe(hex);
  });

  it('refuses now outside u64, an unknown provider and a modulus that is not 256 bytes', () => {
    expect(() => providerKeyStatement(0, -1n, SAMPLE_N)).toThrow(/not a u64/);
    expect(() => providerKeyStatement(0, 2n ** 64n, SAMPLE_N)).toThrow(/not a u64/);
    expect(() => providerKeyStatement(2 as never, 1n, SAMPLE_N)).toThrow(/Unknown OIDC provider id 2/);
    expect(() => providerKeyStatement(0, 1n, SAMPLE_N.slice(1))).toThrow(/255 bytes/);
  });
});

describe('the modulus', () => {
  it('is the JWKS n as 256 big-endian bytes', () => {
    expect(b64u(modulusBytes(N))).toBe(N);
  });

  it('drops a leading zero byte (257-byte n), as the reference builder does', () => {
    const withZero = b64u(new Uint8Array([0, ...Buffer.from(N, 'base64url')]));
    expect(b64u(modulusBytes(withZero))).toBe(N);
  });

  it.each([
    ['1024-bit', () => rsaN(1024)],
    ['4096-bit', () => rsaN(4096)],
    ['256 bytes with the top bit clear', () => b64u(new Uint8Array(256).fill(0x7f))],
    ['not base64url', () => N.slice(0, -2) + '+/'],
    ['empty', () => ''],
    ['not a string', () => 42],
  ])('refuses a %s modulus (E2008)', async (_l, make) => {
    expect(await codeOf(() => modulusBytes(make()))).toBe('E2008');
  });
});

describe('the live key list', () => {
  const ok = (body: unknown) => ({ok: true, status: 200, json: async () => body});
  const DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';
  const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

  function server(jwksBody: unknown) {
    return jest.fn(async (url: string, init: {cache: string; headers: Record<string, string>}) => {
      expect(init.cache).toBe('no-store');
      expect(init.headers['Cache-Control']).toBe('no-cache');
      if (url === DISCOVERY) return ok({jwks_uri: JWKS});
      if (url === JWKS) return typeof jwksBody === 'function' ? (jwksBody as () => unknown)() : ok(jwksBody);
      return {ok: false, status: 404, json: async () => ({})};
    });
  }
  const fetchKeys = (f: ReturnType<typeof server>, now = NOW) =>
    fetchLiveProviderKeys(0, 'https://accounts.google.com', {fetchImpl: f as never, nowSeconds: () => now});

  it('is fetched through discovery, bypassing caches, every time it is asked for', async () => {
    const f = server({keys: [{kid: 'k1', kty: 'RSA', n: N, e: 'AQAB'}]});
    const a = await fetchKeys(f);
    const b = await fetchKeys(f);
    expect(f.mock.calls.map(c => c[0])).toEqual([DISCOVERY, JWKS, DISCOVERY, JWKS]);
    expect(a).not.toBe(b);
    expect(a.jwksUrl).toBe(JWKS);
    expect(a.fetchedAt).toBe(NOW);
  });

  it.each([
    ['HTTP 500', () => ({ok: false, status: 500, json: async () => ({})})],
    ['a network error', () => {
      throw new TypeError('Network request failed');
    }],
    ['a body that is not JSON', () => ({ok: true, status: 200, json: async () => {
      throw new SyntaxError('Unexpected token <');
    }})],
    ['no keys', () => ok({})],
    ['keys not an array', () => ok({keys: {kid: 'k1'}})],
    ['an empty key list', () => ok({keys: []})],
    ['a key without kid', () => ok({keys: [{kty: 'RSA', n: N}]})],
    ['a null key', () => ok({keys: [null]})],
    ['null', () => ok(null)],
  ])('fails closed with E3002 on %s', async (_l, answer) => {
    expect(await codeOf(fetchKeys(server(answer)))).toBe('E3002');
  });

  it('fails closed with E3002 when discovery names no https jwks_uri', async () => {
    for (const body of [{}, {jwks_uri: 'http://www.googleapis.com/oauth2/v3/certs'}, {jwks_uri: 7}]) {
      const f = jest.fn(async () => ok(body));
      expect(await codeOf(fetchLiveProviderKeys(0, 'https://accounts.google.com', {fetchImpl: f as never}))).toBe('E3002');
    }
  });

  describe('vouching for a modulus', () => {
    let live: LiveProviderKeys;
    beforeEach(async () => {
      live = await fetchKeys(server({keys: [{kid: 'k1', kty: 'RSA', n: N, e: 'AQAB'}, {kid: 'ec', kty: 'EC', crv: 'P-256'}]}));
    });

    it('accepts exactly a listed RSA n, for that provider, fetched just now', () => {
      expect(() => requireLiveModulus(live, 0, modulusBytes(N), NOW)).not.toThrow();
      expect(() => requireLiveModulus(live, 0, modulusBytes(N), NOW + LIVE_KEYS_MAX_AGE_SECONDS)).not.toThrow();
    });

    it.each([
      ['a modulus the list does not hold', () => [live, 0, modulusBytes(OTHER_N), NOW]],
      ['one bit off a listed modulus', () => {
        const m = modulusBytes(N);
        m[255] ^= 1;
        return [live, 0, m, NOW];
      }],
      ['the list of another provider', () => [live, 1, modulusBytes(N), NOW]],
      ['a list older than the limit', () => [live, 0, modulusBytes(N), NOW + LIVE_KEYS_MAX_AGE_SECONDS + 1]],
      ['a list from the future (clock moved back)', () => [live, 0, modulusBytes(N), NOW - 1]],
      ['a list the app did not fetch, even with the same content', () => [{...live}, 0, modulusBytes(N), NOW]],
    ])('refuses %s (E2008)', async (_l, args) => {
      const [l, p, m, t] = args() as [LiveProviderKeys, 0 | 1, Uint8Array, number];
      expect(await codeOf(() => requireLiveModulus(l, p, m, t))).toBe('E2008');
    });

    it('finds the token key by kid, and refuses an unlisted, non-RSA or duplicated kid (E2008)', async () => {
      expect(liveKeyForKid(live, 'k1').n).toBe(N);
      expect(await codeOf(() => liveKeyForKid(live, 'k2'))).toBe('E2008');
      expect(await codeOf(() => liveKeyForKid(live, 'ec'))).toBe('E2008');
      const dup = await fetchKeys(server({keys: [{kid: 'k1', kty: 'RSA', n: N}, {kid: 'k1', kty: 'RSA', n: OTHER_N}]}));
      expect(await codeOf(() => liveKeyForKid(dup, 'k1'))).toBe('E2008');
    });
  });
});
