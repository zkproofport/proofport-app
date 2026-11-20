/**
 * The bytes exchanged with the OPRF nodes: a strict CBOR subset and the
 * nodes' point / scalar encodings.
 *
 * The nodes speak CBOR (ciborium) over WebSocket. Their Rust types serialize
 * through serde, and because CBOR is not a "human-readable" format every curve
 * point and field element goes out as a 32-byte byte string (arkworks'
 * compressed form), a request id as its 16 bytes, a party id and an epoch as
 * plain integers, and a struct as a map keyed by field name in declaration
 * order. Shapes read from taceo-oprf-types 0.16.2 (api.rs, crypto.rs),
 * taceo-oprf-core 0.6.3 (ddlog_equality.rs) and taceo-ark-serde-compat 0.6.1;
 * held byte for byte to those crates by
 * __tests__/fixtures/oprf-wire-vectors.json (scripts/oprf-wire-oracle).
 *
 * Everything read from a node is untrusted: a point must be on the curve and
 * in the prime-order subgroup, a scalar below the group order, a field below
 * p, and anything malformed is an error naming what, never a default.
 */
import {ethers} from 'ethers';
import {A, D, isInSubgroup, type Point} from './curve/babyjubjub';
import {P, R, bytesToBigInt, invMod, legendre, mod, sqrtMod} from './curve/field';

// ---- CBOR -------------------------------------------------------------------

/** What this client sends: maps (insertion order kept), arrays, text, bytes, unsigned integers. */
export type CborValue = string | number | Uint8Array | CborValue[] | {[key: string]: CborValue};
/** What it reads: the same, plus booleans and null. */
export type CborRead = string | number | boolean | null | Uint8Array | CborRead[] | Map<string, CborRead>;

function head(major: number, n: number, out: number[]): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`CBOR length/value ${n} is not a non-negative integer.`);
  const m = major << 5;
  if (n < 24) out.push(m | n);
  else if (n < 0x100) out.push(m | 24, n);
  else if (n < 0x10000) out.push(m | 25, n >> 8, n & 0xff);
  else if (n < 0x100000000) out.push(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  else {
    const hi = Math.floor(n / 0x100000000);
    const lo = n >>> 0;
    out.push(m | 27, (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  }
}

function encodeInto(v: CborValue, out: number[]): void {
  if (typeof v === 'number') return head(0, v, out);
  if (typeof v === 'string') {
    const b = ethers.utils.toUtf8Bytes(v);
    head(3, b.length, out);
    for (const x of b) out.push(x);
    return;
  }
  if (v instanceof Uint8Array) {
    head(2, v.length, out);
    for (const x of v) out.push(x);
    return;
  }
  if (Array.isArray(v)) {
    head(4, v.length, out);
    for (const x of v) encodeInto(x, out);
    return;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    head(5, keys.length, out);
    for (const k of keys) {
      encodeInto(k, out);
      encodeInto(v[k], out);
    }
    return;
  }
  throw new Error(`CBOR cannot encode ${v === null ? 'null' : typeof v} here.`);
}

export function cborEncode(v: CborValue): Uint8Array {
  const out: number[] = [];
  encodeInto(v, out);
  return Uint8Array.from(out);
}

const MAX_DEPTH = 16;

/** Bytes following the initial byte for each additional-info value 24-27. */
const ARG_BYTES: Readonly<Record<number, number>> = Object.freeze({24: 1, 25: 2, 26: 4, 27: 8});

/** Strict UTF-8: overlong forms, surrogates and code points past U+10FFFF are refused. */
function decodeUtf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp: number;
    let n: number;
    if (c < 0x80) { cp = c; n = 0; } else if (c >= 0xc2 && c < 0xe0) { cp = c & 0x1f; n = 1; } else if (c >= 0xe0 && c < 0xf0) { cp = c & 0x0f; n = 2; } else if (c >= 0xf0 && c < 0xf5) { cp = c & 0x07; n = 3; } else {
      throw new Error('CBOR text is not valid UTF-8.');
    }
    for (let k = 1; k <= n; k++) {
      const cc = b[i + k];
      if (cc === undefined || (cc & 0xc0) !== 0x80) throw new Error('CBOR text is not valid UTF-8.');
      cp = (cp << 6) | (cc & 0x3f);
    }
    if ((n === 2 && cp < 0x800) || (n === 3 && cp < 0x10000) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      throw new Error('CBOR text is not valid UTF-8.');
    }
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}

/**
 * Decode exactly one CBOR item filling `bytes`. Definite lengths only;
 * integers above 2^53 - 1, negative integers, floats, tags, duplicate map
 * keys and non-text map keys are refused: nothing the nodes send uses them.
 */
export function cborDecode(bytes: Uint8Array): CborRead {
  if (!(bytes instanceof Uint8Array)) throw new Error('CBOR input must be bytes.');
  let pos = 0;
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new Error('CBOR message ends early.');
  };
  const readArg = (info: number): number => {
    if (info < 24) return info;
    const len = ARG_BYTES[info];
    if (len === undefined) throw new Error(`CBOR additional info ${info} is not supported (indefinite or reserved).`);
    need(len);
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 256 + bytes[pos++];
      if (v > Number.MAX_SAFE_INTEGER) throw new Error('CBOR integer is too large.');
    }
    return v;
  };
  const item = (depth: number): CborRead => {
    if (depth > MAX_DEPTH) throw new Error('CBOR nesting is too deep.');
    need(1);
    const ib = bytes[pos++];
    const major = ib >> 5;
    const info = ib & 0x1f;
    switch (major) {
      case 0:
        return readArg(info);
      case 2: {
        const n = readArg(info);
        need(n);
        const out = bytes.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 3: {
        const n = readArg(info);
        need(n);
        const out = decodeUtf8(bytes.subarray(pos, pos + n));
        pos += n;
        return out;
      }
      case 4: {
        const n = readArg(info);
        if (n > bytes.length - pos) throw new Error('CBOR array is longer than the message.');
        const out: CborRead[] = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        const n = readArg(info);
        if (n > bytes.length - pos) throw new Error('CBOR map is longer than the message.');
        const out = new Map<string, CborRead>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          if (typeof k !== 'string') throw new Error('CBOR map key is not text.');
          if (out.has(k)) throw new Error(`CBOR map repeats the key '${k}'.`);
          out.set(k, item(depth + 1));
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error(`CBOR simple value / float ${info} is not supported.`);
      default:
        throw new Error(`CBOR major type ${major} is not supported.`);
    }
  };
  const v = item(0);
  if (pos !== bytes.length) throw new Error(`CBOR message has ${bytes.length - pos} trailing bytes.`);
  return v;
}

// ---- points, scalars, ids ------------------------------------------------------

function leBytes32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) throw new Error('value does not fit 32 bytes');
  return out;
}

