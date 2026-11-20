/**
 * Edge-case matrix rows for what the app refuses BEFORE the wallet or the
 * nodes are asked: the request's OPRF names (src/oprf/requestNames.ts), the
 * environment / circuit / key-hash table (src/oprf/config.ts), the deadline
 * and typed data (core mirror), points (off-curve, outside the subgroup,
 * identity), and the request-proof witness against the circuit's own
 * Prover.toml (circuits/oprf-request-auth-poc, fixtures/request-auth-fixture.json).
 */
import {ethers} from 'ethers';
import {oprfNamesFor, IN_APP_OPRF_DOMAIN, OprfNameRefusedError, requesterDomainForDisplay} from '../requestNames';
import {
  OPRF_CIRCUIT_IDS, OPRF_KEY_HASHES, OPRF_NETWORKS, OPRF_PUBLIC_INPUT_LAYOUTS, OprfUnavailableError,
  TEST_NETWORK_OPRF_KEY_HASH, oprfNetworkFor, pinnedOprfKeyHash, readOprfPublicInputs,
} from '../config';
import {
  blindOprfQuery, finalizeOprf, oprfDeadlineError, oprfRequestTypedData, verifyOprfDlogEquality, unblindOprfResponse,
} from '../core/client';
import {GENERATOR, IDENTITY} from '../core/babyjubjub';
import {P} from '../core/field';
import {expectedRequestAuthPublicInputs, requestAuthInputs, checkRequestAuthProof, REQUEST_AUTH_PROOF_BYTES} from '../requestAuth';
import {oprfErrorCode} from '../flow';
import {oprfPrivateInputs, oprfPublicInputs, oprfScopeBytesOf} from '../circuitInputs';
import {vectorOprf} from './helpers/oprfFixture';
import fixture from './fixtures/request-auth-fixture.json';
import vectors from './fixtures/oprf-vectors.json';

const req = (inputs: unknown) => ({inputs});

