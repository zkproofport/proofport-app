/**
 * BN254 scalar field arithmetic (what a Noir `Field` holds, and BabyJubJub's
 * base field) for the app's own node transport: point decompression in
 * ./../wire.ts and the Lagrange / challenge arithmetic in ../shamir.ts.
 *
 * Why this stays in the app: `@zkproofport-app/core` ships the OPRF client
 * (query, blinding, DLog check, unblinding, nullifier) but does not export its
 * low-level field and curve arithmetic, and the transport to the nodes is the
 * app's own code. Everything the client computes comes from core; only the
 * arithmetic the transport needs is here. Plain bigint, no dependencies.
 */

/** BN254 scalar field modulus p. */
export const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Order r of BabyJubJub's prime-order subgroup: an OPRF key, a blinding factor and `s` are below it. */
export const R = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

export function mod(a: bigint, m: bigint = P): bigint {
  const x = a % m;
  return x < 0n ? x + m : x;
}

export function powMod(base: bigint, exp: bigint, m: bigint = P): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** a^-1 mod m; 0 has none and throws. */
export function invMod(a: bigint, m: bigint = P): bigint {
  const x = mod(a, m);
  if (x === 0n) throw new Error('0 has no inverse');
  // Extended Euclid; m is prime in every use here.
  let [oldR, r] = [x, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

/** 1 for a non-zero square, -1 for a non-square, 0 for 0 (mod p). */
export function legendre(a: bigint): -1 | 0 | 1 {
  const x = mod(a);
  if (x === 0n) return 0;
  return powMod(x, (P - 1n) / 2n) === 1n ? 1 : -1;
}

// Tonelli-Shanks for p - 1 = 2^28 * Q.
const S = 28n;
const Q = (P - 1n) >> S;
const NON_RESIDUE = 5n;

/** A square root of a square mod p; throws for a non-square. Which root is not specified. */
export function sqrtMod(a: bigint): bigint {
  const n = mod(a);
  if (n === 0n) return 0n;
  if (legendre(n) !== 1) throw new Error('not a square');
  let m = S;
  let c = powMod(NON_RESIDUE, Q);
  let t = powMod(n, Q);
  let r = powMod(n, (Q + 1n) / 2n);
  while (t !== 1n) {
    let i = 0n;
    let t2 = t;
    while (t2 !== 1n) {
      t2 = (t2 * t2) % P;
      i++;
    }
    const b = powMod(c, 1n << (m - i - 1n));
    m = i;
    c = (b * b) % P;
    t = (t * c) % P;
    r = (r * b) % P;
  }
  return r;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}
