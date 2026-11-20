/**
 * Where every circuit's compiled files come from: one row per circuit id, each
 * naming an exact zkproofport/circuits ref -- a full commit or a version tag,
 * never a branch -- read in EVERY environment. A branch (`main`) moves under
 * an installed app, so changing it would silently change what that app
 * downloads, with only the cache version standing in the way.
 *
 * Every id in the circuit list has a row (held by
 * src/config/__tests__/everyCircuitIsReadFromAPinnedRef.test.ts). The
 * per-environment ref in contracts.ts (`main` in development and staging,
 * `CIRCUITS_RELEASE_TAG` in production) is reached only by a circuit with no
 * row here, and today there is none. A Laboratory circuit with no row is an
 * error naming it, never `main`.
 *
 * At the circuits 1.0.0 release every ref here moves: the Coinbase KYC iPhone
 * row, ANDROID_SIGNATURE_CIRCUITS_REF, COUNTRY_V2_CIRCUITS_REF,
 * OIDC_SIGNATURE_CIRCUITS_REF, HUMAN_PASSPORT_CIRCUITS_REF and
 * LAB_CIRCUITS_REF (app-dev.md "Noir 1.0.0 / bb 6.0.0 prover", "At release
 * time").
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
 * files come from the circuits commit OIDC_SIGNATURE_CIRCUITS_REF names,
 * checked
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
import {ALL_CIRCUIT_IDS, isCircuitId, type CircuitName} from './circuitIds';
import {
  currentSignerPlatform,
  currentSignerVariant,
  knownAndroidChainKind,
  type StatementSignerVariant,
} from './signerPlatform';

/**
 * zkproofport/circuits ddf11f0 (branch toolchain-upgrade, 2026-11-20):
 * oidc_domain_attestation with the provider-key statement, rebuilt with nargo
 * 1.0.0 / bb 6.0.0 and noir-bignum 0.10 (RSA signature limbs range-checked;
 * Barrett parameter 2^(2*2048+6), the shift rsaBarrett.ts uses), 2^20, 214
 * public inputs, checked against its target/SHA256SUMS and
 * target/vk/SHA256SUMS. Was 5081cfd (beta.19 / bb 4.2, Barrett +4): those
 * files no longer match this app's input builder or prover. The same commit
 * as OPRF_CIRCUITS_REF.
 */
export const OIDC_SIGNATURE_CIRCUITS_REF = 'ddf11f03d6f0af70e42cea35b93f53f9c614ea85';

/**
 * The zkproofport/circuits commit carrying the CI-built Android packages
 * (`oidc_domain_attestation_android`, `coinbase_attestation_v2_android` and
 * their `_android_factory` siblings): their json, the split .srs with
 * SHA256SUMS, and vk. A full 40-hex commit, never a branch.
 * 8fad8da (2026-10-28, branch android-signature): CI run 40669708612 over
 * circuits b37468e; nargo 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2, all four 2^21,
 * .srs in three parts. Testnet verifiers: circuits e02e674.
 */
// Now read only by the OIDC Android rows (Coinbase KYC's Android rows moved
// to OPRF_CIRCUITS_REF). Moved 2026-11-20 to ddf11f0 (branch
// toolchain-upgrade): nargo 1.0.0 / bb 6.0.0, noir-bignum 0.10, both OIDC
// Android packages 2^21 with the .srs in three parts; the same commit as
// OIDC_SIGNATURE_CIRCUITS_REF and OPRF_CIRCUITS_REF.
export const ANDROID_SIGNATURE_CIRCUITS_REF = 'ddf11f03d6f0af70e42cea35b93f53f9c614ea85';

/**
 * The zkproofport/circuits commit carrying Coinbase Country v2's CI-built
 * files (`coinbase_country_attestation_v2`, `_android`, `_android_factory`):
 * 75bec01 (branch country-v2, 2026-10-30; nargo 1.0.0-beta.19, bb
 * 4.2.0-aztecnr-rc.2; vk log sizes 20 / 21 / 21, the two Android .srs in
 * three parts), checked against each package's target/SHA256SUMS and
 * target/vk/SHA256SUMS at that commit (json d6e7eae3... / 1fe65925... /
 * f5aeae85...). A full commit, not a branch: a branch moves under an
 * installed app. Empty would end every Country download at
 * requireArtifactRef's error naming this constant, never at v1's files.
 */
