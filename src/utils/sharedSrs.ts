/**
 * The prover's shared reference-string directory.
 *
 * Since the Noir 1.0.0 / bb 6.0.0 prover (mopro/vendor/noir-rs, see
 * .claude/agents/mopro-dev.md "Vendored noir-rs"), barretenberg reads its
 * reference string from a FILE: `<directory of the first .srs the process
 * proves with>/bn254-crs/bn254_g1.dat`, grown (atomic replace) to the
 * largest circuit proved so far -- up to 128 MiB for a 2^21 circuit -- on
 * top of the per-circuit `.srs` files. barretenberg also keeps `crs.lock`
 * there. Every `.srs` the app hands the prover sits in
 * `Documents/circuits/` (circuitDownload.ts), so the directory is
 * `Documents/circuits/bn254-crs/`.
 *
 * It is derived data: rebuilt from any `.srs` on the next proof. So it is
 *   - kept out of iCloud / device backup on iOS by the flag on its parent,
 *     `Documents/circuits/` itself (circuitBackup.ts), which covers what the
 *     prover writes inside it later, the atomic-replace temp file included;
 *   - counted in getDownloadedCircuitsSize and removed with
 *     deleteAllCircuitFiles (both in circuitDownload.ts), because it lives
 *     inside the circuits directory;
 *   - never removed by deleteCircuitFiles(circuit): it is shared by every
 *     circuit and does not depend on the toolchain (the G1 points of the
 *     same published reference string).
 */
import {parentDirectoryOf} from './circuitBackup';

/** Directory name the prover uses (CRS_DIR_NAME in mopro/src/noir.rs). */
export const SHARED_SRS_DIR_NAME = 'bn254-crs';

/** The directory the prover writes for a proof handed `srsPath`: `<dir of srsPath>/bn254-crs`. */
export function sharedSrsDirectoryFor(srsPath: string): string {
  return `${parentDirectoryOf(srsPath)}/${SHARED_SRS_DIR_NAME}`;
}
