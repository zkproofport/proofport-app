/**
 * Runtime deployment fetcher.
 *
 * Fetches Foundry broadcast JSON from GitHub to get the latest
 * deployed contract addresses. Uses AsyncStorage for offline cache.
 *
 * Resolution strategy per environment:
 *   - development: fetch from main branch (latest deployments, immediate)
 *   - production:  fetch from latest GitHub Release tag (verified only)
 *
 * Flow: resolve broadcast URL → fetch JSON → AsyncStorage cache → fallback
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BROADCAST_PATHS,
  FALLBACK_VERIFIERS,
  STATIC_CONFIGS,
  GITHUB_RAW,
} from './contracts';
import type {CircuitName, Environment} from './contracts';

const CACHE_PREFIX = '@proofport/deployment';
const RELEASE_TAG_CACHE_KEY = `${CACHE_PREFIX}/release-tag`;

interface BroadcastTransaction {
  contractName: string;
  contractAddress: string;
}

interface BroadcastJson {
  transactions: BroadcastTransaction[];
  timestamp: number;
  chain: number;
  commit: string;
  libraries: string[];
}

interface CachedDeployment {
  address: string;
  timestamp: number;
  chain: number;
  commit: string;
  releaseTag?: string;
  fetchedAt: number;
}

function cacheKey(env: Environment, circuit: CircuitName): string {
  return `${CACHE_PREFIX}/${env}/${circuit}`;
}

/**
 * Resolve the latest GitHub Release tag for production.
 * Caches the tag for 1 hour to avoid excessive API calls.
 */
async function resolveReleaseTag(repo: string): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(RELEASE_TAG_CACHE_KEY);
    if (cached) {
      const {tag, fetchedAt} = JSON.parse(cached);
      const oneHour = 60 * 60 * 1000;
      if (Date.now() - fetchedAt < oneHour) {
        return tag;
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {headers: {Accept: 'application/vnd.github.v3+json'}},
    );
    if (!response.ok) return null;

    const release = await response.json();
    const tag = release.tag_name;
    if (!tag) return null;

    await AsyncStorage.setItem(
      RELEASE_TAG_CACHE_KEY,
      JSON.stringify({tag, fetchedAt: Date.now()}),
    );
    return tag;
  } catch {
    return null;
  }
}

/**
 * Build the broadcast JSON URL based on environment source config.
 */
async function resolveBroadcastUrl(
  circuit: CircuitName,
  env: Environment,
): Promise<string | null> {
  const config = STATIC_CONFIGS[env];
  const chainId = config.network.chainId;
  const pathFn = BROADCAST_PATHS[circuit];
  if (!pathFn) return null;

  const source = config.broadcastSource;

  if (source.type === 'branch') {
    return `${source.baseUrl}/${pathFn(chainId)}`;
  }

  // Release mode: resolve tag first
  const tag = await resolveReleaseTag(source.repo);
  if (!tag) return null;
  return `${GITHUB_RAW(tag)}/broadcast/${pathFn(chainId)}`;
}

/**
 * Fetch the latest deployment address from GitHub broadcast JSON.
 */
export async function fetchDeploymentAddress(
  circuit: CircuitName,
  env: Environment,
): Promise<string | null> {
  const url = await resolveBroadcastUrl(circuit, env);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const broadcast: BroadcastJson = await response.json();
    const tx = broadcast.transactions.find(
      (t) => t.contractName === 'HonkVerifier',
    );

    if (!tx?.contractAddress) return null;

    const cached: CachedDeployment = {
      address: tx.contractAddress,
      timestamp: broadcast.timestamp,
      chain: broadcast.chain,
      commit: broadcast.commit,
      fetchedAt: Date.now(),
    };

    await AsyncStorage.setItem(cacheKey(env, circuit), JSON.stringify(cached));
    return tx.contractAddress;
  } catch {
    return null;
  }
}

/**
 * Get cached deployment address from AsyncStorage.
 */
async function getCachedAddress(
  circuit: CircuitName,
  env: Environment,
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(env, circuit));
    if (!raw) return null;
    const cached: CachedDeployment = JSON.parse(raw);
    return cached.address || null;
  } catch {
    return null;
  }
}

/**
 * Get the verifier address with fallback chain:
 *   1. AsyncStorage cache (from previous runtime fetch)
 *   2. Fallback constant (build-time)
 *
 * Call syncDeployments() on app start to update the cache.
 */
export async function getVerifierAddress(
  circuit: CircuitName,
  env: Environment,
): Promise<string> {
  const cached = await getCachedAddress(circuit, env);
  if (cached) return cached;
  return FALLBACK_VERIFIERS[env][circuit];
}

/**
 * Sync all deployments from GitHub. Call on app startup.
 * Returns true if any address was updated.
 */
export async function syncDeployments(env: Environment): Promise<boolean> {
  const circuits: CircuitName[] = [
    'coinbase_attestation',
    'coinbase_country_attestation',
  ];
  let updated = false;

  await Promise.all(
    circuits.map(async (circuit) => {
      const oldAddress = await getCachedAddress(circuit, env);
      const newAddress = await fetchDeploymentAddress(circuit, env);
      if (newAddress && newAddress !== oldAddress) {
        updated = true;
      }
    }),
  );

  return updated;
}

/**
 * Get cached deployment metadata (for display/debug).
 */
export async function getDeploymentInfo(
  circuit: CircuitName,
  env: Environment,
): Promise<CachedDeployment | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(env, circuit));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the base URL for circuit file downloads based on environment.
 * Development: raw GitHub URL from main branch.
 * Production: raw GitHub URL from latest release tag (falls back to main).
 */
export async function resolveCircuitBaseUrl(env: Environment): Promise<string> {
  const config = STATIC_CONFIGS[env];
  const source = config.broadcastSource;

  if (source.type === 'branch') {
    // Branch mode: strip '/broadcast' suffix from baseUrl
    return source.baseUrl.replace(/\/broadcast$/, '');
  }

  // Release mode: resolve tag first
  const tag = await resolveReleaseTag(source.repo);
  if (!tag) return GITHUB_RAW('main');
  return GITHUB_RAW(tag);
}
