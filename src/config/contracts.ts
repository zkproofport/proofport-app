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

export type Environment = 'development' | 'staging' | 'production';

export type CircuitName = 'coinbase_attestation' | 'coinbase_country_attestation' | 'oidc_domain_attestation';

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
};

export interface CircuitFilePaths {
  basePath: string;
  vkPath: string;
  vkFileName: string;
}

/**
 * Circuit file paths per circuit (relative to repo root).
 * Used by circuitDownload.ts to construct download URLs.
 * null = circuit files hosted externally (not in zkproofport/circuits).
 */
export const CIRCUIT_FILE_PATHS: Record<CircuitName, CircuitFilePaths | null> = {
  coinbase_attestation: {
    basePath: 'coinbase-attestation/target',
    vkPath: 'coinbase-attestation/target/vk',
    vkFileName: 'vk',
  },
  coinbase_country_attestation: {
    basePath: 'coinbase-country-attestation/target',
    vkPath: 'coinbase-country-attestation/target/vk',
    vkFileName: 'vk',
  },
  oidc_domain_attestation: {
    basePath: 'oidc-domain-attestation/target',
    vkPath: 'oidc-domain-attestation/target/vk',
    vkFileName: 'vk',
  },
};

/**
 * Per-circuit data versions — bump individually when a circuit is recompiled.
 * Forces re-download of cached circuit files on devices.
 * Only bump the circuit that actually changed.
 */
export const CIRCUIT_DATA_VERSIONS: Record<CircuitName, number> = {
  coinbase_attestation: 1,
  coinbase_country_attestation: 1,
  oidc_domain_attestation: 3, // provider public input + MAX_PARTIAL_DATA_LENGTH 768
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
  },
  staging: {
    coinbase_attestation: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c',
    coinbase_country_attestation: '0xdEe363585926c3c28327Efd1eDd01cf4559738cf',
    oidc_domain_attestation: '0x27afdea349f247cf698f97fdfab59e1bf8bd0550',
  },
  production: {
    coinbase_attestation: '0xF7dED73E7a7fc8fb030c35c5A88D40ABe6865382',
    coinbase_country_attestation: '0xF3D5A09d2C85B28C52EF2905c1BE3a852b609D0C',
    oidc_domain_attestation: '0x9677Ba46Ad226Ce8B3C4517d9c0143e4D458BeAe',
  },
};
