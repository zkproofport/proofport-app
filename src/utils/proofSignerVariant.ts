/**
 * The callback's `signerVariant` for a proof (relay and @zkproofport-app/core
 * take `standard`, `android`, `android_factory`): for a circuit with
 * per-signer packages (src/config/circuitArtifacts.ts -- Coinbase KYC v2 and
 * OIDC), the variant the hook proved with; `standard` for every other
 * circuit. A per-signer proof that does not say is an error, never reported
 * as `standard` (the dApp would check it against the wrong verifier).
 */
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {hasPinnedArtifactSource} from '../config/circuitArtifacts';
import {getEnvironment} from '../config/environment';
import type {Environment} from '../config/contracts';
import type {StatementSignerVariant} from '../config/signerPlatform';
import {androidVerifierFor, AndroidVerifierMissingError, type VariantVerifier} from '../config/variantVerifiers';

export type ProofSignerVariant = 'standard' | 'android' | 'android_factory';

export function proofSignerVariant(circuit: string, parsed: object): ProofSignerVariant {
  if (!hasPinnedArtifactSource(circuit)) return 'standard';
  const v = (parsed as {signerVariant?: unknown}).signerVariant;
  if (v === 'standard' || v === 'android' || v === 'android_factory') return v;
  throw new Error(`The ${circuit} proof does not say which package made it (signerVariant ${JSON.stringify(v ?? null)})`);
}

/**
 * The contract an Android proof of `circuit` verifies on in this build;
 * null for the standard package (its address is FALLBACK_VERIFIERS', read as
 * before). A missing Android row is E2018, by name -- never the standard
 * address, which rejects every Android proof.
 */
export function verifierForProof(
  circuit: string,
  variant: ProofSignerVariant,
  env: Environment = getEnvironment(),
): VariantVerifier | null {
  if (variant === 'standard') return null;
  try {
    return androidVerifierFor(circuit, env, variant);
  } catch (e) {
    if (e instanceof AndroidVerifierMissingError) {
      throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.noVerifier, e.message);
    }
    throw e;
  }
}

/** Refuse, before proving, a phone variant whose proofs nothing in this build can verify. */
export function requireVerifierForVariant(circuit: string, variant: StatementSignerVariant, env?: Environment): void {
  if (variant === 'app_attest') return;
  verifierForProof(circuit, variant, env);
}
