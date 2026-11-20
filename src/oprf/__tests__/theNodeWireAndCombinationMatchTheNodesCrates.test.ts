/**
 * The client's CBOR messages, point/scalar encodings and Shamir combination,
 * against the bytes and values the nodes' own Rust crates produce
 * (scripts/oprf-wire-oracle -> fixtures/oprf-wire-vectors.json): three 2-of-3
 * cases over party pairs {0,1}, {0,2}, {1,2} and epochs 0, 3, 2^32-1.
 */
import vectors from './fixtures/oprf-wire-vectors.json';
import {
  cborDecode, cborEncode, decodeOprfResponse, decodePoint, decodeProofShare, encodeChallenge,
  encodeOprfRequest, encodePoint, decodeScalar, encodeScalar, uuidBytes, randomUuidV4,
} from '../wire';
import {combineCommitments, combineProofs, lagrangeCoefficient} from '../shamir';
import {verifyOprfDlogEquality} from '../core/client';
import {GENERATOR, IDENTITY, scalarMul} from '../core/babyjubjub';
import {P, R} from '../core/field';

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const pt = (p: string[]) => ({x: BigInt(p[0]), y: BigInt(p[1])});

describe.each(vectors.wire.cases.map(c => [c.seed, c]))('oracle case %i', (_seed, c) => {
  const kase = c as (typeof vectors.wire.cases)[number];
  const pk = pt(kase.public_key);
  const a = pt(kase.blinded_query);

  it('the request encodes to the crate\'s bytes', () => {
    expect(hex(encodeOprfRequest(kase.session_id, a, {api_key: 'taceo_test'}))).toBe(kase.request_cbor);
  });

  it('each node response decodes to the crate\'s values', () => {
    for (const r of kase.responses) {
      const got = decodeOprfResponse(hexToBytes(r.cbor));
      expect(got.partyId).toBe(r.party_id);
      expect(got.epoch).toBe(kase.epoch);
      expect(got.publicKey).toEqual(pk);
      for (const k of ['c', 'd1', 'd2', 'e1', 'e2'] as const) {
        expect(got[k]).toEqual(pt((r.commitments as unknown as Record<string, string[]>)[k]));
        expect(hex(encodePoint(got[k]))).toBe(hex(cborDecode(hexToBytes(r.cbor)) instanceof Map
          ? ((cborDecode(hexToBytes(r.cbor)) as Map<string, any>).get('commitments') as Map<string, Uint8Array>).get(k)!
          : new Uint8Array()));
      }
    }
  });

  it('the combined challenge equals the crate\'s, value and bytes', () => {
    const nodes = kase.responses.map(r => decodeOprfResponse(hexToBytes(r.cbor)));
    const ch = combineCommitments([...nodes].reverse());
    expect(ch.contributingParties).toEqual(kase.challenge.contributing_parties);
    expect(ch.c).toEqual(pt(kase.challenge.c));
    expect(ch.d1).toEqual(pt(kase.challenge.d1));
    expect(ch.e2).toEqual(pt(kase.challenge.e2));
    expect(hex(encodeChallenge(ch))).toBe(kase.challenge_cbor);
    expect(ch.c).toEqual(pt(kase.blinded_response));
  });

  it('the combined proof equals the crate\'s (e, s) and verifies', () => {
    const nodes = kase.responses.map(r => decodeOprfResponse(hexToBytes(r.cbor)));
    const ch = combineCommitments(nodes);
    const shares = kase.proof_shares.map(s => decodeProofShare(hexToBytes(s.cbor)));
    expect(shares.map(String)).toEqual(kase.proof_shares.map(s => s.share));
    const {e, s} = combineProofs({requestId: kase.session_id, publicKey: pk, blindedQuery: a, challenge: ch, shares});
    expect(e.toString()).toBe(kase.e);
    expect(s.toString()).toBe(kase.s);
    expect(verifyOprfDlogEquality({publicKey: pk, blindedQuery: a, blindedResponse: ch.c, e, s})).toBe(true);
    // The response is k * A.
    expect(ch.c).toEqual(scalarMul(a, BigInt(kase.secret_key)));
  });

  it('a share from another request id gives a proof that does not verify', () => {
    const nodes = kase.responses.map(r => decodeOprfResponse(hexToBytes(r.cbor)));
    const ch = combineCommitments(nodes);
    const shares = kase.proof_shares.map(s => decodeProofShare(hexToBytes(s.cbor)));
    const other = '00000000-0000-4000-8000-000000000000';
    const {e, s} = combineProofs({requestId: other, publicKey: pk, blindedQuery: a, challenge: ch, shares});
    expect(verifyOprfDlogEquality({publicKey: pk, blindedQuery: a, blindedResponse: ch.c, e, s})).toBe(false);
  });
});

