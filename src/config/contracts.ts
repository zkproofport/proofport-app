/**
 * Static network and contract configuration.
 *
 * This file contains settings that do NOT come from broadcast JSON:
 * - Network config (RPC, explorer, chain ID)
 * - Attestation config (attester, signers, EAS)
 * - Verifier ABI
 * - Fallback addresses (used when runtime fetch fails)
 *
 * Contract addresses are fetched at runtime from GitHub broadcast JSON.
 * See deployments.ts for the fetch logic.
 */

import {ALL_CIRCUIT_IDS, CIRCUIT_VK_PATHS, type CircuitName} from './circuitIds';

export type Environment = 'development' | 'staging' | 'production';

/*
 * `CircuitName` is the SDK's canonical id union — see `./circuitIds`. It used
 * to be re-declared here as a literal union, which is what let this file's
 * tables and the rest of the app disagree about which circuits exist. Every
 * `Record<CircuitName, …>` below is now exhaustive over the PUBLISHED list, so
 * a circuit added to `@zkproofport-app/core` fails `tsc` here until this file
 * says what its path, address, version and network are.
 */
export type {CircuitName};

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
}

export interface AttestationConfig {
  coinbaseAttester: string;
  authorizedSigners: string[];
  easGraphqlEndpoint: string;
}

export interface RelayConfig {
  /** Trusted relay hostnames (e.g., ['relay.zkproofport.app']) */
  trustedHosts: string[];
  /** If true, private IP ranges (10.x, 192.168.x, 172.16-31.x, localhost) are also trusted */
  allowPrivateIps: boolean;
  /**
   * The relay the app itself calls (not a dApp's callback): the Play
   * Integrity decryption of a factory-provisioned Android phone's verdict
   * (POST /api/v1/play-integrity/decrypt). https://host, no path.
   */
  apiBaseUrl: string;
}

export interface StaticConfig {
  network: NetworkConfig;
  attestation: AttestationConfig;
  rpcUrls: {
    base: string[];
  };
  relay: RelayConfig;
  /**
   * Which circuits ref the officially supported circuits (Coinbase KYC,
   * Coinbase Country, OIDC domain) read their files AND verifier records from.
   * - development / staging: the branch `CIRCUITS_BRANCH` (`main`), on purpose:
   *   test builds follow the circuits as they are developed.
   * - production: exactly `CIRCUITS_RELEASE_TAG`, fixed at build time.
   * Reached only by a circuit with no pinned row in circuitArtifacts.ts, and
   * every circuit has one today (each row's exact ref is read in every
   * environment; the Laboratory circuits' is LAB_CIRCUITS_REF).
   */
  circuitsSource:
    | {type: 'branch'; branch: string}
    | {type: 'release'; tag: string};
}

export const AUTHORIZED_SIGNERS = [
  '0x952f32128AF084422539C4Ff96df5C525322E564',
  '0x8844591D47F17bcA6F5dF8f6B64F4a739F1C0080',
  '0x88fe64ea2e121f49bb77abea6c0a45e93638c3c5',
  '0x44ace9abb148e8412ac4492e9a1ae6bd88226803',
];

const GITHUB_REPO = 'zkproofport/circuits';
/**
 * The circuits branch that development and staging builds read from for a
 * circuit with no pinned row in circuitArtifacts.ts (none today). No circuit
 * reads it in a production build, and the Laboratory circuits no longer read
 * it anywhere (LAB_CIRCUITS_REF, since 2026-11-17).
 */
export const CIRCUITS_BRANCH = 'main';

