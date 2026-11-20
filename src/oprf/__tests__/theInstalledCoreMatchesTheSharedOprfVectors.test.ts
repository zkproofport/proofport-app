/**
 * The installed `@zkproofport-app/core` OPRF client (the one the app proves
 * with) against fixtures/oprf-vectors.json, a byte-identical copy of the SDK's
 * src/__tests__/fixtures/oprf-vectors.json (Rust taceo-oprf-core /
 * taceo-poseidon2 / proofport-oprf, oprf-nr KATs, ethers' TypedDataEncoder,
 * and a recorded answer of the public test network).
 */
import vectors from './fixtures/oprf-vectors.json';
import {
  blindOprfQuery, finalizeOprf, oprfKeyHash, oprfNameError, oprfNullifier, oprfQuery, oprfRequestDigest,
  reduceOprfName, unblindOprfResponse, verifyOprfDlogEquality, OPRF_FORMAT_CHARACTERS,
  TACEO_TESTNET_OPRF_KEY_HASH as TEST_NETWORK_OPRF_KEY_HASH, TACEO_TESTNET_OPRF_PUBLIC_KEY as TEST_NETWORK_OPRF_PUBLIC_KEY,
} from '@zkproofport-app/core';
import {pinnedOprfKeyHash} from '../config';

describe('names', () => {
  it.each([...vectors.names, ...vectors.jsOnlyNames].map(n => [n.note, n]))('%s', (_note, n) => {
    const v = n as {name: string; verdict: string | null; reduced?: string};
    expect(oprfNameError(v.name)).toBe(v.verdict);
    if (v.verdict === null && v.reduced) expect(reduceOprfName(v.name)).toBe(v.reduced);
    if (v.verdict !== null) expect(() => reduceOprfName(v.name)).toThrow(v.verdict);
  });

  it('the Cf table equals this runtime\'s \\p{Cf}', () => {
    const inTable = (c: number) => OPRF_FORMAT_CHARACTERS.some(([lo, hi]) => c >= lo && c <= hi);
    const cf = /\p{Cf}/u;
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      if (inTable(c) !== cf.test(String.fromCodePoint(c))) throw new Error(`U+${c.toString(16)} differs`);
    }
  });
});

describe('the request digest (what the wallet signs)', () => {
  it.each(vectors.digests.map(d => [d.domainName, d.scopeName, d]))('%s / %s', (_a, _b, d) => {
    const v = d as (typeof vectors.digests)[number];
    expect(oprfRequestDigest(v.domainName, v.scopeName, v.deadline)).toBe(v.digest);
  });
});

describe('evaluations', () => {
  it.each(vectors.evaluations.map(e => [e.note, e]))('%s', (_note, e) => {
    const v = e as (typeof vectors.evaluations)[number];
    expect(oprfQuery({address: v.address, domain: v.domain, scope: v.scope})).toBe(v.query);
    expect(blindOprfQuery(v.query, v.beta)).toEqual(v.blindedQuery);
    expect(oprfKeyHash(v.publicKey)).toBe(v.keyHash);
    expect(verifyOprfDlogEquality({publicKey: v.publicKey, blindedQuery: v.blindedQuery, blindedResponse: v.blindedResponse, e: v.dlogE, s: v.dlogS})).toBe(true);
    expect(unblindOprfResponse(v.blindedResponse, v.beta)).toEqual(v.response);
    expect(oprfNullifier(v.query, v.response)).toBe(v.nullifier);
    const out = finalizeOprf({address: v.address, domain: v.domain, scope: v.scope, beta: v.beta, publicKey: v.publicKey,
      blindedResponse: v.blindedResponse, dlogE: v.dlogE, dlogS: v.dlogS, expectedKeyHash: v.keyHash});
    expect(out.nullifier).toBe(v.nullifier);
  });
});

describe('the public test network', () => {
  const n = vectors.network;
  it('its recorded answer verifies and gives the recorded nullifier', () => {
    const out = finalizeOprf({address: n.addressField.length === 42 ? n.addressField : '0x' + BigInt(n.addressField).toString(16).padStart(40, '0'),
      domain: n.domain, scope: n.scope, beta: n.beta, publicKey: n.publicKey, blindedResponse: n.blindedResponse,
      dlogE: n.dlogE, dlogS: n.dlogS, expectedKeyHash: TEST_NETWORK_OPRF_KEY_HASH});
    expect(out.nullifier).toBe(n.nullifier);
  });
  it('the app\'s pinned key hash is that key\'s hash', () => {
    expect(n.keyHash).toBe(TEST_NETWORK_OPRF_KEY_HASH);
    expect(pinnedOprfKeyHash('staging', 'coinbase_attestation')).toBe(n.keyHash);
    expect(oprfKeyHash(TEST_NETWORK_OPRF_PUBLIC_KEY)).toBe(TEST_NETWORK_OPRF_KEY_HASH);
    expect(n.publicKey).toEqual(TEST_NETWORK_OPRF_PUBLIC_KEY);
  });
  it('the same answer under another pinned key hash is refused', () => {
    expect(() => finalizeOprf({address: '0x' + BigInt(n.addressField).toString(16).padStart(40, '0'), domain: n.domain, scope: n.scope, beta: n.beta,
      publicKey: n.publicKey, blindedResponse: n.blindedResponse, dlogE: n.dlogE, dlogS: n.dlogS,
      expectedKeyHash: '0x' + (BigInt(TEST_NETWORK_OPRF_KEY_HASH) + 1n).toString(16).padStart(64, '0')})).toThrow(/not the pinned/);
  });
});
