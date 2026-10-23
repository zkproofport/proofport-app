/**
 * Where a circuit's compiled files come from when it is NOT the build on the
 * circuits repository's main branch / release tag.
 *
 * Coinbase KYC v2 (`coinbase_attestation`: Apple App Attest revocation
 * binding, optional EIP-712 action, wallet + circuit-tag nullifier) is built
 * on the circuits branch `coinbase-app-attest-poc`, where its Nargo package is
 * named `coinbase_app_attest_poc`. Until it lands on main and in a release,
 * this app reads its files from the commit below, under the canonical id
 * `coinbase_attestation`: the cache, the prover and the verifier all see
 * `coinbase_attestation`, and only the download URL differs.
 *
 * Read from a COMMIT, not a branch: a branch moves under an installed app, a
 * commit does not, and the commit is part of the cache key (another ref is
 * another base URL, which invalidates the cached files).
 *
 * Remove the row when the circuit is on main / in a release; the core list
 * and CIRCUIT_VK_PATHS then describe it like every other circuit.
 */
import type {CircuitName} from './circuitIds';

export interface CircuitArtifactSource {
  /** zkproofport/circuits commit holding the files. */
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
  // Commit 33344e2 adds the build output to the circuit at b281485: nargo
  // 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, 2^20 (.srs 67,109,076 bytes).
  coinbase_attestation: Object.freeze({
    ref: '33344e2924fd6e9a19dcfb6b294bd7df7b51d62c',
    basePath: 'coinbase-app-attest-poc/target',
    vkPath: 'coinbase-app-attest-poc/target/vk',
    vkFileName: 'vk',
    remoteFileName: 'coinbase_app_attest_poc',
    dataVersion: 1,
    publicInputCount: 226,
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
