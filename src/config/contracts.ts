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

export type Environment = 'development' | 'production';

export type CircuitName = 'coinbase_attestation' | 'coinbase_country_attestation';

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

export interface StaticConfig {
  network: NetworkConfig;
  attestation: AttestationConfig;
  rpcUrls: {
    base: string[];
  };
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
};

/**
 * Fallback verifier addresses (used when runtime fetch fails).
 * Updated by scripts/sync-deployments.sh or manually.
 */
export const FALLBACK_VERIFIERS: Record<Environment, Record<CircuitName, string>> = {
  development: {
    coinbase_attestation: '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c',
    coinbase_country_attestation: '0xdEe363585926c3c28327Efd1eDd01cf4559738cf',
  },
  production: {
    coinbase_attestation: '',
    coinbase_country_attestation: '',
  },
};
