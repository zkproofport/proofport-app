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
 * Sepolia 0xeA5933AB...84e8 (circuits 7e5c72d), which core 0.4.0-beta.0
 * pins. Remove the row when that circuit is in the release this app pins.
 *
 * PER SIGNER. Both ids are proved by a different circuit on Android: the
 * statement is vouched for by Android key attestation instead of App Attest,
 * in the packages `oidc_domain_attestation_android` and
 * `coinbase_attestation_v2_android` (circuits branch android-signature;
 * designed 2026-10-28, circuits-dev.md "Android signer"). Same circuit id,
 * public inputs, statement and nullifier; other private inputs, other vk and
 * verifier, and 2^21 instead of 2^20. So each row holds one source per
 * statement-signer variant (src/config/signerPlatform.ts), and a variant the
 * row does not hold is an error, never the other platform's files. Android
 * has two: Remote Key Provisioning chains (`*_android`) and factory-provisioned
 * chains with a Play Integrity verdict (`*_android_factory`); the phone's own
 * chain decides which, and only that package is downloaded.
 *
 * A 2^21 .srs is 134,217,940 bytes, over GitHub's 100 MiB file limit, so the
 * circuits repository publishes it in parts (`<package>.srs.part0`, ...,
 * each at most 64 MiB) with SHA256SUMS listing every part and the joined
 * `<package>.srs`. `srsParts` says how many; circuitDownload.ts fetches,
 * checks and joins them.
 */
import type {CircuitName} from './circuitIds';
import {
  currentSignerPlatform,
  currentSignerVariant,
  knownAndroidChainKind,
  type StatementSignerVariant,
} from './signerPlatform';

/**
 * zkproofport/circuits 5081cfd (branch oidc-signature, 2026-10-28): CI-built
 * oidc_domain_attestation with the provider-key statement -- nargo
 * 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, 2^20 (.srs 67,109,076 bytes), 214
 * public inputs.
 */
export const OIDC_SIGNATURE_CIRCUITS_REF = '5081cfda1ed00cfe9ec0aa20180338dc45f10670';

/**
 * The zkproofport/circuits commit carrying the CI-built Android packages
 * (`oidc_domain_attestation_android`, `coinbase_attestation_v2_android` and
 * their `_android_factory` siblings): their json, the split .srs with
 * SHA256SUMS, and vk. A full 40-hex commit, never a branch.
 * 8fad8da (2026-10-28, branch android-signature): CI run 40669708612 over
 * circuits b37468e; nargo 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, all four 2^21,
 * .srs in three parts. Testnet verifiers: circuits e02e674.
 */
export const ANDROID_SIGNATURE_CIRCUITS_REF = '8fad8daa4fc7cdb3315deb4a40cd6a263229a455';

/**
 * The zkproofport/circuits ref carrying Coinbase Country v2's CI-built files
 * (`coinbase_country_attestation_v2`, `_android`, `_android_factory`, circuits
 * branch country-v2, 2026-10-30): json, .srs (split for the 2^21 Android
 * packages) with SHA256SUMS, and vk. EMPTY until those files are on a commit:
 * every Country download ends at requireArtifactRef's error naming this
 * constant, never at v1's files. The Android rows need a full 40-hex commit.
 */
export const COUNTRY_V2_CIRCUITS_REF = '';

/** The .srs size of a 2^21 circuit (bb 4.2.0-aztecnr-rc.2), split for GitHub. */
export const SRS_2_21_BYTES = 134_217_940;
/** Upper bound on one published .srs part. */
export const SRS_PART_MAX_BYTES = 64 * 1024 * 1024;

export interface CircuitArtifactSource {
  /** Which statement signer this circuit takes (src/config/signerPlatform.ts). */
  variant: StatementSignerVariant;
  /** zkproofport/circuits tag or commit holding the files. */
  ref: string;
  /** The constant `ref` comes from, named in the error when it is empty. */
  refName: string;
  /** Directory holding `<remoteFileName>.json` and `.srs` (or its parts). */
  basePath: string;
  vkPath: string;
  vkFileName: string;
  /** The files' name in that directory (the Nargo package name). */
  remoteFileName: string;
  /** Cache version for these files (see CIRCUIT_DATA_VERSIONS). */
  dataVersion: number;
  /** Field elements in the proof's public-input vector. */
  publicInputCount: number;
  /**
   * null: the .srs is one file, `<remoteFileName>.srs`. A number: it is
   * published as that many parts, `<remoteFileName>.srs.part0` ...
   * `.part<n-1>`, each listed in SHA256SUMS beside the joined
   * `<remoteFileName>.srs`.
   */
  srsParts: number | null;
}

