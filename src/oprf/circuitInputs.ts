/**
 * Where the OPRF values go in a wallet credential circuit's input vector.
 *
 * Every wallet credential circuit made the same change
 * (circuits-dev.md, "OPRF nullifier in every wallet credential circuit"):
 * the public `scope: [u8; 32]` and `nullifier: [u8; 32]` (64 values) became
 * four Fields at the same position -- `oprf_key_hash, domain, scope,
 * nullifier` -- and seven private Fields were appended after the circuit's
 * own: `oprf_public_key_x, oprf_public_key_y, oprf_beta, oprf_dlog_e,
 * oprf_dlog_s, oprf_response_x, oprf_response_y`.
 */
import {reduceOprfName, type OprfCircuitInputs} from './core/client';

export const OPRF_PUBLIC_INPUT_NAMES = Object.freeze(['oprf_key_hash', 'domain', 'scope', 'nullifier'] as const);
export const OPRF_PRIVATE_INPUT_NAMES = Object.freeze([
  'oprf_public_key_x', 'oprf_public_key_y', 'oprf_beta', 'oprf_dlog_e', 'oprf_dlog_s', 'oprf_response_x', 'oprf_response_y',
] as const);

const FIELD = /^0x[0-9a-f]{64}$/;

function take(oprf: OprfCircuitInputs, name: keyof OprfCircuitInputs): string {
  const v = oprf?.[name];
  if (typeof v !== 'string' || !FIELD.test(v)) throw new Error(`OPRF input ${name} is missing or not a 32-byte field: ${JSON.stringify(v)}.`);
  return v;
}

/** The four public values, in the circuits' order. */
export function oprfPublicInputs(oprf: OprfCircuitInputs): string[] {
  return OPRF_PUBLIC_INPUT_NAMES.map(n => take(oprf, n));
}

/** The seven private values, appended after each circuit's own inputs. */
export function oprfPrivateInputs(oprf: OprfCircuitInputs): string[] {
  return OPRF_PRIVATE_INPUT_NAMES.map(n => take(oprf, n));
}

/** The scope FIELD's 32 bytes, big-endian: what the Coinbase v2 device statement binds (clientData offset 193). */
export function oprfScopeFieldBytes(oprf: OprfCircuitInputs): Uint8Array {
  const hex = take(oprf, 'scope').slice(2);
  return Uint8Array.from({length: 32}, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}

/**
 * keccak256(utf8(scopeName)) mod p as 32 bytes big-endian: the scope Field
 * every wallet credential circuit publishes, computable before the OPRF
 * answer (the device statement is made first). Throws for a name the OPRF
 * node refuses.
 */
export function oprfScopeBytesOf(scopeName: string): Uint8Array {
  const hex = reduceOprfName(scopeName).slice(2);
  return Uint8Array.from({length: 32}, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}
