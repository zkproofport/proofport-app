/**
 * The client's half of the nodes' threshold Chaum-Pedersen proof: combine the
 * round-1 commitments of the chosen nodes (Lagrange over their party ids) into
 * the challenge sent back in round 2, then combine the nodes' proof shares
 * into one (e, s) that the core client verifies like any other.
 *
 * A port of taceo-oprf-core 0.6.3 (ddlog_equality.rs, ddlog_equality/shamir.rs,
 * shamir.rs): `combine_commitments`, `combine_proofs`,
 * `combine_two_nonce_randomness` (BLAKE3 over the label, the request id, each
 * contributing party as u16 little-endian, and six compressed points; 64
 * output bytes reduced mod r). Held to that crate by
 * __tests__/fixtures/oprf-wire-vectors.json.
 */
import {GENERATOR, IDENTITY, add, isIdentity, scalarMul, type Point} from './core/babyjubjub';
import {R, bytesToBigInt, invMod, mod} from './core/field';
import {poseidon2T16} from './core/poseidon2';
import {OPRF_DS_DLOG} from './core/client';
import {blake3} from './blake3';
import {encodePoint, uuidBytes, type CombinedCommitments, type NodeCommitments} from './wire';

const FROST_2_NONCE_COMBINER_LABEL = Uint8Array.from('FROST_2_NONCE_COMBINER', c => c.charCodeAt(0));

/** prod_{j != i} j / (j - i) mod r, over the contributing party numbers (party id + 1). */
export function lagrangeCoefficient(i: number, parties: readonly number[]): bigint {
  if (!parties.includes(i)) throw new Error(`party ${i} is not among the contributing parties ${parties.join(', ')}`);
  let num = 1n;
  let den = 1n;
  for (const j of parties) {
    if (j === i) continue;
    num = mod(num * BigInt(j), R);
    den = mod(den * BigInt(j - i), R);
  }
  return mod(num * invMod(den, R), R);
}

/**
 * The round-2 challenge from exactly `threshold` nodes' round-1 answers,
 * sorted by party id (the nodes refuse unsorted or repeated parties).
 */
export function combineCommitments(nodes: readonly NodeCommitments[]): CombinedCommitments {
  if (nodes.length === 0) throw new Error('No node commitments to combine.');
  const sorted = [...nodes].sort((a, b) => a.partyId - b.partyId);
  const parties = sorted.map(n => n.partyId + 1);
  if (new Set(parties).size !== parties.length) throw new Error(`Party ids repeat: ${sorted.map(n => n.partyId).join(', ')}.`);
  let c: Point = IDENTITY;
  let d1: Point = IDENTITY;
  let d2: Point = IDENTITY;
  let e1: Point = IDENTITY;
  let e2: Point = IDENTITY;
  for (const n of sorted) {
    c = add(c, scalarMul(n.c, lagrangeCoefficient(n.partyId + 1, parties)));
    d1 = add(d1, n.d1);
    d2 = add(d2, n.d2);
    e1 = add(e1, n.e1);
    e2 = add(e2, n.e2);
  }
  return {c, d1, d2, e1, e2, contributingParties: parties};
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The combined nonce commitments r1, r2 (`combine_two_nonce_randomness`). */
export function combinedNonces(requestId: string, publicKey: Point, ch: CombinedCommitments): {r1: Point; r2: Point} {
  const parties = ch.contributingParties.map(p => Uint8Array.of(p & 0xff, (p >> 8) & 0xff));
  const digest = blake3(concat([
    FROST_2_NONCE_COMBINER_LABEL,
    uuidBytes(requestId),
    ...parties,
    encodePoint(publicKey),
    encodePoint(ch.c),
    encodePoint(ch.d1),
    encodePoint(ch.d2),
    encodePoint(ch.e1),
    encodePoint(ch.e2),
  ]), 64);
  const b = mod(bytesToBigInt(Uint8Array.from(digest).reverse()), R);
  return {r1: add(ch.d1, scalarMul(ch.e1, b)), r2: add(ch.d2, scalarMul(ch.e2, b))};
}

/**
 * (e, s) from the nodes' proof shares: s = sum of shares mod r, e the
 * challenge hash over (D, A, C, G, r1, r2). Not checked here; the caller
 * verifies it (core `verifyOprfDlogEquality` / `finalizeOprf`).
 */
export function combineProofs(args: {
  requestId: string;
  publicKey: Point;
  blindedQuery: Point;
  challenge: CombinedCommitments;
  shares: readonly bigint[];
}): {e: bigint; s: bigint} {
  if (args.shares.length !== args.challenge.contributingParties.length) {
    throw new Error(`${args.shares.length} proof shares for ${args.challenge.contributingParties.length} contributing nodes.`);
  }
  const s = args.shares.reduce((acc, x) => mod(acc + x, R), 0n);
  const {r1, r2} = combinedNonces(args.requestId, args.publicKey, args.challenge);
  if (isIdentity(r1) || isIdentity(r2)) throw new Error('The combined nonce commitment is the identity.');
  const d = args.publicKey;
  const a = args.blindedQuery;
  const c = args.challenge.c;
  const e = poseidon2T16([
    OPRF_DS_DLOG, d.x, d.y, a.x, a.y, c.x, c.y, GENERATOR.x, GENERATOR.y, r1.x, r1.y, r2.x, r2.y, 0n, 0n, 0n,
  ])[1];
  return {e, s};
}
