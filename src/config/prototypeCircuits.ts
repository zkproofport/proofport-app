/**
 * Circuits that are NOT in `@zkproofport-app/core`: prototypes a developer can
 * prove on a phone before they become (or replace) a canonical circuit.
 *
 * Why a separate table instead of a new circuit id. Every `CircuitName` table
 * in this app is `Record<CircuitName, …>` over core's published list, so a new
 * canonical id means a core release, verifier addresses, networks and display
 * rows -- none of which a prototype with no deployed verifier has. And reusing
 * `coinbase_attestation`'s id for different files would point that id's cache,
 * download path and verifier at the wrong artifacts, which is exactly the
 * substitution this repo forbids. So a prototype keeps its own Nargo package
 * name as its file id, is reachable only through the development switch that
 * names it, and lives here.
 *
 * Files are read from a COMMIT, not a branch: a branch moves under an installed
 * app, a commit does not, and the commit doubles as the cache key (a different
 * ref is a different base URL, which invalidates the cached files).
 */

export interface PrototypeCircuit {
  /** The Nargo package name: `<id>.json` / `<id>.srs` in `basePath`. */
  id: string;
  /** zkproofport/circuits commit holding the files. */
  ref: string;
  basePath: string;
  vkPath: string;
  vkFileName: string;
  /** Bump to force a re-download of the same ref (see CIRCUIT_DATA_VERSIONS). */
  dataVersion: number;
  /** Field elements in the proof's public-input vector. */
  publicInputCount: number;
}

/**
 * Coinbase KYC with revocation bound through Apple App Attest
 * (circuits branch `coinbase-app-attest-poc`; README there has the format).
 * Commit 33344e2 adds the build output to b281485's circuit: nargo
 * 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, 2^20 (.srs 67,109,076 bytes).
 */
export const COINBASE_APP_ATTEST_POC: PrototypeCircuit = Object.freeze({
  id: 'coinbase_app_attest_poc',
  ref: '33344e2924fd6e9a19dcfb6b294bd7df7b51d62c',
  basePath: 'coinbase-app-attest-poc/target',
  vkPath: 'coinbase-app-attest-poc/target/vk',
  vkFileName: 'vk',
  dataVersion: 1,
  publicInputCount: 226,
});

export const PROTOTYPE_CIRCUITS: Readonly<Record<string, PrototypeCircuit>> = Object.freeze({
  [COINBASE_APP_ATTEST_POC.id]: COINBASE_APP_ATTEST_POC,
});

/** The prototype with this id, or undefined. Own keys only (`__proto__` is not a circuit). */
export function prototypeCircuit(id: string): PrototypeCircuit | undefined {
  return Object.prototype.hasOwnProperty.call(PROTOTYPE_CIRCUITS, id) ? PROTOTYPE_CIRCUITS[id] : undefined;
}