describe('the OPRF names of a request', () => {
  it('takes the dApp\'s oprfDomain and scope exactly as sent', () => {
    expect(oprfNamesFor(req({oprfDomain: 'Vote.Example', scope: ' s '}))).toEqual({domainName: 'Vote.Example', scopeName: ' s '});
  });

  it.each([
    ['absent', {scope: 's'}, 'missing'],
    ['undefined', {scope: 's', oprfDomain: undefined}, 'missing'],
    ['null', {scope: 's', oprfDomain: null}, 'missing'],
    ['empty', {scope: 's', oprfDomain: ''}, 'empty'],
    ['a number', {scope: 's', oprfDomain: 7}, 'not-a-string'],
    ['an object', {scope: 's', oprfDomain: {host: 'x'}}, 'not-a-string'],
    ['a lone surrogate', {scope: 's', oprfDomain: 'a\ud800'}, 'not-utf8'],
    ['257 ASCII bytes', {scope: 's', oprfDomain: 'a'.repeat(257)}, 'too-long'],
    ['86 Hangul (258 bytes)', {scope: 's', oprfDomain: '가'.repeat(86)}, 'too-long'],
    ['65 four-byte emoji (260 bytes)', {scope: 's', oprfDomain: '🔐'.repeat(65)}, 'too-long'],
    ['NUL', {scope: 's', oprfDomain: 'a\u0000b'}, 'control-character'],
    ['a newline', {scope: 's', oprfDomain: 'a\nb'}, 'control-character'],
    ['a tab', {scope: 's', oprfDomain: '\t'}, 'control-character'],
    ['DEL', {scope: 's', oprfDomain: 'a\u007f'}, 'control-character'],
    ['NEL (U+0085)', {scope: 's', oprfDomain: 'a\u0085'}, 'control-character'],
    ['a right-to-left override', {scope: 's', oprfDomain: 'evil‮ppa.com'}, 'format-character'],
    ['a zero-width joiner emoji', {scope: 's', oprfDomain: '👩‍💻'}, 'format-character'],
    ['a soft hyphen', {scope: 's', oprfDomain: 'a­b'}, 'format-character'],
    ['a BOM', {scope: 's', oprfDomain: '﻿a'}, 'format-character'],
    ['a tag character (subdivision flag)', {scope: 's', oprfDomain: '🏴\u{E0067}\u{E0062}\u{E007F}'}, 'format-character'],
  ])('refuses a domain that is %s (E1010)', (_l, inputs, reason) => {
    let err: unknown;
    try { oprfNamesFor(req(inputs)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OprfNameRefusedError);
    expect((err as OprfNameRefusedError).reason).toBe(reason);
    expect((err as OprfNameRefusedError).field).toBe('oprfDomain');
    expect(oprfErrorCode(err)).toBe('E1010');
  });

  it.each([
    ['empty', ''], ['null', null], ['absent', undefined], ['257 bytes', 'x'.repeat(257)], ['a newline', 'a\nb'],
  ])('refuses a scope that is %s', (_l, scope) => {
    expect(() => oprfNamesFor(req({oprfDomain: 'd.example', scope}))).toThrow(OprfNameRefusedError);
  });

  it.each([
    ['256 ASCII bytes', 'a'.repeat(256)],
    ['85 Hangul (255 bytes)', '가'.repeat(85)],
    ['64 four-byte emoji (256 bytes)', '🔐'.repeat(64)],
    ['whitespace only (the node does not trim)', '   '],
    ['a non-breaking space', 'a b'],
    ['a regional-indicator flag', '🇰🇷'],
    ['a variation selector', '❤️'],
    ['markup', '<script>alert(1)</script>'],
    ['SQL-looking text', "'; DROP TABLE x; --"],
    ['wildcards', '%_\\'],
    ['one byte', 'a'],
  ])('accepts a domain of %s', (_l, d) => {
    expect(oprfNamesFor(req({oprfDomain: d, scope: 's'})).domainName).toBe(d);
  });

  it('refuses a request with no inputs object', () => {
    expect(() => oprfNamesFor(req(null))).toThrow(OprfNameRefusedError);
    expect(() => oprfNamesFor(req('x'))).toThrow(OprfNameRefusedError);
    expect(() => oprfNamesFor(req([]))).toThrow(OprfNameRefusedError);
  });

  it('an in-app proof uses the app\'s own domain and its own scope', () => {
    expect(oprfNamesFor(null, 'lab')).toEqual({domainName: IN_APP_OPRF_DOMAIN, scopeName: 'lab'});
    expect(() => oprfNamesFor(null, '')).toThrow(OprfNameRefusedError);
  });

  it('shows a usable domain and nothing for an unusable one', () => {
    expect(requesterDomainForDisplay({oprfDomain: 'a.example'})).toBe('a.example');
    expect(requesterDomainForDisplay({oprfDomain: 'a‮'})).toBeNull();
    expect(requesterDomainForDisplay({})).toBeNull();
    expect(requesterDomainForDisplay(null)).toBeNull();
  });
});

describe('environments, circuits and the pinned key', () => {
  it('production has no network and no key: refused by name, never the test network (E3011)', () => {
    expect(OPRF_NETWORKS.production).toBeNull();
    expect(OPRF_KEY_HASHES.production).toBeNull();
    expect(() => oprfNetworkFor('production')).toThrow(OprfUnavailableError);
    for (const c of OPRF_CIRCUIT_IDS) {
      let err: unknown;
      try { pinnedOprfKeyHash('production', c); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OprfUnavailableError);
      expect(oprfErrorCode(err)).toBe('E3011');
    }
  });

  it('development and staging pin the test network\'s key for every wallet credential circuit', () => {
    for (const env of ['development', 'staging']) {
      for (const c of OPRF_CIRCUIT_IDS) expect(pinnedOprfKeyHash(env, c)).toBe(TEST_NETWORK_OPRF_KEY_HASH);
      expect(oprfNetworkFor(env).threshold).toBe(2);
      expect(oprfNetworkFor(env).nodes).toHaveLength(3);
    }
  });

  it.each(['prod', 'local', '', 'Production', undefined, null, 1])('an unknown environment %p throws naming it', env => {
    expect(() => oprfNetworkFor(env)).toThrow(/Unknown environment/);
    expect(() => pinnedOprfKeyHash(env, 'coinbase_attestation')).toThrow(/Unknown environment/);
  });

  it.each(['oidc_domain_attestation', 'coinbase-kyc', 'COINBASE_ATTESTATION', '', undefined])('a circuit without an OPRF nullifier (%p) throws naming it', c => {
    expect(() => pinnedOprfKeyHash('staging', c)).toThrow(/has no OPRF nullifier/);
  });
});

describe('reading the OPRF values out of a proof', () => {
  const vec = (n: number) => Array.from({length: n}, (_, i) => '0x' + i.toString(16).padStart(64, '0'));
  it.each(Object.entries(OPRF_PUBLIC_INPUT_LAYOUTS))('%s at its layout', (circuit, l) => {
    const got = readOprfPublicInputs(circuit, vec(l.count));
    expect(BigInt(got.keyHash)).toBe(BigInt(l.keyHash));
    expect(BigInt(got.nullifier)).toBe(BigInt(l.nullifier));
    expect([l.domain, l.scope]).toEqual([l.keyHash + 1, l.keyHash + 2]);
    expect(() => readOprfPublicInputs(circuit, vec(l.count + 60))).toThrow(/publishes/);
    expect(() => readOprfPublicInputs(circuit, vec(l.count - 1))).toThrow(/publishes/);
    const atP = vec(l.count);
    atP[l.nullifier] = '0x' + P.toString(16);
    expect(() => readOprfPublicInputs(circuit, atP)).toThrow(/not a field element/);
  });
  it('an unknown circuit throws', () => {
    expect(() => readOprfPublicInputs('oidc_domain_attestation', vec(214))).toThrow(/has no OPRF nullifier/);
  });
});

describe('deadline and typed data', () => {
  const now = 1_800_000_000;
  it.each([
    [now - 1, /has passed/], [now + 601, /more than 600 s/], [1.5, /non-negative integer/], [-1, /non-negative integer/],
  ])('refuses deadline %p', (deadline, msg) => {
    expect(oprfDeadlineError(deadline, now)).toMatch(msg);
    expect(() => oprfRequestTypedData({domainName: 'a', scopeName: 'b', deadline: deadline as number, nowSeconds: now})).toThrow(msg);
  });
  it.each([now, now + 600])('accepts deadline %p', deadline => {
    expect(oprfDeadlineError(deadline, now)).toBeNull();
  });
});

describe('points', () => {
  const v = vectors.evaluations[0];
  const offCurve = {x: '0x01', y: '0x02'};
  it.each([
    ['an off-curve public key', {publicKey: offCurve}],
    ['an off-curve response', {blindedResponse: offCurve}],
    ['the identity as public key', {publicKey: {x: '0x00', y: '0x01'}}],
    ['the identity as response', {blindedResponse: {x: '0x00', y: '0x01'}}],
    ['a coordinate at p', {publicKey: {x: '0x' + P.toString(16), y: v.publicKey.y}}],
  ])('the DLog check refuses %s', (_l, over) => {
    expect(() => verifyOprfDlogEquality({publicKey: v.publicKey, blindedQuery: v.blindedQuery, blindedResponse: v.blindedResponse, e: v.dlogE, s: v.dlogS, ...over})).toThrow();
  });
  it('a point of order 2 (outside the prime-order subgroup) is refused', () => {
    expect(() => unblindOprfResponse({x: '0x00', y: '0x' + (P - 1n).toString(16)}, v.beta)).toThrow(/subgroup/);
  });
  it('e + 1 does not verify', () => {
    expect(verifyOprfDlogEquality({publicKey: v.publicKey, blindedQuery: v.blindedQuery, blindedResponse: v.blindedResponse,
      e: '0x' + (BigInt(v.dlogE) + 1n).toString(16), s: v.dlogS})).toBe(false);
  });
  it('a zero blinding factor is refused', () => {
    expect(() => blindOprfQuery(v.query, '0x00')).toThrow(/zero/);
    expect(() => finalizeOprf({address: v.address, domain: v.domain, scope: v.scope, beta: '0x00', publicKey: v.publicKey,
      blindedResponse: v.blindedResponse, dlogE: v.dlogE, dlogS: v.dlogS})).toThrow(/zero/);
  });
  it('domain and scope swapped is another query, and the answer is refused for it', () => {
    expect(() => finalizeOprf({address: v.address, domain: v.scope, scope: v.domain, beta: v.beta, publicKey: v.publicKey,
      blindedResponse: v.blindedResponse, dlogE: v.dlogE, dlogS: v.dlogS})).toThrow(/does not verify/);
  });
  void GENERATOR; void IDENTITY;
});

describe('the request proof\'s witness', () => {
  // The fixture is anvil account 0's signature; ethers signs deterministically (RFC 6979), so signing the same
  // typed data with that key gives the Prover.toml's signature.
  const anvil0 = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const typed = oprfRequestTypedData({domainName: fixture.domainName, scopeName: fixture.scopeName, deadline: fixture.deadline, nowSeconds: fixture.deadline - 1});
  let signature = '';
  beforeAll(async () => {
    signature = await anvil0._signTypedData(typed.domain, {OprfRequest: [...typed.types.OprfRequest]}, typed.message);
  });
  const hexB = (b: number[]) => b.map(x => '0x' + x.toString(16).padStart(2, '0'));

  it('equals circuits/oprf-request-auth-poc/Prover.toml, input for input', () => {
    const inputs = requestAuthInputs({domainName: fixture.domainName, scopeName: fixture.scopeName, deadline: fixture.deadline, signature}, fixture.address, fixture.beta);
    expect(inputs).toEqual([
      ...hexB(fixture.digest), fixture.domain, fixture.scope,
      ...hexB(fixture.user_pubkey_x), ...hexB(fixture.user_pubkey_y), ...hexB(fixture.user_signature), fixture.beta,
    ]);
  });

  it('the expected public inputs equal the proof bb wrote for that witness', () => {
    const v = vectors.evaluations[0];
    const exp = expectedRequestAuthPublicInputs({domainName: fixture.domainName, scopeName: fixture.scopeName, deadline: fixture.deadline}, v.blindedQuery);
    // Digest bytes: the Prover.toml's (the circuit's target/proof was written for
    // another deadline -- a stale proof file in circuits, so only 32-35 are compared with it).
    expect(exp.slice(0, 32).map(x => Number(BigInt(x)))).toEqual(fixture.digest);
    expect(exp.slice(32)).toEqual(fixture.publicInputs.slice(32));
    expect(fixture.proofBytes).toBe(REQUEST_AUTH_PROOF_BYTES);
    expect(() => checkRequestAuthProof({proof: new Uint8Array(REQUEST_AUTH_PROOF_BYTES), publicInputs: exp}, exp)).not.toThrow();
    const tampered = [...exp];
    tampered[33] = exp[32];
    expect(() => checkRequestAuthProof({proof: new Uint8Array(REQUEST_AUTH_PROOF_BYTES), publicInputs: tampered}, exp)).toThrow(/public input 33/);
  });

  it('a signature by another wallet is refused before proving', () => {
    expect(() => requestAuthInputs({domainName: fixture.domainName, scopeName: fixture.scopeName, deadline: fixture.deadline, signature},
      '0x' + '11'.repeat(20), fixture.beta)).toThrow(/signed by 0xf39F/i);
  });

  it('a signature over another deadline recovers another key, refused', () => {
    expect(() => requestAuthInputs({domainName: fixture.domainName, scopeName: fixture.scopeName, deadline: fixture.deadline + 1, signature},
      fixture.address, fixture.beta)).toThrow(/signed by/);
  });
});

describe('the eleven values go where the circuits read them', () => {
  const o = vectorOprf();
  it('four public in order, seven private in order', () => {
    expect(oprfPublicInputs(o)).toEqual([o.oprf_key_hash, o.domain, o.scope, o.nullifier]);
    expect(oprfPrivateInputs(o)).toEqual([o.oprf_public_key_x, o.oprf_public_key_y, o.oprf_beta, o.oprf_dlog_e, o.oprf_dlog_s, o.oprf_response_x, o.oprf_response_y]);
  });
  it('refuses a missing or malformed value', () => {
    expect(() => oprfPublicInputs({...o, nullifier: undefined as unknown as string})).toThrow(/nullifier/);
    expect(() => oprfPrivateInputs({...o, oprf_beta: '0x01'})).toThrow(/oprf_beta/);
  });
  it('the statement\'s scope bytes are keccak256 mod p, not the raw keccak', () => {
    // 'zkproofport.app' is a name whose keccak256 is above p.
    const raw = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('zkproofport.app'));
    expect(BigInt(raw) >= P).toBe(true);
    expect(BigInt(ethers.utils.hexlify(oprfScopeBytesOf('zkproofport.app')))).toBe(BigInt(raw) % P);
    expect(() => oprfScopeBytesOf('')).toThrow();
  });
});
