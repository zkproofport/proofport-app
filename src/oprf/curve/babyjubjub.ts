/**
 * BabyJubJub point arithmetic (EIP-2494: a*x^2 + y^2 = 1 + d*x^2*y^2 over the
 * BN254 scalar field, a = 168700, d = 168696, prime-order subgroup of order R)
 * for the app's own node transport: point decompression in ../wire.ts and the
 * threshold combination in ../shamir.ts.
 *
 * Why this stays in the app: `@zkproofport-app/core` exports the OPRF client,
 * `isOnCurve`, `isInSubgroup`, `encodeToCurve` and `BABYJUBJUB_GENERATOR`, but
 * not point addition or scalar multiplication, which the Lagrange combination
 * of the nodes' commitments needs. Subgroup membership and the generator are
 * core's, re-exported here so the transport has one import.
 */
import {BABYJUBJUB_GENERATOR, isInSubgroup, isOnCurve} from '@zkproofport-app/core';
import {P, invMod, mod} from './field';

export interface Point {
  readonly x: bigint;
  readonly y: bigint;
}

export const A = 168700n;
export const D = 168696n;

export const IDENTITY: Point = Object.freeze({x: 0n, y: 1n});

/** The prime-order subgroup's generator (core's BABYJUBJUB_GENERATOR). */
export const GENERATOR: Point = BABYJUBJUB_GENERATOR;

export {isInSubgroup, isOnCurve};

export const isIdentity = (p: Point): boolean => p.x === 0n && p.y === 1n;

// Projective (X : Y : Z) with x = X/Z, y = Y/Z. The twisted Edwards addition
// below (add-2008-bbjlp) is complete on BabyJubJub (a square, d not), so one
// formula serves for doubling and for the identity.
interface Projective {
  X: bigint;
  Y: bigint;
  Z: bigint;
}

function addProjective(p: Projective, q: Projective): Projective {
  const a = (p.Z * q.Z) % P;
  const b = (a * a) % P;
  const c = (p.X * q.X) % P;
  const d = (p.Y * q.Y) % P;
  const e = (((D * c) % P) * d) % P;
  const f = mod(b - e);
  const g = (b + e) % P;
  const h = mod((((p.X + p.Y) % P) * ((q.X + q.Y) % P)) % P - c - d);
  return {
    X: (((a * f) % P) * h) % P,
    Y: (((a * g) % P) * mod(d - A * c)) % P,
    Z: (f * g) % P,
  };
}

const toProjective = (p: Point): Projective => ({X: p.x, Y: p.y, Z: 1n});

function toAffine(p: Projective): Point {
  const zInv = invMod(p.Z);
  return {x: (p.X * zInv) % P, y: (p.Y * zInv) % P};
}

export const add = (p: Point, q: Point): Point => toAffine(addProjective(toProjective(p), toProjective(q)));

/** k * p for any non-negative integer k (not reduced: callers decide the modulus). */
export function scalarMul(p: Point, k: bigint): Point {
  if (k < 0n) throw new Error('negative scalar');
  let acc: Projective = {X: 0n, Y: 1n, Z: 1n};
  let base = toProjective(p);
  let e = k;
  while (e > 0n) {
    if (e & 1n) acc = addProjective(acc, base);
    base = addProjective(base, base);
    e >>= 1n;
  }
  return toAffine(acc);
}