const fromLe = (b: Uint8Array): bigint => bytesToBigInt(Uint8Array.from(b).reverse());

/** arkworks' "x is positive": x <= -x as canonical integers. */
const xIsPositive = (x: bigint): boolean => x <= mod(-x);

/** A BabyJubJub point as arkworks compresses it: y little-endian, bit 255 set when x is "negative". */
export function encodePoint(p: Point): Uint8Array {
  if (!isInSubgroup(p)) throw new Error('Refusing to encode a point outside BabyJubJub\'s prime-order subgroup.');
  const out = leBytes32(p.y);
  if (!xIsPositive(p.x)) out[31] |= 0x80;
  return out;
}

/**
 * The point a node sent. On the curve and in the prime-order subgroup, or an
 * error naming `what`. The identity is returned (it IS a subgroup point);
 * callers that must refuse it do so by name.
 */
export function decodePoint(bytes: unknown, what: string): Point {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error(`${what} must be a 32-byte compressed point.`);
  }
  const negative = (bytes[31] & 0x80) !== 0;
  const yBytes = Uint8Array.from(bytes);
  yBytes[31] &= 0x7f;
  const y = fromLe(yBytes);
  if (y >= P) throw new Error(`${what} has a y coordinate at or above the field modulus.`);
  const y2 = (y * y) % P;
  const den = mod(A - D * y2);
  if (den === 0n) throw new Error(`${what} has no x coordinate for its y.`);
  const x2 = mod((1n - y2) * invMod(den));
  if (legendre(x2) === -1) throw new Error(`${what} is not on BabyJubJub (no x for its y).`);
  const root = sqrtMod(x2);
  const small = xIsPositive(root) ? root : mod(-root);
  const x = negative ? mod(-small) : small;
  const p = {x, y};
  if (!isInSubgroup(p)) throw new Error(`${what} is not in BabyJubJub's prime-order subgroup.`);
  return p;
}

