/**
 * In-memory OPRF nodes for the flow tests: each holds a Shamir share of one
 * key and answers the two rounds exactly as taceo-oprf-core 0.6.3's server
 * does (DLogSessionShamir::partial_commitments, ::challenge), over the same
 * CBOR messages. Behaviours let a test take a node down, delay it, make it
 * refuse, or make it lie in a specific way.
 */
import {OPRF_DS_DLOG, poseidon2T16} from '@zkproofport-app/core';
import {GENERATOR, scalarMul, type Point} from '../../curve/babyjubjub';
import {R, mod} from '../../curve/field';
import {cborDecode, cborEncode, decodePoint, encodePoint, encodeScalar, type CborRead} from '../../wire';
import {combinedNonces, lagrangeCoefficient} from '../../shamir';
import type {NodeConnector, NodeEvent, NodeSession} from '../../transport';

export type NodeBehaviour =
  | 'honest'
  | 'down' // the socket errors at once
  | 'silent' // accepts the request and never answers
  | {refuse: number; reason: string} // closes with this code on the request
  | 'bad-share' // round 2: a share off by one
  | 'other-key' // answers with another key (its own share of another secret) and that key
  | 'other-epoch' // claims another epoch
  | 'off-curve' // round 1: a commitment that is not a curve point
  | 'text-frame' // round 1: a text frame
  | 'same-party-as-0'; // claims party id 0

export interface MockNetwork {
  connect: NodeConnector;
  publicKey: Point;
  secretKey: bigint;
  /** Every request each node received, decoded. */
  requests: Array<{host: string; url: string; auth: Map<string, CborRead>; blindedQuery: Point; requestId: string}>;
  closed: string[];
}

