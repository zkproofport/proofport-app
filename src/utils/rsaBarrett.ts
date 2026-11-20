/**
 * The Barrett reduction parameter noir-bignum's BigNumParams expects for an RSA
 * modulus n of `bits` bits: floor(2^(2*bits + 6) / n).
 *
 * noir-bignum 0.9 (PR #241) added 6 overflow bits where 0.8 added 4, and a value
 * built with the old shift makes honest proving fail. The circuits this app pins
 * (circuitArtifacts.ts / CIRCUITS_RELEASE_TAG) are built with the noir-bignum in
 * circuits deps/MANIFEST.json, so this shift belongs to that circuit set and moves
 * only together with it.
 */
export const RSA_BARRETT_OVERFLOW_BITS = 6n;

export function rsaBarrettParam(modulus: bigint, bits: bigint): bigint {
  return (1n << (2n * bits + RSA_BARRETT_OVERFLOW_BITS)) / modulus;
}