/** A BabyJubJub scalar (below r), 32 bytes little-endian. */
export function encodeScalar(s: bigint): Uint8Array {
  if (s < 0n || s >= R) throw new Error('scalar is not below the group order');
  return leBytes32(s);
}

export function decodeScalar(bytes: unknown, what: string): bigint {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error(`${what} must be a 32-byte scalar.`);
  const v = fromLe(bytes);
  if (v >= R) throw new Error(`${what} is not below the group order.`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidBytes(id: string): Uint8Array {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error(`request id must be a lowercase UUID, got ${JSON.stringify(id)}.`);
  const hex = id.replace(/-/g, '');
  return Uint8Array.from({length: 16}, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}

/** A v4 UUID from a secure random source. No source -> throws, never a weaker one. */
export function randomUuidV4(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(16);
  if (!(b instanceof Uint8Array) || b.length !== 16) throw new Error('random source returned the wrong number of bytes');
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- messages ---------------------------------------------------------------------

/** One node's round-1 answer (taceo-oprf-types `OprfResponse`). */
export interface NodeCommitments {
  partyId: number;
  c: Point;
  d1: Point;
  d2: Point;
  e1: Point;
  e2: Point;
  publicKey: Point;
  epoch: number;
}

/** The combined commitments sent back in round 2 (`DLogCommitmentsShamir`). */
export interface CombinedCommitments {
  c: Point;
  d1: Point;
  d2: Point;
  e1: Point;
  e2: Point;
  /** Party id + 1 of each contributing node, ascending. */
  contributingParties: number[];
}

/** `OprfRequest<Auth>`: request id, blinded query, the auth module's own object. */
export function encodeOprfRequest(requestId: string, blindedQuery: Point, auth: {[key: string]: CborValue}): Uint8Array {
  return cborEncode({request_id: uuidBytes(requestId), blinded_query: encodePoint(blindedQuery), auth});
}

function field(map: CborRead, key: string, what: string): CborRead {
  if (!(map instanceof Map)) throw new Error(`${what} is not a CBOR map.`);
  if (!map.has(key)) throw new Error(`${what} has no '${key}'.`);
  return map.get(key) as CborRead;
}

function uint(v: CborRead, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw new Error(`${what} must be an integer 0..${max}.`);
  return v;
}

export function decodeOprfResponse(bytes: Uint8Array): NodeCommitments {
  const msg = cborDecode(bytes);
  const comm = field(msg, 'commitments', 'node response');
  const withEpoch = field(msg, 'oprf_pub_key_with_epoch', 'node response');
  return {
    partyId: uint(field(msg, 'party_id', 'node response'), 0xffff, 'party_id'),
    c: decodePoint(field(comm, 'c', 'commitments'), 'commitment c'),
    d1: decodePoint(field(comm, 'd1', 'commitments'), 'commitment d1'),
    d2: decodePoint(field(comm, 'd2', 'commitments'), 'commitment d2'),
    e1: decodePoint(field(comm, 'e1', 'commitments'), 'commitment e1'),
    e2: decodePoint(field(comm, 'e2', 'commitments'), 'commitment e2'),
    publicKey: decodePoint(field(withEpoch, 'key', 'oprf_pub_key_with_epoch'), 'OPRF public key'),
    epoch: uint(field(withEpoch, 'epoch', 'oprf_pub_key_with_epoch'), 0xffffffff, 'epoch'),
  };
}

export function encodeChallenge(ch: CombinedCommitments): Uint8Array {
  return cborEncode({
    c: encodePoint(ch.c),
    d1: encodePoint(ch.d1),
    d2: encodePoint(ch.d2),
    e1: encodePoint(ch.e1),
    e2: encodePoint(ch.e2),
    contributing_parties: ch.contributingParties.map(p => {
      if (!Number.isInteger(p) || p < 1 || p > 0xffff) throw new Error(`contributing party ${p} is not 1..65535`);
      return p;
    }),
  });
}

/** One node's round-2 answer (`DLogProofShareShamir`): its share of s. */
export function decodeProofShare(bytes: Uint8Array): bigint {
  return decodeScalar(cborDecode(bytes), 'proof share');
}