describe('point and scalar encoding', () => {
  it('round-trips the generator, its negation and the identity', () => {
    for (const p of [GENERATOR, {x: P - GENERATOR.x, y: GENERATOR.y}, IDENTITY]) {
      expect(decodePoint(encodePoint(p), 'p')).toEqual(p);
    }
  });
  it('refuses a y at or above p, a y with no x, a point outside the subgroup, a wrong length', () => {
    const big = new Uint8Array(32).fill(0xff);
    big[31] = 0x7f;
    expect(() => decodePoint(big, 'q')).toThrow('modulus');
    // y = 2: x^2 = (1-4)/(a - 4d) -- find whether off-curve or off-subgroup; both must refuse.
    let refusedOff = 0;
    for (let y = 2; y < 40; y++) {
      const b = new Uint8Array(32);
      b[0] = y;
      try { decodePoint(b, 'q'); } catch (e) { refusedOff++; expect(String(e)).toMatch(/not on BabyJubJub|subgroup|no x/); }
    }
    expect(refusedOff).toBeGreaterThan(30);
    expect(() => decodePoint(new Uint8Array(31), 'q')).toThrow('32-byte');
    expect(() => decodePoint('00' as unknown as Uint8Array, 'q')).toThrow('32-byte');
  });
  it('a scalar must be below r', () => {
    expect(decodeScalar(encodeScalar(R - 1n), 's')).toBe(R - 1n);
    const atR = Uint8Array.from(Buffer.from(R.toString(16).padStart(64, '0'), 'hex')).reverse();
    expect(() => decodeScalar(atR, 's')).toThrow('group order');
    expect(() => encodeScalar(R)).toThrow();
  });
});

describe('CBOR', () => {
  it('round-trips the shapes the client sends', () => {
    const v = {a: 1, b: 'x', c: Uint8Array.of(1, 2), d: [0, 23, 24, 255, 256, 65535, 65536, 2 ** 32, Number.MAX_SAFE_INTEGER], e: '한국어 🔐'};
    const back = cborDecode(cborEncode(v)) as Map<string, unknown>;
    expect(back.get('a')).toBe(1);
    expect(back.get('d')).toEqual(v.d);
    expect(back.get('e')).toBe(v.e);
    expect(back.get('c')).toEqual(v.c);
  });
  it.each([
    ['trailing bytes', '0000'],
    ['truncated', '5820ff'],
    ['indefinite length', '5f'],
    ['negative integer', '20'],
    ['float', 'f93c00'],
    ['tag', 'c000'],
    ['non-text map key', 'a10000'],
    ['repeated key', 'a2616100616100'],
    ['invalid UTF-8', '62c328'],
    ['overlong UTF-8', '62c0af'],
    ['surrogate in UTF-8', '63eda080'],
    ['integer above 2^53', '1b0020000000000000'],
    ['empty', ''],
    ['array longer than message', '9bffffffff'],
  ])('refuses %s', (_name, h) => {
    expect(() => cborDecode(hexToBytes(h))).toThrow();
  });
  it('refuses to encode a negative or fractional number, null and booleans', () => {
    expect(() => cborEncode(-1)).toThrow();
    expect(() => cborEncode(1.5)).toThrow();
    expect(() => cborEncode(null as unknown as number)).toThrow();
    expect(() => cborEncode(true as unknown as number)).toThrow();
  });
  it('refuses deep nesting', () => {
    expect(() => cborDecode(Uint8Array.from(new Array(40).fill(0x81).concat([0])))).toThrow('deep');
  });
});

describe('ids and Lagrange', () => {
  it('a request id is a lowercase UUID; v4 from the random source', () => {
    expect(uuidBytes('6f1d3c2a-8b47-4e0f-9a51-0c2d7e9b4f10').length).toBe(16);
    expect(() => uuidBytes('6F1D3C2A-8B47-4E0F-9A51-0C2D7E9B4F10')).toThrow();
    expect(() => uuidBytes('')).toThrow();
    const id = randomUuidV4(n => new Uint8Array(n).fill(0xff));
    expect(id).toMatch(/^ffffffff-ffff-4fff-bfff-ffffffffffff$/);
    expect(() => randomUuidV4(() => new Uint8Array(15))).toThrow();
  });
  it('Lagrange coefficients over {1,2} interpolate a line at 0', () => {
    const l1 = lagrangeCoefficient(1, [1, 2]);
    const l2 = lagrangeCoefficient(2, [1, 2]);
    // f(x) = 5 + 7x: f(1) = 12, f(2) = 19 -> f(0) = 5
    expect(((l1 * 12n + l2 * 19n) % R + R) % R).toBe(5n);
    expect(() => lagrangeCoefficient(3, [1, 2])).toThrow('not among');
  });
  it('combining refuses repeated parties and nothing', () => {
    expect(() => combineCommitments([])).toThrow();
  });
});
