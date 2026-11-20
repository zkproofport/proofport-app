/**
 * OPRF values for builder tests: read from a circuit fixture's Prover.toml
 * fields (the circuits' own generators write them), or the shared vector
 * file's first evaluation.
 */
import type {OprfCircuitInputs} from '../../core/client';
import vectors from '../fixtures/oprf-vectors.json';

const NAMES = [
  'oprf_key_hash', 'domain', 'scope', 'nullifier',
  'oprf_public_key_x', 'oprf_public_key_y', 'oprf_beta', 'oprf_dlog_e', 'oprf_dlog_s', 'oprf_response_x', 'oprf_response_y',
] as const;

const field = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new Error(`fixture ${name} is not a field: ${JSON.stringify(v)}`);
  return '0x' + BigInt(v).toString(16).padStart(64, '0');
};

/** The eleven values from a record carrying them under their Prover.toml names. */
export function oprfFromToml(t: Record<string, unknown>): OprfCircuitInputs {
  const out = {} as Record<(typeof NAMES)[number], string>;
  for (const n of NAMES) out[n] = field(t[n], n);
  return out as OprfCircuitInputs;
}

/** oprf-vectors.json evaluation 0 (anvil account 0, the test key, zkproofport.app / oprf-fixture). */
export function vectorOprf(): OprfCircuitInputs & {address: string} {
  const e = vectors.evaluations[0];
  return {
    address: e.address,
    oprf_key_hash: e.keyHash,
    domain: e.domain,
    scope: e.scope,
    nullifier: e.nullifier,
    oprf_public_key_x: e.publicKey.x,
    oprf_public_key_y: e.publicKey.y,
    oprf_beta: e.beta,
    oprf_dlog_e: e.dlogE,
    oprf_dlog_s: e.dlogS,
    oprf_response_x: e.response.x,
    oprf_response_y: e.response.y,
  };
}