export const COUNTRY_V2_CIRCUITS_REF = '75bec01f877aa8a500974dc65321b0455c677654';

/**
 * The zkproofport/circuits commit carrying human_passport_score's CI-built
 * files: 197104c (circuits main, pre-release v2.2.0, 2026-10-30; nargo
 * 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2; vk log size 21, the .srs in three
 * parts; json 8580afec...). One package for every phone: the
 * wallet signs, no device statement, so its three rows below are one source
 * (`signerIndependent`). A full commit, not a branch. Empty ends every Human
 * Passport download at requireArtifactRef's error naming this constant.
 */
export const HUMAN_PASSPORT_CIRCUITS_REF = '197104cb01d7987d29e9c89fe8d242a2cf87537b';

/**
 * The zkproofport/circuits commit the Laboratory circuits (GIWA KYC and the
 * Dojang Playground: MAIN_BRANCH_CIRCUIT_IDS) read their files AND their
 * verifier broadcast records from, in every environment.
 *
 * 9651df8 is circuits `main` as of 2026-11-17 (its last change to these files:
 * 30b2749, 2026-10-27, nargo 1.0.0-beta.19 / bb 4.2.0-aztecnr-rc.2; the
 * GIWA Sepolia broadcasts: 2ef5613, verifiers 0xF6Ed...83b3 / 0xAD6C...d816).
 * Chosen so nothing changes for anyone: every file an installed app fetched
 * from `main` that day -- giwa_attestation / dojang_playground .json, .srs,
 * vk, both SHA256SUMS, both run-latest.json -- was downloaded from `main` and
 * from this commit and compared byte for byte (sha256 equal), and main's
 * bytes pass this commit's SHA256SUMS. Until 2026-11-17 these two circuits
 * read `main` itself, so a push to circuits main changed what every installed
 * app downloaded.
 *
 * THE ONE PLACE TO MOVE at the circuits 1.0.0 release, to the commit or tag
 * carrying the 1.0.0 GIWA / Dojang files and their redeployed verifiers'
 * broadcasts. Moving it changes the download base URL, which by itself
 * replaces the files on every phone (cacheInvalidation); the verifier cache is
 * keyed by it too.
 */
export const LAB_CIRCUITS_REF = '9651df892c28fbeb9331ebc5358abfdf062c7c42';

/**
 * The zkproofport/circuits commit carrying the OPRF circuits: the request
 * proof (`oprf-request-auth-poc`, package `oprf_request_auth_poc`) and the
 * wallet credential circuits rebuilt with the OPRF nullifier
 * (circuits-dev.md, "OPRF nullifier in every wallet credential circuit").
 * ddf11f0 (branch toolchain-upgrade, 2026-11-20): nargo 1.0.0 / bb 6.0.0,
 * every wallet credential package rebuilt with the OPRF nullifier, each
 * checked against its target/SHA256SUMS and target/vk/SHA256SUMS. A full
 * commit, never a branch. Verifier broadcast records read from it are still
 * the bb 4.2 contracts until the bb 6 verifiers are deployed and recorded.
 */
export const OPRF_CIRCUITS_REF = 'ddf11f03d6f0af70e42cea35b93f53f9c614ea85';

let oprfCircuitsRefForTests: string | null = null;
/** OPRF_CIRCUITS_REF, or the commit a test set (rows read it through a getter). */
function oprfCircuitsRef(): string {
  return oprfCircuitsRefForTests ?? OPRF_CIRCUITS_REF;
}
/**
 * Test seam: download and verifier-record tests exercise the pinned-ref paths
 * as they will run once OPRF_CIRCUITS_REF is filled. `null` restores the real
 * (empty) constant. Never called by app code.
 */
export function __setOprfCircuitsRefForTests(ref: string | null): void {
  oprfCircuitsRefForTests = ref;
}

/**
 * The .srs size of a 2^21 circuit, split for GitHub. The same bytes under bb
 * 4.2.0-aztecnr-rc.2 and bb 6.0.0 (2^21 + 1 G1 points of the same published
 * reference string; checked 2026-11-17 on the 1.0.0 builds).
 */
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