/**
 * THE circuits release a production build of this app proves with: circuit
 * files (json / srs / vk / SHA256SUMS) and verifier records (broadcast JSON)
 * for every officially supported circuit come from this exact tag, and from
 * nothing else.
 *
 * Decided 2026-10-27 ("the app must not follow the latest release"). Until
 * then production asked the GitHub API for the newest release at launch, so
 * publishing a circuits tag silently switched every installed app to new
 * circuits and verifiers -- including apps whose input builders predate them.
 * Now a new circuit set reaches users only with a new app version that names
 * it here.
 *
 * `v2.0.0` is the OIDC v2 / beta.19 circuit set, published 2026-10-29 as a
 * GitHub pre-release (circuits 2a06942). Its files and verifiers are the
 * nargo 1.0.0-beta.19 / bb 4.2 ones: a build with the Noir 1.0.0 / bb 6.0.0
 * prover needs a tag carrying the 1.0.0 files and the redeployed verifiers'
 * broadcast records (app-dev.md "Noir 1.0.0 / bb 6.0.0 prover"). A tag that
 * does not exist fails at launch (E3007) and at circuit download (E3005)
 * naming it; it never falls back to `main` or to another release.
 */
export const CIRCUITS_RELEASE_TAG = 'v2.0.0';
const GITHUB_RAW = (ref: string) =>
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${ref}`;

export const STATIC_CONFIGS: Record<Environment, StaticConfig> = {
  development: {
    network: {
      chainId: 84532,
      name: 'Base Sepolia',
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
    },
    attestation: {
      coinbaseAttester: '0x357458739F90461b99789350868CD7CF330Dd7EE',
      authorizedSigners: AUTHORIZED_SIGNERS,
      easGraphqlEndpoint: 'https://base-sepolia.easscan.org/graphql',
    },
    rpcUrls: {
      base: ['https://sepolia.base.org'],
    },
    relay: {
      // Dev builds (__DEV__) accept localhost (LAN dev), the staging relay
      // (when developing against staging community), and the production
      // relay (since OpenStoa staging currently has RELAY_URL pointing at
      // production until that env var is reconfigured).
      trustedHosts: ['localhost', 'stg-relay.zkproofport.app', 'relay.zkproofport.app'],
      allowPrivateIps: true,
      // Development builds decrypt Play Integrity verdicts on the staging
      // relay: a local relay holds no decryption key.
      apiBaseUrl: 'https://stg-relay.zkproofport.app',
    },
    circuitsSource: {type: 'branch', branch: CIRCUITS_BRANCH},
  },
  staging: {
    network: {
      chainId: 84532,
      name: 'Base Sepolia',
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
    },
    attestation: {
      coinbaseAttester: '0x357458739F90461b99789350868CD7CF330Dd7EE',
      authorizedSigners: AUTHORIZED_SIGNERS,
      easGraphqlEndpoint: 'https://base-sepolia.easscan.org/graphql',
    },
    rpcUrls: {
      base: ['https://sepolia.base.org'],
    },
    relay: {
      // OpenStoa staging deployment currently uses RELAY_URL=relay.zkproofport.app
      // (production relay) in its env config. Until that is reconfigured to the
      // staging relay, accept production relay in staging builds so the
      // self-relay login flow can complete during dev.
      trustedHosts: ['stg-relay.zkproofport.app', 'relay.zkproofport.app'],
      allowPrivateIps: false,
      apiBaseUrl: 'https://stg-relay.zkproofport.app',
    },
    circuitsSource: {type: 'branch', branch: CIRCUITS_BRANCH},
  },
  production: {
    network: {
      chainId: 8453,
      name: 'Base',
      rpcUrl: 'https://mainnet.base.org',
      explorerUrl: 'https://basescan.org',
    },
    attestation: {
      coinbaseAttester: '0x357458739F90461b99789350868CD7CF330Dd7EE',
      authorizedSigners: AUTHORIZED_SIGNERS,
      easGraphqlEndpoint: 'https://base.easscan.org/graphql',
    },
    rpcUrls: {
      base: [
        'https://base.llamarpc.com',
        'https://base-rpc.publicnode.com',
        'https://base.drpc.org',
        'https://mainnet.base.org',
      ],
    },
    relay: {
      trustedHosts: ['relay.zkproofport.app'],
      allowPrivateIps: false,
      apiBaseUrl: 'https://relay.zkproofport.app',
    },
    circuitsSource: {type: 'release', tag: CIRCUITS_RELEASE_TAG},
  },
};

/**
 * Helper to construct raw GitHub URL for a given ref (branch or tag).
 */
export {GITHUB_RAW};

/**
 * Broadcast JSON file paths per circuit (relative to broadcastBaseUrl).
 * Pattern: <DeployScript>.s.sol/<chainId>/run-latest.json
 */
export const BROADCAST_PATHS: Record<CircuitName, ((chainId: number) => string) | null> = {
  // Coinbase KYC v2's deploy record is DeployCoinbaseAttestationV2.s.sol
  // (circuits main and v2.0.0-rc.1, Base Sepolia only). It stays null here on
  // purpose: production reads broadcasts from CIRCUITS_RELEASE_TAG (v2.0.0,
  // not published), where a missing record ends at E3007, and this row's
  // DeployCoinbaseAttestation record names v1's verifier, which rejects every
  // v2 proof. The address is the per-environment fallback below, and
  // getVerifierAddress skips the cache for a null row, so neither can win.
  // Point it at DeployCoinbaseAttestationV2 when the pinned release carries it.
  coinbase_attestation: null,
  // Coinbase Country v2: null for Coinbase KYC v2's reason. The
  // DeployCoinbaseCountryAttestation record names v1's verifier, which
  // rejects every v2 proof; v2's (DeployCoinbaseCountryAttestationV2) is not
  // on a ref this app reads yet. The address is the fallback below.
  coinbase_country_attestation: null,
  // OIDC with the provider-key statement: null for the same reason. Its record
  // (circuits 7e5c72d) is only on branch oidc-signature; circuits main and
  // CIRCUITS_RELEASE_TAG still name the verifier from before the statement,
  // which rejects every proof of the pinned circuit (circuitArtifacts.ts).
  // Restore the row when the record is on the ref this app reads.
  oidc_domain_attestation: null,
  // GIWA KYC and the Dojang Playground v2 (2026-11-27): null for Coinbase KYC
  // v2's reason. Each has three packages with their own deploy scripts
  // (DeployGiwaAttestationV2, ...Android, ...AndroidFactory), so one record
  // path cannot name the contract a proof verifies on; the address is the
  // per-environment row below (iPhone) or variantVerifiers.ts (Android), which
  // core pins. The old DeployGiwaAttestation / DeployDojangPlayground records
  // name the contracts that checked only the issuing transaction.
  giwa_attestation: null,
  dojang_playground: null,
  // Human Passport score: null for Coinbase KYC v2's reason -- the record
  // (DeployHumanPassportScore) is read only from the ref circuitArtifacts.ts
  // pins; the address is the per-environment row below, which core pins.
  human_passport_score: null,
};

/**
 * Every circuit whose verifier address can be refreshed from a broadcast JSON,
 * derived from the table above rather than typed out a second time.
 *
 * `syncDeployments()` used to carry its own hand-written list of three, so
 * circuits with a published broadcast JSON never refreshed off
 * `FALLBACK_VERIFIERS`. Deriving it means the list cannot be shorter than the
 * paths that exist.
 */
export const CIRCUITS_WITH_BROADCAST: ReadonlyArray<CircuitName> =
  Object.freeze(ALL_CIRCUIT_IDS.filter((c) => BROADCAST_PATHS[c] !== null));

export interface CircuitFilePaths {
  basePath: string;
  vkPath: string;
  vkFileName: string;
}

/**
 * Circuit file paths per circuit, derived from the SDK.
 *
 * ONE LIST, NOT TWO. This used to be seven hand-written rows naming the same
 * directories the SDK names in CIRCUIT_VK_PATHS. Two copies of the same fact
 * drift silently: a circuit renamed in the circuits repo goes wrong here as a
 * 404 during download, which reads as a network problem rather than a stale
 * path. The SDK gained the list when off-chain verification needed it, so the
 * app reads it instead of repeating it.
 *
 * The shape stays the same — `basePath` is the directory the circuit's compiled
 * JSON and SRS sit in, which is the verification key's path minus its final
 * `/vk` segment.
 *
 * null = circuit files hosted externally (not in zkproofport/circuits).
 */
export const CIRCUIT_FILE_PATHS: Record<CircuitName, CircuitFilePaths | null> =
  Object.freeze(
    Object.fromEntries(
      ALL_CIRCUIT_IDS.map((circuit) => {
        // The SDK stores the key's FILE path (`…/target/vk/vk`). This app
        // wants it split, because circuitDownload.ts joins `vkPath` and
        // `vkFileName` back together with a slash: the directory is one
        // segment up, and `basePath` — where the circuit JSON and SRS sit — is
        // one above that. Deriving both from the file path rather than keeping
        // a second copy is the point; the two lists disagreeing is what made a
        // browser ask GitHub for a directory and get a 404.
        const vkFile = CIRCUIT_VK_PATHS[circuit];
        if (!vkFile) return [circuit, null];
        const lastSlash = vkFile.lastIndexOf('/');
        const vkDir = vkFile.slice(0, lastSlash);
        return [
          circuit,
          {
            basePath: vkDir.slice(0, vkDir.lastIndexOf('/')),
            vkPath: vkDir,
            vkFileName: vkFile.slice(lastSlash + 1),
          },
        ];
      }),
    ) as Record<CircuitName, CircuitFilePaths | null>,
  );
/**
 * Per-circuit data versions — bump individually when a circuit is recompiled.
 * Forces re-download of cached circuit files on devices.
 * Only bump the circuit that actually changed.
 */
export const CIRCUIT_DATA_VERSIONS: Record<CircuitName, number> = {
  // Every circuit bumped together again for the Noir 1.0.0 / bb 6.0.0
  // toolchain (mopro/vendor/noir-rs): every key differs, and a device holding
  // beta.19 / bb 4.2 files would hand them to the new prover. The pinned rows
  // in circuitArtifacts.ts carry their own versions, bumped the same day (GIWA
  // and the Dojang Playground's rows carry these two). Every circuit's files
  // now come from a pinned ref, and moving a ref replaces cached files by
  // itself (the stored base URL names the ref); these numbers keep a file set
  // cached under the old toolchain from being reused when the ref has not
  // moved yet.
  //
  // v2: nargo 1.0.0-beta.19 / bb 4.2.0 (every circuit bumped together).
  // v5: Noir 1.0.0 / bb 6.0.0, above the Android rows' 3 and 4. Read from
  // the pinned ref in circuitArtifacts.ts, whose iPhone row carries the same
  // version.
  // v8: OPRF nullifier (133 public inputs), OPRF_CIRCUITS_REF.
  coinbase_attestation: 8,
  // v3: Coinbase Country v2 (215 public inputs, device statement); read from
  // the pinned ref in circuitArtifacts.ts, whose iPhone row carries the same
  // version. v1's files (version 2) are deleted and fetched again.
  // v6: Noir 1.0.0 / bb 6.0.0, above the old Android rows' 4 and 5.
  // v9: OPRF nullifier (155 public inputs), OPRF_CIRCUITS_REF.
  coinbase_country_attestation: 9,
  // v4: provider public input + MAX_PARTIAL_DATA_LENGTH 768.
  // v5: OIDC v2 (circuits a874776) -- aud_hash, nonce_mode, nonce_binding, now
  // appended (148 -> 214 public inputs), MAX_PARTIAL_DATA_LENGTH 2048. A v4
  // file set would be handed v2 inputs and fail to execute.
  // v6: provider-key statement (circuits oidc-signature): ten private signer
  // inputs after signature_limbs; public inputs unchanged. Read from the
  // pinned ref in circuitArtifacts.ts, whose row carries the same version.
  // v9: Noir 1.0.0 / bb 6.0.0, above the old Android rows' 7 and 8.
  oidc_domain_attestation: 9,
  // v2: the circuit signs an EIP-712 action when one is supplied, dropped
  // signal_hash from the nullifier, and grew from 128 to 192 public inputs.
  // v4: Noir 1.0.0 / bb 6.0.0.
  // v5: OPRF nullifier (132 public inputs), OPRF_CIRCUITS_REF.
  // v6: the device status statement (133 public inputs), GIWA_V2_CIRCUITS_REF;
  // the iPhone row (Android rows 7, 8).
  giwa_attestation: 6,
  // v1: first release of the circuit (circuits 4bba5ed).
  // v3: Noir 1.0.0 / bb 6.0.0.
  // v4: OPRF nullifier (100 public inputs, 2^19), OPRF_CIRCUITS_REF.
  // v5: the device status statement (101 public inputs), GIWA_V2_CIRCUITS_REF;
  // the iPhone row (Android rows 6, 7).
  dojang_playground: 5,
  // v1: first release (circuits human-passport-score); read from the pinned
  // ref in circuitArtifacts.ts, whose row carries the same version.
  // v2: Noir 1.0.0 / bb 6.0.0.
  // v3: OPRF nullifier (135 public inputs), OPRF_CIRCUITS_REF.
  human_passport_score: 3,
};

/**
 * Per-circuit network override.
 * Most circuits use the env-default network (Base). GIWA attestation lives
 * on a different chain entirely (GIWA Sepolia, chain ID 91342), so we pin
 * its network here regardless of the build environment.
 *
 * `undefined` = use STATIC_CONFIGS[env].network.
 */
/**
 * The chain each circuit's verifier lives on. Complete, and per environment.
 *
 * There is no default. There used to be: a single "network" per build
 * environment, with circuits naming a chain only when they differed from it —
 * so every circuit that said nothing inherited Base, because Base is where
 * this app started. That is not a property of the project; it was the first
 * chain and it became the answer for chains nobody had thought about.
 *
 * The cost showed up the moment circuits spread: a proof for a circuit whose
 * verifier lives off Base was checked against the Coinbase contract on Base
 * Sepolia and reported "failed" while being valid, because the code asked the BUILD what chain it
 * was on instead of asking the CIRCUIT. Fixing the caller is half of it; the
 * other half is that the wrong answer had to exist to be returned.
 *
 * Adding a circuit now means writing its chain here for all three
 * environments, and a missing one is a compile error rather than Base.
 */
export const CIRCUIT_NETWORKS: Record<Environment, Record<CircuitName, NetworkConfig>> = (() => {
  const BASE_SEPOLIA: NetworkConfig = {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  };
  const BASE: NetworkConfig = {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  };
  const GIWA_SEPOLIA: NetworkConfig = {
    chainId: 91342,
    name: 'GIWA Sepolia',
    rpcUrl: 'https://sepolia-rpc.giwa.io/',
    explorerUrl: 'https://sepolia-explorer.giwa.io',
  };
  const testnetish = (coinbaseChain: NetworkConfig): Record<CircuitName, NetworkConfig> => ({
    coinbase_attestation: coinbaseChain,
    coinbase_country_attestation: coinbaseChain,
    oidc_domain_attestation: coinbaseChain,
    giwa_attestation: GIWA_SEPOLIA,
    // The Playground faucet and the circuit's chain-id literal are GIWA Sepolia.
    dojang_playground: GIWA_SEPOLIA,
    // Verified where Coinbase is. The score is read on the chain the person
    // chose (one of Human Passport's six mainnets), not here.
    human_passport_score: coinbaseChain,
  });

  return {
    development: testnetish(BASE_SEPOLIA),
    staging: testnetish(BASE_SEPOLIA),
    production: testnetish(BASE),
  };
})();

/**
 * Fallback verifier addresses (used when runtime fetch fails).
 *
 * Each row MUST equal `@zkproofport-app/core`'s pinned verifier for the
 * circuit on its CIRCUIT_NETWORKS chain. Since core 0.2.0 every verifier --
 * dApps, proofport-ai, and this app's own on-chain check -- calls the pinned
 * contract and refuses a proof whose response names another address, and the
 * app sends this address with every proof. A row that drifts would make every
 * dApp refuse the app's proofs. `verifierAddressesComeFromCore.test.ts` holds
 * the rows to core's table.
 *
 * Kept as literals rather than read from core at load: importing core's root
 * here pulls ethers v5's `@types/node` reference ahead of React Native's
 * globals and breaks `tsc` across the app (measured 2026-10-27: 36 errors in
 * fetch/AbortSignal/setTimeout typings). Core's root stays in
 * utils/proofVerification.ts only.
 */
export const FALLBACK_VERIFIERS: Record<Environment, Record<CircuitName, string>> = {
  development: {
    // Every testnet row: the bb 6.0.0 / nargo 1.0.0 contracts with the OPRF
    // nullifier, deployed 2026-11-20 (circuits 954eb90 broadcast records:
    // DeployCoinbaseAttestationV2, DeployCoinbaseCountryAttestationV2,
    // DeployOidcDomainAttestation, DeployHumanPassportScore on Base Sepolia
    // 84532; DeployGiwaAttestation, DeployDojangPlayground on GIWA Sepolia
    // 91342), the contracts @zkproofport-app/core 0.4.0-beta.9 pins. Every
    // earlier contract (bb 4.2 and before) rejects every proof of these
    // circuits (other vk) and is never named here.
    coinbase_attestation: '0xe78fCDc7562ce3afCEadaF29f4b8B96DC997C01A',
    coinbase_country_attestation: '0xe88033179576869c8730160EcBfaa7e5b2c1A4a9',
    oidc_domain_attestation: '0x14a2241B0A24679825BeFAaa562d4A204262D84f',
    // GIWA and Dojang Playground are testnet-only (GIWA Sepolia) in every build.
    // v2 with the device status statement (revocation and expiry bound in the
    // circuit), iPhone package, deployed 2026-11-27: GiwaAttestationV2,
    // DojangPlaygroundV2. The previous contracts (0xA272...a060, 0x4004...5D01)
    // checked only the issuing transaction and reject every v2 proof.
    giwa_attestation: '0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE',
    dojang_playground: '0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724',
    human_passport_score: '0x223e372553739678365486a3Ded05310B5BCbc0C',
  },
  staging: {
    coinbase_attestation: '0xe78fCDc7562ce3afCEadaF29f4b8B96DC997C01A',
    coinbase_country_attestation: '0xe88033179576869c8730160EcBfaa7e5b2c1A4a9',
    oidc_domain_attestation: '0x14a2241B0A24679825BeFAaa562d4A204262D84f',
    giwa_attestation: '0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE',
    dojang_playground: '0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724',
    human_passport_score: '0x223e372553739678365486a3Ded05310B5BCbc0C',
  },
  production: {
    // Base mainnet, nargo 1.0.0-beta.19 / bb 4.2.0-aztecnr-rc.2 contracts. Core
    // 0.4.0-beta.9 lists each of these four in AWAITING_REDEPLOY (built from a
    // key that is no longer the circuit's) and refuses to verify on them; the
    // rows move to the bb 6.0.0 mainnet contracts with the production release.
    // Coinbase KYC v2: circuits 1d41d85, broadcast/DeployCoinbaseAttestationV2.s.sol/8453
    // (the v1 contract 0xF7dED73E...5382 rejects every v2 proof).
    coinbase_attestation: '0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F',
    // Coinbase Country v2: circuits a5bf7ba,
    // broadcast/DeployCoinbaseCountryAttestationV2.s.sol/8453 (v1's
    // 0x8e89f11E...0C56, circuits 1d41d85, rejects every v2 proof).
    coinbase_country_attestation: '0x509DEE10cc1578361b450fED7475EA3BD69c6e8d',
    // OIDC with the provider-key statement (circuits 5081cfd), deployed
    // 2026-10-29: circuits da21683, broadcast/DeployOidcDomainAttestation.s.sol/8453.
    oidc_domain_attestation: '0xF1AA88aD844bFd1dc552526a67f5980aAd4E7f35',
    giwa_attestation: '0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE',
    dojang_playground: '0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724',
    // Human Passport score, Base mainnet, deployed 2026-10-30
    // (broadcast/DeployHumanPassportScore.s.sol/8453), the contract core pins.
    human_passport_score: '0x2d055c42a2B0c1024aC4aa83b4995fc8fD45662e',
  },
};