const rand = (seed: {v: bigint}) => {
  seed.v = mod(seed.v * 6364136223846793005n + 1442695040888963407n, R - 1n) + 1n;
  return seed.v;
};

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const uuidOf = (b: Uint8Array) => {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function mockNetwork(behaviours: NodeBehaviour[], opts: {secretKey?: bigint; epoch?: number} = {}): MockNetwork {
  const k = opts.secretKey ?? 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdn % R;
  const a1 = 0x2468ace02468ace02468ace0n;
  const otherK = mod(k + 99n, R);
  const share = (key: bigint, partyNumber: number) => mod(key + a1 * BigInt(partyNumber), R);
  const publicKey = scalarMul(GENERATOR, k);
  const net: MockNetwork = {connect: () => { throw new Error('unset'); }, publicKey, secretKey: k, requests: [], closed: []};
  const seed = {v: 12345n};

  net.connect = (url: string): NodeSession => {
    const host = new URL(url.replace(/^wss?:/, 'https:')).host;
    const index = Number(host.match(/node(\d+)/)?.[1]);
    const behaviour = behaviours[index];
    if (behaviour === undefined) throw new Error(`no mock node for ${host}`);
    const partyId = behaviour === 'same-party-as-0' ? 0 : index;
    const key = behaviour === 'other-key' ? otherK : k;
    const xShare = share(key, partyId + 1);
    const queue: NodeEvent[] = [];
    const waiters: ((e: NodeEvent) => void)[] = [];
    const push = (e: NodeEvent) => {
      const w = waiters.shift();
      if (w) w(e);
      else queue.push(e);
    };
    let round = 0;
    let session: {d: bigint; e: bigint; a: Point; requestId: string} | null = null;
    if (behaviour === 'down') setTimeout(() => push({kind: 'error', message: 'connection refused'}), 0);
    return {
      send(bytes: Uint8Array) {
        if (behaviour === 'down' || behaviour === 'silent') return;
        if (round === 0) {
          round = 1;
          const msg = cborDecode(bytes) as Map<string, CborRead>;
          const a = decodePoint(msg.get('blinded_query'), 'blinded_query');
          const requestId = uuidOf(msg.get('request_id') as Uint8Array);
          net.requests.push({host, url, auth: msg.get('auth') as Map<string, CborRead>, blindedQuery: a, requestId});
          if (typeof behaviour === 'object') {
            setTimeout(() => push({kind: 'close', code: behaviour.refuse, reason: behaviour.reason}), 0);
            return;
          }
          if (behaviour === 'text-frame') {
            setTimeout(() => push({kind: 'error', message: 'text frame received'}), 0);
            return;
          }
          const d = rand(seed);
          const e = rand(seed);
          session = {d, e, a, requestId};
          const commitments = {
            c: encodePoint(scalarMul(a, xShare)),
            d1: encodePoint(scalarMul(GENERATOR, d)),
            d2: encodePoint(scalarMul(a, d)),
            e1: encodePoint(scalarMul(GENERATOR, e)),
            e2: encodePoint(scalarMul(a, e)),
          };
          if (behaviour === 'off-curve') {
            const bad = new Uint8Array(32);
            bad[0] = 2; // y = 2 has no subgroup point
            commitments.d1 = bad;
          }
          const reply = cborEncode({
            commitments,
            party_id: partyId,
            oprf_pub_key_with_epoch: {
              key: encodePoint(scalarMul(GENERATOR, key)),
              epoch: behaviour === 'other-epoch' ? (opts.epoch ?? 0) + 1 : opts.epoch ?? 0,
            },
          });
          setTimeout(() => push({kind: 'binary', bytes: reply}), 0);
          return;
        }
        // round 2
        const msg = cborDecode(bytes) as Map<string, CborRead>;
        const parties = (msg.get('contributing_parties') as number[]).slice();
        const ch = {
          c: decodePoint(msg.get('c'), 'c'), d1: decodePoint(msg.get('d1'), 'd1'), d2: decodePoint(msg.get('d2'), 'd2'),
          e1: decodePoint(msg.get('e1'), 'e1'), e2: decodePoint(msg.get('e2'), 'e2'), contributingParties: parties,
        };
        const s = session!;
        const pk = scalarMul(GENERATOR, key);
        const {r1, r2} = combinedNonces(s.requestId, pk, ch);
        // b is not exposed by combinedNonces; recompute it the way the node does.
        const b = nonceFactor(s.requestId, pk, ch);
        const eChallenge = poseidon2T16([
          OPRF_DS_DLOG, pk.x, pk.y, s.a.x, s.a.y, ch.c.x, ch.c.y, GENERATOR.x, GENERATOR.y, r1.x, r1.y, r2.x, r2.y, 0n, 0n, 0n,
        ])[1];
        const lambda = lagrangeCoefficient(partyId + 1, parties);
        let shareOut = mod(s.d + b * s.e + lambda * mod(eChallenge, R) * xShare, R);
        if (behaviour === 'bad-share') shareOut = mod(shareOut + 1n, R);
        const reply = cborEncode(encodeScalar(shareOut));
        setTimeout(() => push({kind: 'binary', bytes: reply}), 0);
      },
      next() {
        const e = queue.shift();
        if (e) return Promise.resolve(e);
        return new Promise(resolve => waiters.push(resolve));
      },
      close() {
        net.closed.push(host);
      },
    };
  };
  return net;
}

// b from combine_two_nonce_randomness, recomputed (shamir.ts keeps it private).
import {blake3} from '../../blake3';
import {bytesToBigInt} from '../../curve/field';
import {uuidBytes, type CombinedCommitments} from '../../wire';
function nonceFactor(requestId: string, pk: Point, ch: CombinedCommitments): bigint {
  const parts = [
    Uint8Array.from('FROST_2_NONCE_COMBINER', c => c.charCodeAt(0)),
    uuidBytes(requestId),
    ...ch.contributingParties.map(p => Uint8Array.of(p & 0xff, p >> 8)),
    encodePoint(pk), encodePoint(ch.c), encodePoint(ch.d1), encodePoint(ch.d2), encodePoint(ch.e1), encodePoint(ch.e2),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return mod(bytesToBigInt(Uint8Array.from(blake3(all, 64)).reverse()), R);
}

export const TEST_NODES = ['https://node0.mock', 'https://node1.mock', 'https://node2.mock'];
