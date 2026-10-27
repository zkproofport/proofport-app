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
  coinbase_attestation: (chainId) =>
    `DeployCoinbaseAttestation.s.sol/${chainId}/run-latest.json`,
  coinbase_country_attestation: (chainId) =>
    `DeployCoinbaseCountryAttestation.s.sol/${chainId}/run-latest.json`,
  oidc_domain_attestation: (chainId) =>
    `DeployOidcDomainAttestation.s.sol/${chainId}/run-latest.json`,
  // Was `null` with a note that GIWA addresses come from the built-in
  // fallbacks only. They do not have to: `forge script` writes this broadcast
  // on every deploy exactly like the others, so a redeployed GIWA verifier now
  // reaches a device instead of waiting for someone to edit a constant.
  giwa_attestation: (chainId) =>
    `DeployGiwaAttestation.s.sol/${chainId}/run-latest.json`,
  dojang_playground: (chainId) =>
    `DeployDojangPlayground.s.sol/${chainId}/run-latest.json`,
  mdl_kr_ownership: (chainId) =>
    `DeployMdlKrOwnership.s.sol/${chainId}/run-latest.json`,
  mdl_kr_age: (chainId) =>
    `DeployMdlKrAge.s.sol/${chainId}/run-latest.json`,
  mdl_kr_region: (chainId) =>
    `DeployMdlKrRegion.s.sol/${chainId}/run-latest.json`,
};

/**
 * Every circuit whose verifier address can be refreshed from a broadcast JSON,
 * derived from the table above rather than typed out a second time.
 *
 * `syncDeployments()` used to carry its own hand-written list of three, so the
 * three Korea mDL circuits — which have had a published broadcast JSON all
 * along — never refreshed off `FALLBACK_VERIFIERS`. Deriving it means the list
 * cannot be shorter than the paths that exist.
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
  coinbase_country_attestation: 2,
  // v4: provider public input + MAX_PARTIAL_DATA_LENGTH 768.
  // v5: OIDC v2 (circuits a874776) -- aud_hash, nonce_mode, nonce_binding, now
  // appended (148 -> 214 public inputs), MAX_PARTIAL_DATA_LENGTH 2048. A v4
  // file set would be handed v2 inputs and fail to execute.
  oidc_domain_attestation: 5,
  // v2: the circuit signs an EIP-712 action when one is supplied, dropped
  // signal_hash from the nullifier, and grew from 128 to 192 public inputs.
  giwa_attestation: 3,
  // v1: first release of the circuit (circuits 4bba5ed).
  dojang_playground: 2,
  // Split into 3 independent circuits sharing the canonical ci identifier.
  // v4: nullifier formula changed to keccak(keccak(ci) || scope), matching
  // the OIDC-domain-attestation pattern. signal_hash, cx_integrity_root,
  // cx_jti, cx_pri removed pending RAON RP registration (HS256 path dormant).
  // Each circuit enforces a single predicate (selective disclosure, age, region).
  // v5: force re-download to eliminate any stale on-device circuit cache
  // while diagnosing the ownership witness mismatch (circuit bytes unchanged
  // vs v4; bump only invalidates the device cache).
  // v6: verifies the cache-invalidation fix self-heals WITHOUT a reinstall --
  // a device holding the v5 cache must now auto delete + re-download on the
  // next proof run (downloadCircuitFiles is always invoked; shouldInvalidateCache
  // sees stored.dataVersion 5 != 6). Circuit bytes unchanged vs v5.
  mdl_kr_ownership: 7,
  mdl_kr_age: 7,
  mdl_kr_region: 7,
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
  // Korea Mobile ID verifiers live on Base Sepolia for now. OmniOne Chain
  // (Hyperledger Besu, permissioned) needs a signup whose RPC is not public;
  // the UI labels it "OmniOne" and these repoint once access is granted.
  const OMNIONE_TESTNET: NetworkConfig = {
    chainId: 84532,
    name: 'OmniOne Chain Testnet',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  };

  const testnetish = (coinbaseChain: NetworkConfig): Record<CircuitName, NetworkConfig> => ({
    coinbase_attestation: coinbaseChain,
    coinbase_country_attestation: coinbaseChain,
    oidc_domain_attestation: coinbaseChain,
    giwa_attestation: GIWA_SEPOLIA,
    // The Playground faucet and the circuit's chain-id literal are GIWA Sepolia.
    dojang_playground: GIWA_SEPOLIA,
    mdl_kr_ownership: OMNIONE_TESTNET,
    mdl_kr_age: OMNIONE_TESTNET,
    mdl_kr_region: OMNIONE_TESTNET,
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
/**
 * FILL IN: the OIDC v2 verifier (214 public inputs, circuits a874776) on Base
 * Sepolia, checksummed. The ONE place this build names it; development and
 * staging read it through FALLBACK_VERIFIERS below.
 *
 * Empty = not deployed yet. Take it from the circuits repo's deployment record
 * (`deployments/84532/OidcDomainAttestation.json`, or
 * `broadcast/DeployOidcDomainAttestation.s.sol/84532/run-latest.json`, the
 * `HonkVerifier` transaction) -- never from memory. While empty the app
 * reports OIDC on-chain verification as unavailable instead of calling the
 * v1 contract (0x5D9E...F485), which rejects every v2 proof.
 *
 * Filling it is not the whole step: core (`@zkproofport-app/core` 0.2.0) pins
 * the v1 contract and the v1 layout (148 inputs), and the app's on-chain check
 * goes through core. OIDC on-chain verification works once a core release
 * pins this address with the 214-input layout; `verifierAddressesComeFromCore`
 * then holds this row to it.
 */
