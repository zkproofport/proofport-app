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
 * a circuit added to `@zkproofport-app/sdk` fails `tsc` here until this file
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
   * How to resolve the broadcast JSON URL.
   * - development: read directly from main branch (latest deployments)
   * - production: resolve latest GitHub Release tag first (verified deployments)
   */
  broadcastSource:
    | {type: 'branch'; baseUrl: string}
    | {type: 'release'; repo: string};
}

export const VERIFIER_ABI = [
  'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];

export const AUTHORIZED_SIGNERS = [
  '0x952f32128AF084422539C4Ff96df5C525322E564',
  '0x8844591D47F17bcA6F5dF8f6B64F4a739F1C0080',
  '0x88fe64ea2e121f49bb77abea6c0a45e93638c3c5',
  '0x44ace9abb148e8412ac4492e9a1ae6bd88226803',
];

const GITHUB_REPO = 'zkproofport/circuits';
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
    broadcastSource: {
      type: 'branch',
      baseUrl: `${GITHUB_RAW('main')}/broadcast`,
    },
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
    broadcastSource: {
      type: 'branch',
      baseUrl: `${GITHUB_RAW('main')}/broadcast`,
    },
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
    broadcastSource: {
      type: 'release',
      repo: GITHUB_REPO,
    },
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
  // giwa_attestation is a PoC — addresses come from FALLBACK_VERIFIERS only
  giwa_attestation: null,
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
        const vkPath = CIRCUIT_VK_PATHS[circuit];
        return [
          circuit,
          vkPath
            ? {
                basePath: vkPath.replace(/\/vk$/, ''),
                vkPath,
                vkFileName: 'vk',
              }
            : null,
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
  coinbase_attestation: 1,
  coinbase_country_attestation: 1,
  oidc_domain_attestation: 3, // provider public input + MAX_PARTIAL_DATA_LENGTH 768
  giwa_attestation: 1,
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
  mdl_kr_ownership: 6,
  mdl_kr_age: 6,
  mdl_kr_region: 6,
};

/**
 * Per-circuit network override.
 * Most circuits use the env-default network (Base). GIWA attestation lives
 * on a different chain entirely (GIWA Sepolia, chain ID 91342), so we pin
 * its network here regardless of the build environment.
 *
 * `undefined` = use STATIC_CONFIGS[env].network.
 */
export const CIRCUIT_NETWORK_OVERRIDES: Record<CircuitName, NetworkConfig | undefined> = {
  coinbase_attestation: undefined,
  coinbase_country_attestation: undefined,
  oidc_domain_attestation: undefined,
  giwa_attestation: {
    chainId: 91342,
    name: 'GIWA Sepolia',
    rpcUrl: 'https://sepolia-rpc.giwa.io/',
    explorerUrl: 'https://sepolia-explorer.giwa.io',
  },
  // Korea Mobile ID verifiers currently live on Base Sepolia. OmniOne
  // Chain (Hyperledger Besu permissioned network) access requires a
  // signup whose RPC URL is not publicly available; the UI labels the
  // network as "OmniOne" for the demo and we will repoint these
  // overrides once OmniOne Chain access is granted.
  mdl_kr_ownership: {
    chainId: 84532,
    name: 'OmniOne Chain Testnet',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  mdl_kr_age: {
    chainId: 84532,
    name: 'OmniOne Chain Testnet',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  mdl_kr_region: {
    chainId: 84532,
    name: 'OmniOne Chain Testnet',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
};

/**
 * Fallback verifier addresses (used when runtime fetch fails).
 * Updated by scripts/sync-deployments.sh or manually.
 */
export const FALLBACK_VERIFIERS: Record<Environment, Record<CircuitName, string>> = {
  development: {
    coinbase_attestation: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c',
    coinbase_country_attestation: '0xdEe363585926c3c28327Efd1eDd01cf4559738cf',
    oidc_domain_attestation: '0x27afdea349f247cf698f97fdfab59e1bf8bd0550',
    // GIWA PoC verifier — same address across env (testnet-only PoC)
    giwa_attestation: '0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492',
    // Korea mDL — three independent verifiers on Base Sepolia (v4 circuits).
    mdl_kr_ownership: '0x7602D09d24E6E16efF5AB981646872886376763E',
    mdl_kr_age:       '0xcFF90FF8cEADc98f625300dc976eD85A3AA943Ba',
    mdl_kr_region:    '0x435F0448F02F5Df9659D460181116BCaF37E518E',
  },
  staging: {
    coinbase_attestation: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c',
    coinbase_country_attestation: '0xdEe363585926c3c28327Efd1eDd01cf4559738cf',
    oidc_domain_attestation: '0x27afdea349f247cf698f97fdfab59e1bf8bd0550',
    giwa_attestation: '0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492',
    mdl_kr_ownership: '0x7602D09d24E6E16efF5AB981646872886376763E',
    mdl_kr_age:       '0xcFF90FF8cEADc98f625300dc976eD85A3AA943Ba',
    mdl_kr_region:    '0x435F0448F02F5Df9659D460181116BCaF37E518E',
  },
  production: {
    coinbase_attestation: '0xF7dED73E7a7fc8fb030c35c5A88D40ABe6865382',
    coinbase_country_attestation: '0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C',
    oidc_domain_attestation: '0x9677Ba46Ad226Ce8B3C4517d9c0143e4D458BeAe',
    giwa_attestation: '0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492',
    // Korea mDL not yet deployed to a mainnet. Pinning to the Base
    // Sepolia addresses (v4 circuits) until OmniOne Chain mainnet access
    // is granted.
    mdl_kr_ownership: '0x7602D09d24E6E16efF5AB981646872886376763E',
    mdl_kr_age:       '0xcFF90FF8cEADc98f625300dc976eD85A3AA943Ba',
    mdl_kr_region:    '0x435F0448F02F5Df9659D460181116BCaF37E518E',
  },
};
