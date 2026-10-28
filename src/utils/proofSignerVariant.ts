/**
 * The callback's `signerVariant` for a proof (relay and @zkproofport-app/core
 * take `standard`, `android`, `android_factory`): for a circuit with
 * per-signer packages (src/config/circuitArtifacts.ts -- Coinbase KYC v2 and
 * OIDC), the variant the hook proved with; `standard` for every other
 * circuit. A per-signer proof that does not say is an error, never reported
 * as `standard` (the dApp would check it against the wrong verifier).
 */
import {hasPinnedArtifactSource} from '../config/circuitArtifacts';

export type ProofSignerVariant = 'standard' | 'android' | 'android_factory';

export function proofSignerVariant(circuit: string, parsed: object): ProofSignerVariant {
  if (!hasPinnedArtifactSource(circuit)) return 'standard';
  const v = (parsed as {signerVariant?: unknown}).signerVariant;
  if (v === 'standard' || v === 'android' || v === 'android_factory') return v;
  throw new Error(`The ${circuit} proof does not say which package made it (signerVariant ${JSON.stringify(v ?? null)})`);
}