export const OIDC_V2_VERIFIER_BASE_SEPOLIA: string = '0x003334A7C2ff15ee9ee845Ab88e152A2A3694167';

export const FALLBACK_VERIFIERS: Record<Environment, Record<CircuitName, string>> = {
  development: {
    coinbase_attestation: '0x42d165a48256Ae184e1dE4e7E6372E870E2bC883',
    coinbase_country_attestation: '0x9DEea2189aE694D7a36f65Fb7d7Dbe9f75abDDcE',
    oidc_domain_attestation: OIDC_V2_VERIFIER_BASE_SEPOLIA,
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
    // Korea mDL — three independent verifiers on Base Sepolia.
    mdl_kr_ownership: '0x49c03b925583Aa8528BBFbA5A1A4E1F9B157c95a',
    mdl_kr_age:       '0x45d4850a9B197ceBa185B5069Fb13Ce0be1dC6d6',
    mdl_kr_region:    '0x044116dF792eB424c9648DF2DeEda97aFa617Ac0',
  },
  staging: {
    coinbase_attestation: '0x42d165a48256Ae184e1dE4e7E6372E870E2bC883',
    coinbase_country_attestation: '0x9DEea2189aE694D7a36f65Fb7d7Dbe9f75abDDcE',
    oidc_domain_attestation: OIDC_V2_VERIFIER_BASE_SEPOLIA,
    giwa_attestation: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    dojang_playground: '0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816',
    mdl_kr_ownership: '0x49c03b925583Aa8528BBFbA5A1A4E1F9B157c95a',
    mdl_kr_age:       '0x45d4850a9B197ceBa185B5069Fb13Ce0be1dC6d6',
    mdl_kr_region:    '0x044116dF792eB424c9648DF2DeEda97aFa617Ac0',
  },
  production: {
    coinbase_attestation: '0xF7dED73E7a7fc8fb030c35c5A88D40ABe6865382',
    coinbase_country_attestation: '0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C',
    oidc_domain_attestation: '0x9677Ba46Ad226Ce8B3C4517d9c0143e4D458BeAe',
    giwa_attestation: '0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3',
    dojang_playground: '0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816',
    // Korea mDL not yet deployed to a mainnet. Pinning to the Base
    // Sepolia addresses until OmniOne Chain mainnet access is granted.
    // The three Coinbase-family mainnet verifiers above are still the
    // beta.8 contracts: they need a mainnet redeploy before this toolchain
    // ships to production.
    mdl_kr_ownership: '0x49c03b925583Aa8528BBFbA5A1A4E1F9B157c95a',
    mdl_kr_age:       '0x45d4850a9B197ceBa185B5069Fb13Ce0be1dC6d6',
    mdl_kr_region:    '0x044116dF792eB424c9648DF2DeEda97aFa617Ac0',
  },
};