/*
 * OPRF nullifier (2026-11-20): every wallet credential row (Coinbase KYC and
 * Country v2 on every signer, Human Passport, GIWA, the Dojang Playground)
 * now reads OPRF_CIRCUITS_REF with the new public-input counts (KYC 193 ->
 * 133, Country 215 -> 155, HP 195 -> 135, GIWA 192 -> 132, Dojang 160 -> 100)
 * and a bumped dataVersion, so a phone holding the keccak-nullifier files
 * replaces them. The rows' older comments below describe the files they
 * replaced. OIDC is unchanged.
 */
export const CIRCUIT_ARTIFACT_SOURCES: Readonly<Partial<Record<CircuitName, PerVariant>>> = Object.freeze({
  coinbase_attestation: Object.freeze({
    // v2.0.0-rc.1 = circuits b0ca9fe: nargo 1.0.0-beta.19, bb 4.2.0-aztecnr-rc.2,
    // 2^20 (.srs 67,109,076 bytes), 193 public inputs.
    app_attest: Object.freeze({
      variant: 'app_attest',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-attestation-v2/target',
      vkPath: 'coinbase-attestation-v2/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2',
      dataVersion: 8,
      publicInputCount: 133,
      srsParts: null,
    }),
    // 2^21, 193 public inputs (the same as the iPhone circuit's). dataVersion
    // 6 is distinct from the iPhone files' 5 even though a phone only ever
    // holds one platform's files: the version names the file set. Every row
    // here moved past its old numbers for Noir 1.0.0 / bb 6.0.0.
    android: Object.freeze({
      variant: 'android',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-attestation-v2-android/target',
      vkPath: 'coinbase-attestation-v2-android/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2_android',
      dataVersion: 9,
      publicInputCount: 133,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
    // A factory-provisioned phone (Google's RSA root) with a Play Integrity
    // verdict: 2^21, the same 193 public inputs.
    android_factory: Object.freeze({
      variant: 'android_factory',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-attestation-v2-android-factory/target',
      vkPath: 'coinbase-attestation-v2-android-factory/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_attestation_v2_android_factory',
      dataVersion: 10,
      publicInputCount: 133,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
  // Coinbase Country v2 (statement-bound revocation, optional EIP-712 action,
  // wallet + circuit-tag nullifier; circuits-dev.md "Decisions, 2026-10-23"):
  // 215 public inputs on every package. dataVersion 6-8 (3-5 before Noir
  // 1.0.0 / bb 6.0.0; v1 was CIRCUIT_DATA_VERSIONS 2) differ from each other:
  // the version names the file set.
  coinbase_country_attestation: Object.freeze({
    app_attest: Object.freeze({
      variant: 'app_attest',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2/target',
      vkPath: 'coinbase-country-attestation-v2/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2',
      dataVersion: 9,
      publicInputCount: 155,
      srsParts: null,
    }),
    android: Object.freeze({
      variant: 'android',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2-android/target',
      vkPath: 'coinbase-country-attestation-v2-android/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2_android',
      dataVersion: 10,
      publicInputCount: 155,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
    android_factory: Object.freeze({
      variant: 'android_factory',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'coinbase-country-attestation-v2-android-factory/target',
      vkPath: 'coinbase-country-attestation-v2-android-factory/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'coinbase_country_attestation_v2_android_factory',
      dataVersion: 11,
      publicInputCount: 155,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
  oidc_domain_attestation: Object.freeze({
    // dataVersion 9 = CIRCUIT_DATA_VERSIONS.oidc_domain_attestation (6 before
    // the Noir 1.0.0 / bb 6.0.0 toolchain; v5, circuits main with no signer,
    // before that).
    app_attest: Object.freeze({
      variant: 'app_attest',
      ref: OIDC_SIGNATURE_CIRCUITS_REF,
      refName: 'OIDC_SIGNATURE_CIRCUITS_REF',
      basePath: 'oidc-domain-attestation/target',
      vkPath: 'oidc-domain-attestation/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'oidc_domain_attestation',
      dataVersion: 9,
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
      dataVersion: 10,
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
      dataVersion: 11,
      publicInputCount: 214,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    }),
  }),
  human_passport_score: (() => {
    // dataVersion 2 = CIRCUIT_DATA_VERSIONS.human_passport_score (1 before
    // the Noir 1.0.0 / bb 6.0.0 toolchain).
    const source: CircuitArtifactSource = Object.freeze({
      variant: 'app_attest',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'human-passport-score/target',
      vkPath: 'human-passport-score/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'human_passport_score',
      dataVersion: 3,
      publicInputCount: 135,
      srsParts: Math.ceil(SRS_2_21_BYTES / SRS_PART_MAX_BYTES),
    });
    return Object.freeze({app_attest: source, android: source, android_factory: source});
  })(),
  // The Laboratory circuits: one package for every phone (no device
  // statement), read from LAB_CIRCUITS_REF. dataVersion = the id's
  // CIRCUIT_DATA_VERSIONS entry. Public inputs counted from each file's ABI at
  // that commit (192 / 160).
  giwa_attestation: laboratoryRow({
    basePath: 'giwa-attestation/target',
    remoteFileName: 'giwa_attestation',
    dataVersion: 5,
    publicInputCount: 132,
    oprf: true,
  }),
  dojang_playground: laboratoryRow({
    basePath: 'dojang-playground/target',
    remoteFileName: 'dojang_playground',
    dataVersion: 4,
    publicInputCount: 100,
    oprf: true,
  }),
});


/**
 * Circuits the app proves that are not credentials: no circuit id, no
 * verifier, no History row. Downloaded, cached and checked like a pinned
 * credential circuit (circuitDownload.ts asks circuitArtifactSource), under
 * their own id.
 */
export const AUXILIARY_CIRCUIT_IDS = Object.freeze(['oprf_request_auth'] as const);
export type AuxiliaryCircuitId = (typeof AUXILIARY_CIRCUIT_IDS)[number];

export function isAuxiliaryCircuitId(id: unknown): id is AuxiliaryCircuitId {
  return typeof id === 'string' && (AUXILIARY_CIRCUIT_IDS as readonly string[]).includes(id);
}

const AUXILIARY_CIRCUIT_SOURCES: Readonly<Record<AuxiliaryCircuitId, PerVariant>> = Object.freeze({
  // circuits/oprf-request-auth-poc: 69,184 gates, 2^17, 36 public inputs
  // (digest 32, domain, scope, blinded query x, y), 9,152-byte proofs
  // (proofport-oprf/README.md, REQUEST-VERIFIER.md). dataVersion 1: first set.
  oprf_request_auth: (() => {
    const source: CircuitArtifactSource = Object.freeze({
      variant: 'app_attest',
      get ref() { return oprfCircuitsRef(); },
      refName: 'OPRF_CIRCUITS_REF',
      basePath: 'oprf-request-auth-poc/target',
      vkPath: 'oprf-request-auth-poc/target/vk',
      vkFileName: 'vk',
      remoteFileName: 'oprf_request_auth_poc',
      dataVersion: 1,
      publicInputCount: 36,
      srsParts: null,
    });
    return Object.freeze({app_attest: source, android: source, android_factory: source});
  })(),
});

/** A signer-independent row read from LAB_CIRCUITS_REF; one .srs file. */
function laboratoryRow(p: {basePath: string; remoteFileName: string; dataVersion: number; publicInputCount: number; oprf: boolean}): PerVariant {
  // `oprf`: the files carry the OPRF nullifier and are read from
  // OPRF_CIRCUITS_REF; the verifier broadcast records stay on LAB_CIRCUITS_REF
  // until the redeployed verifiers' records are published with them.
  const source: CircuitArtifactSource = Object.freeze({
    variant: 'app_attest',
    get ref() { return p.oprf ? oprfCircuitsRef() : LAB_CIRCUITS_REF; },
    refName: p.oprf ? 'OPRF_CIRCUITS_REF' : 'LAB_CIRCUITS_REF',
    basePath: p.basePath,
    vkPath: `${p.basePath}/vk`,
    vkFileName: 'vk',
    remoteFileName: p.remoteFileName,
    dataVersion: p.dataVersion,
    publicInputCount: p.publicInputCount,
    srsParts: null,
  });
  return Object.freeze({app_attest: source, android: source, android_factory: source});
}

/**
 * A circuit whose files do not depend on the statement signer: every
 * variant's row is the same source. Its files are decidable on any phone,
 * before the Android chain kind is known.
 */
function signerIndependent(row: PerVariant): boolean {
  return row.android === row.app_attest && row.android_factory === row.app_attest;
}

function ownRow(circuit: string): PerVariant | undefined {
  if (isAuxiliaryCircuitId(circuit)) return AUXILIARY_CIRCUIT_SOURCES[circuit];
  return Object.prototype.hasOwnProperty.call(CIRCUIT_ARTIFACT_SOURCES, circuit)
    ? CIRCUIT_ARTIFACT_SOURCES[circuit as CircuitName]
    : undefined;
}

/** Whether `circuit` is read from a pinned per-platform source at all. */
export function hasPinnedArtifactSource(circuit: string): boolean {
  return ownRow(circuit) !== undefined;
}

/**
 * Whether `circuit` is proved by a different package on each statement
 * signer (so its proof must say which made it): a row whose variants are
 * different sources. False for a circuit with no row (read from the
 * environment's ref) and for a signer-independent row (Human Passport: one package
 * for every phone). An id that is not a circuit throws, naming the known ids.
 */
export function circuitHasPerSignerPackages(circuit: string): boolean {
  if (!isCircuitId(circuit)) {
    throw new Error(`Unknown circuit '${circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  const row = ownRow(circuit);
  return row !== undefined && !signerIndependent(row);
}

/**
 * The pinned source for `circuit` on `variant`; undefined for a circuit with
 * no row (it is read from the environment's ref in contracts.ts). A row without that
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
  const row = ownRow(circuit);
  if (!row) return undefined;
  if (signerIndependent(row)) return row.app_attest;
  return artifactSourceFor(circuit, currentSignerVariant());
}

/**
 * Whether this phone can name `circuit`'s files now. False only for a
 * per-signer circuit on an Android phone whose chain kind is not known yet:
 * the launch prefetch leaves those to the proof, which learns the kind first.
 */
export function circuitFilesDecidableNow(circuit: string): boolean {
  const row = ownRow(circuit);
  if (!row || signerIndependent(row)) return true;
  return currentSignerPlatform() === 'ios' || knownAndroidChainKind() !== null;
}

/** A full commit, or a version tag (`v2.0.0`, `v2.0.0-rc.1`). Never a branch name. */
const PINNED_REF_SHAPE = /^(?:[0-9a-f]{40}|v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;

/**
 * The ref a source's files are read from. An Android row must name a full
 * commit; until ANDROID_SIGNATURE_CIRCUITS_REF is filled in, this is the
 * error every Android download of these circuits ends at. Any other row names
 * a full commit or a version tag; a branch name (`main`) is an error.
 */
export function requireArtifactRef(source: CircuitArtifactSource): string {
  if (source.variant !== 'app_attest' && !/^[0-9a-f]{40}$/.test(source.ref)) {
    throw new Error(
      `${source.refName} is ${source.ref === '' ? 'empty' : `'${source.ref}'`}: set it to the 40-hex zkproofport/circuits ` +
        `commit carrying the CI-built ${source.remoteFileName} files (src/config/circuitArtifacts.ts).`,
    );
  }
  if (source.ref === '') throw new Error(`${source.refName} is empty (src/config/circuitArtifacts.ts).`);
  if (!PINNED_REF_SHAPE.test(source.ref)) {
    throw new Error(
      `${source.refName} is '${source.ref}', which is not a full 40-hex zkproofport/circuits commit or a vX.Y.Z[-pre] tag: ` +
        `a branch moves under an installed app (src/config/circuitArtifacts.ts).`,
    );
  }
  return source.ref;
}

/**
 * The ref a circuit's verifier broadcast record is read from, when the record
 * belongs to its pinned files: a row that is the same source on every signer
 * (Laboratory circuits, Human Passport). Undefined for a circuit with no row
 * and for a per-signer row (whose records the app does not read: their
 * BROADCAST_PATHS entries are null). Throws, naming the constant, for an
 * empty or branch-shaped ref.
 */
export function signerIndependentArtifactRef(circuit: string): string | undefined {
  const row = ownRow(circuit);
  if (!row || !signerIndependent(row)) return undefined;
  return requireArtifactRef(row.app_attest);
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