type PerVariant = Readonly<Record<StatementSignerVariant, CircuitArtifactSource>>;

export const CIRCUIT_ARTIFACT_SOURCES: Readonly<Partial<Record<CircuitName, PerVariant>>> = Object.freeze({
  coinbase_attestation: Object.freeze({
    // v2.0.0-rc.1 = circuits b0ca9fe: nargo 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2,
    // 2^20 (.srs 67,109,076 bytes), 193 public inputs.
    app_attest: Object.freeze({
      variant: 'app_attest',
      ref: 'v2.0.0-rc.1',
      refName: "coinbase_attestation's app_attest row",
      basePath: 'coinbase-attestation-v2/target',
      vkPath: 'coinbase-attestation-v2/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2',
      dataVersion: 2,
      publicInputCount: 193,
      srsParts: null,
    }),
    // 2^21, 193 public inputs (the same as the iPhone circuit's). dataVersion
    // 3 is distinct from the iPhone files' 2 even though a phone only ever
    // holds one platform's files: the version names the file set.
    android: Object.freeze({
      variant: 'android',
      ref: ANDROID_SIGNATURE_CIRCUITS_REF,
      refName: 'ANDROID_SIGNATURE_CIRCUITS_REF',
      basePath: 'coinbase-attestation-v2-android/target',
      vkPath: 'coinbase-attestation-v2-android/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2_android',
      dataVersion: 3,
      publicInputCount: 193,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
    // A factory-provisioned phone (Google's RSA root) with a Play Integrity
    // verdict: 2^21, the same 193 public inputs.
    android_factory: Object.freeze({
      variant: 'android_factory',
      ref: ANDROID_SIGNATURE_CIRCUITS_REF,
      refName: 'ANDROID_SIGNATURE_CIRCUITS_REF',
      basePath: 'coinbase-attestation-v2-android-factory/target',
      vkPath: 'coinbase-attestation-v2-android-factory/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2_android_factory',
      dataVersion: 4,
      publicInputCount: 193,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
  // Coinbase Country v2 (statement-bound revocation, optional EIP-712 action,
  // wallet + circuit-tag nullifier; circuits-dev.md "Decisions, 2026-10-23"):
  // 215 public inputs on every package. dataVersion 3-5 replace v1's
  // CIRCUIT_DATA_VERSIONS 2, and differ from each other: the version names
  // the file set.
  coinbase_country_attestation: Object.freeze({
    app_attest: Object.freeze({
      variant: 'app_attest',
      ref: COUNTRY_V2_CIRCUITS_REF,
      refName: 'COUNTRY_V2_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2/target',
      vkPath: 'coinbase-country-attestation-v2/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2',
      dataVersion: 3,
      publicInputCount: 215,
      srsParts: null,
    }),
    android: Object.freeze({
      variant: 'android',
      ref: COUNTRY_V2_CIRCUITS_REF,
      refName: 'COUNTRY_V2_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2-android/target',
      vkPath: 'coinbase-country-attestation-v2-android/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2_android',
      dataVersion: 4,
      publicInputCount: 215,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
    android_factory: Object.freeze({
      variant: 'android_factory',
      ref: COUNTRY_V2_CIRCUITS_REF,
      refName: 'COUNTRY_V2_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2-android-factory/target',
      vkPath: 'coinbase-country-attestation-v2-android-factory/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2_android_factory',
      dataVersion: 5,
      publicInputCount: 215,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
  oidc_domain_attestation: Object.freeze({
    // dataVersion 6 = CIRCUIT_DATA_VERSIONS.oidc_domain_attestation: the files
    // from v5 (circuits main, no signer) are deleted and fetched again.
    app_attest: Object.freeze({
      variant: 'app_attest',
      ref: OIDC_SIGNATURE_CIRCUITS_REF,
      refName: 'OIDC_SIGNATURE_CIRCUITS_REF',
      basePath: 'oidc-domain-attestation/target',
      vkPath: 'oidc-domain-attestation/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'oidc_domain_attestation',
      dataVersion: 6,
      publicInputCount: 214,
      srsParts: null,
    }),
    // 2^21, 214 public inputs (the same as the iPhone circuit's).
    android: Object.freeze({
      variant: 'android',
      ref: ANDROID_SIGNATURE_CIRCUITS_REF,
      refName: 'ANDROID_SIGNATURE_CIRCUITS_REF',
      basePath: 'oidc-domain-attestation-android/target',
      vkPath: 'oidc-domain-attestation-android/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'oidc_domain_attestation_android',
      dataVersion: 7,
      publicInputCount: 214,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
    android_factory: Object.freeze({
      variant: 'android_factory',
      ref: ANDROID_SIGNATURE_CIRCUITS_REF,
      refName: 'ANDROID_SIGNATURE_CIRCUITS_REF',
      basePath: 'oidc-domain-attestation-android-factory/target',
      vkPath: 'oidc-domain-attestation-android-factory/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'oidc_domain_attestation_android_factory',
      dataVersion: 8,
      publicInputCount: 214,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
});

function ownRow(circuit: string): PerVariant | undefined {
  return Object.prototype.hasOwnProperty.call(CIRCUIT_ARTIFACT_SOURCES, circuit)
    ? CIRCUIT_ARTIFACT_SOURCES[circuit as CircuitName]
    : undefined;
}

/** Whether `circuit` is read from a pinned per-platform source at all. */
export function hasPinnedArtifactSource(circuit: string): boolean {
  return ownRow(circuit) !== undefined;
}

/**
 * The pinned source for `circuit` on `variant`; undefined for a circuit with
 * no row (it is read from main or the release tag). A row without that
 * variant throws, naming it: the other platform's files would load, and fail
 * in the prover with nothing pointing here.
 */
export function artifactSourceFor(circuit: string, variant: string): CircuitArtifactSource | undefined {
  const row = ownRow(circuit);
  if (!row) return undefined;
  if (!Object.prototype.hasOwnProperty.call(row, variant)) {
    throw new Error(
      `${circuit} has no circuit files for statement signer '${variant}'. Known: ${Object.keys(row).join(', ')}.`,
    );
  }
  return row[variant as StatementSignerVariant];
}

/** The pinned source for `circuit` on this phone's platform. Own keys only. */
export function circuitArtifactSource(circuit: string): CircuitArtifactSource | undefined {
  // The platform is read only for a circuit that has a row, so every other
  // circuit's download never depends on it.
  return hasPinnedArtifactSource(circuit) ? artifactSourceFor(circuit, currentSignerVariant()) : undefined;
}

/**
 * Whether this phone can name `circuit`'s files now. False only for a
 * per-signer circuit on an Android phone whose chain kind is not known yet:
 * the launch prefetch leaves those to the proof, which learns the kind first.
 */
export function circuitFilesDecidableNow(circuit: string): boolean {
  if (!hasPinnedArtifactSource(circuit)) return true;
  return currentSignerPlatform() === 'ios' || knownAndroidChainKind() !== null;
}

/**
 * The ref a source's files are read from. An Android row must name a full
 * commit; until ANDROID_SIGNATURE_CIRCUITS_REF is filled in, this is the
 * error every Android download of these circuits ends at.
 */
export function requireArtifactRef(source: CircuitArtifactSource): string {
  if (source.variant !== 'app_attest' && !/^[0-9a-f]{40}$/.test(source.ref)) {
    throw new Error(
      `${source.refName} is ${source.ref === '' ? 'empty' : `'${source.ref}'`}: set it to the 40-hex zkproofport/circuits ` +
        `commit carrying the CI-built ${source.remoteFileName} files (src/config/circuitArtifacts.ts).`,
    );
  }
  if (source.ref === '') throw new Error(`${source.refName} is empty (src/config/circuitArtifacts.ts).`);
  return source.ref;
}

/** Coinbase Country v2's source on this phone. Required: the app proves only v2 for this id. */
export function coinbaseCountryArtifact(variant: StatementSignerVariant = currentSignerVariant()): CircuitArtifactSource {
  const source = artifactSourceFor('coinbase_country_attestation', variant);
  if (!source) throw new Error('coinbase_country_attestation has no pinned v2 artifact source in circuitArtifacts.ts.');
  return source;
}

/** Coinbase KYC v2's source on this phone. Required: the app proves only v2 for this id. */
export function coinbaseKycArtifact(variant: StatementSignerVariant = currentSignerVariant()): CircuitArtifactSource {
  const source = artifactSourceFor('coinbase_attestation', variant);
  if (!source) throw new Error('coinbase_attestation has no pinned v2 artifact source in circuitArtifacts.ts.');
  return source;
}
