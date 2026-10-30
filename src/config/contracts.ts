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
   * The Laboratory circuits read `main` in every build (MAIN_BRANCH_CIRCUIT_IDS).
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
 * The circuits branch that development and staging builds, and the main-only
 * circuits in every build, read from. Named once so a build can be pointed at
 * another branch -- a toolchain change, say -- by changing one line.
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
 * `v2.0.0` is the tag planned for the OIDC v2 / beta.19 circuit set. It does
 * not exist yet; a production build made before it is published fails at
 * launch (E3007) and at circuit download (E3005) naming this tag. It never
 * falls back to `main` or to another release.
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
  // Was `null` with a note that GIWA addresses come from the built-in
  // fallbacks only. They do not have to: `forge script` writes this broadcast
  // on every deploy exactly like the others, so a redeployed GIWA verifier now
  // reaches a device instead of waiting for someone to edit a constant.
  giwa_attestation: (chainId) =>
    `DeployGiwaAttestation.s.sol/${chainId}/run-latest.json`,
  dojang_playground: (chainId) =>
    `DeployDojangPlayground.s.sol/${chainId}/run-latest.json`,
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
  // Every circuit bumped together for the nargo 1.0.0-beta.19 / bb 4.2.0
  // toolchain: the bytecode, keys and reference strings all changed, and a
  // device holding the old files would hand beta.8 bytecode to the new prover.
  coinbase_attestation: 2,
  // v3: Coinbase Country v2 (215 public inputs, device statement); read from
  // the pinned ref in circuitArtifacts.ts, whose iPhone row carries the same
  // version. v1's files (version 2) are deleted and fetched again.
  coinbase_country_attestation: 3,
  // v4: provider public input + MAX_PARTIAL_DATA_LENGTH 768.
  // v5: OIDC v2 (circuits a874776) -- aud_hash, nonce_mode, nonce_binding, now
  // appended (148 -> 214 public inputs), MAX_PARTIAL_DATA_LENGTH 2048. A v4
  // file set would be handed v2 inputs and fail to execute.
  // v6: provider-key statement (circuits oidc-signature): ten private signer
  // inputs after signature_limbs; public inputs unchanged. Read from the
  // pinned ref in circuitArtifacts.ts, whose row carries the same version.
  oidc_domain_attestation: 6,
  // v2: the circuit signs an EIP-712 action when one is supplied, dropped
  // signal_hash from the nullifier, and grew from 128 to 192 public inputs.
  giwa_attestation: 3,
  // v1: first release of the circuit (circuits 4bba5ed).
  dojang_playground: 2,
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
    // Coinbase KYC v2, Base Sepolia, deployed 2026-10-28 by circuits
    // scripts/deploy_verifier.sh coinbase-attestation-v2 base-sepolia
    // (circuits e498841, broadcast/DeployCoinbaseAttestationV2.s.sol/84532,
    // in tag v2.0.0-rc.1). Replaces the 2026-10-23 circuit's 0xF898db95...Bb12
    // (circuits 33344e2), which rejects every final-v2 proof (other vk).
    coinbase_attestation: '0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6',
    // Coinbase Country v2: EMPTY until its verifier is deployed and core pins
    // it. A Country proof is refused before proving while this is empty
    // (requireVerifierForVariant, E2018). v1's 0x9DEea218...DDcE rejects every
    // v2 proof (other vk) and is never named here.
    coinbase_country_attestation: '',
    // OIDC with the provider-key statement (circuits 5081cfd), Base Sepolia,
    // deployed 2026-10-28 (circuits 7e5c72d,
    // broadcast/DeployOidcDomainAttestation.s.sol/84532), the contract core
    // 0.4.0-beta.0 pins. The OIDC v2 verifier from before the statement
    // (0x003334A7...4167) and v1's 0x5D9E...F485 reject every proof of this
    // circuit (other vk).
    oidc_domain_attestation: '0xeA5933ABc598401c89F63B3f13AE56A7E78984e8',
    // GIWA verifier on GIWA Sepolia, same address across env (testnet-only).
    // Every testnet verifier was redeployed 2026-10-22 for the nargo
    // 1.0.0-beta.19 / bb 4.2.0 toolchain (circuits/deployments/). The previous
    // contracts are still live and still verify the OLD proofs, so an app left
    // on an old address fails every new proof while looking like a proof
    // problem.
    giwa_attestation: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    // Dojang Playground verifier on GIWA Sepolia, same address across env
    // (testnet-only). circuits/deployments/91342/DojangPlayground.json.
    dojang_playground: '0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816',
  },
  staging: {
    coinbase_attestation: '0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6',
    coinbase_country_attestation: '',
    oidc_domain_attestation: '0xeA5933ABc598401c89F63B3f13AE56A7E78984e8',
    giwa_attestation: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    dojang_playground: '0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816',
  },
  production: {
    // Base mainnet, nargo 1.0.0-beta.19 / bb 4.2.0-aztecnr-rc.2 contracts.
    // Coinbase KYC v2: circuits 1d41d85, broadcast/DeployCoinbaseAttestationV2.s.sol/8453
    // (the v1 contract 0xF7dED73E...5382 rejects every v2 proof).
    coinbase_attestation: '0x6FC22d3576FB70457d1529B3F70f711A3cBA7A7F',
    // Coinbase Country v2: EMPTY until deployed and pinned by core (see
    // development). v1's 0x8e89f11E...0C56 (circuits 1d41d85) rejects every
    // v2 proof.
    coinbase_country_attestation: '',
    // OIDC with the provider-key statement (circuits 5081cfd), deployed
    // 2026-10-29: circuits da21683, broadcast/DeployOidcDomainAttestation.s.sol/8453.
    oidc_domain_attestation: '0xF1AA88aD844bFd1dc552526a67f5980aAd4E7f35',
    giwa_attestation: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    dojang_playground: '0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816',
  },
};
