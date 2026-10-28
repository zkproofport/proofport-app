/**
 * Where a circuit's compiled files come from when it is NOT the build at the
 * ref every other official circuit is read from (`main` in development and
 * staging, `CIRCUITS_RELEASE_TAG` in production).
 *
 * Coinbase KYC v2 (`coinbase_attestation`: revocation bound by an Apple App
 * Attest statement, optional EIP-712 action, wallet + circuit-tag nullifier)
 * is built in the circuits directory `coinbase-attestation-v2` as package
 * `coinbase_attestation_v2`, beside v1's `coinbase-attestation`. This app
 * reads its files from the pre-release tag below, under the canonical id
 * `coinbase_attestation`: the cache, the prover and the verifier all see
 * `coinbase_attestation`, and only the download URL differs.
 *
 * Why a pre-release tag: v2 is not in any production release yet
 * (`v2.0.0`, the planned one, is not published), and `main` moves under an
 * installed app. `v2.0.0-rc.1` is commit b0ca9fe (2026-10-28): CA 1 and the
 * AI server's Cloud KMS key pinned, 983,451 gates, 2^20, verifier on Base
 * Sepolia 0x1885aA22...08E6. It is published as a GitHub pre-release, so it
 * never becomes Latest. The ref is part of the cache key (another ref is
 * another base URL, which invalidates cached files), and the files are
 * checked against `coinbase-attestation-v2/target/SHA256SUMS` and
 * `target/vk/SHA256SUMS` at the same tag.
 *
 * Remove the row when v2 is in the release this app pins; the core list and
 * CIRCUIT_VK_PATHS then describe it like every other circuit.
 *
 * OIDC domain (`oidc_domain_attestation`) with the provider-key statement
 * (circuits fix list item 12): same directory and Nargo name as before, but
 * ten private inputs follow `signature_limbs` (the statement signer), so the
 * files come from the circuits commit carrying the CI-built artifacts:
 * 5081cfd on branch `oidc-signature` (not in any tag or main yet), checked
 * against its target/SHA256SUMS and target/vk/SHA256SUMS. A commit, not the
 * branch: a branch moves under an installed app. useOidcDomain also refuses a
 * file set whose ABI is not this circuit's (requireOidcAbi), which the
 * public-input count (214 either way) cannot tell apart. Verifier: Base
 * Sepolia 0xeA5933AB...84e8 (circuits 7e5c72d). Remove the row when that
 * circuit is in the release this app pins and in core's table.
 */
import type {CircuitName} from './circuitIds';

/**
 * zkproofport/circuits 5081cfd (branch oidc-signature, 2026-10-28): CI-built
 * oidc_domain_attestation with the provider-key statement -- nargo
 * 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, 2^20 (.srs 67,109,076 bytes), 214
 * public inputs.
 */
export const OIDC_SIGNATURE_CIRCUITS_REF = '5081cfda1ed00cfe9ec0aa20180338dc45f10670';

export interface CircuitArtifactSource {
  /** zkproofport/circuits tag or commit holding the files. */
  ref: string;
  /** Directory holding `<remoteFileName>.json` and `.srs`. */
  basePath: string;
  vkPath: string;
  vkFileName: string;
  /** The files' name in that directory (the Nargo package name). */
  remoteFileName: string;
  /** Cache version for these files (see CIRCUIT_DATA_VERSIONS). */
  dataVersion: number;
  /** Field elements in the proof's public-input vector. */
  publicInputCount: number;
}

export const CIRCUIT_ARTIFACT_SOURCES: Readonly<Partial<Record<CircuitName, CircuitArtifactSource>>> = Object.freeze({
  // v2.0.0-rc.1 = circuits b0ca9fe: nargo 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2,
  // 2^20 (.srs 67,109,076 bytes), 193 public inputs.
  coinbase_attestation: Object.freeze({
    ref: 'v2.0.0-rc.1',
    basePath: 'coinbase-attestation-v2/target',
    vkPath: 'coinbase-attestation-v2/target/vk',
    vkFileName: 'vk',
    remoteFileName: 'coinbase_attestation_v2',
    dataVersion: 2,
    publicInputCount: 193,
  }),
  // dataVersion 6 = CIRCUIT_DATA_VERSIONS.oidc_domain_attestation: the files
  // from v5 (circuits main, no signer) are deleted and fetched again.
  oidc_domain_attestation: Object.freeze({
    ref: OIDC_SIGNATURE_CIRCUITS_REF,
    basePath: 'oidc-domain-attestation/target',
    vkPath: 'oidc-domain-attestation/target/vk',
    vkFileName: 'vk',
    remoteFileName: 'oidc_domain_attestation',
    dataVersion: 6,
    publicInputCount: 214,
  }),
});

/** The pinned source for `circuit`, if it has one. Own keys only. */
export function circuitArtifactSource(circuit: string): CircuitArtifactSource | undefined {
  return Object.prototype.hasOwnProperty.call(CIRCUIT_ARTIFACT_SOURCES, circuit)
    ? CIRCUIT_ARTIFACT_SOURCES[circuit as CircuitName]
    : undefined;
}

/** Coinbase KYC v2's source. Required: the app proves only v2 for this id. */
export function coinbaseKycArtifact(): CircuitArtifactSource {
  const source = circuitArtifactSource('coinbase_attestation');
  if (!source) throw new Error('coinbase_attestation has no pinned v2 artifact source in circuitArtifacts.ts.');
  return source;
}
