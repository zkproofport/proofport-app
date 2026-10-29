/**
 * Runtime deployment fetcher.
 *
 * Fetches Foundry broadcast JSON from GitHub to get deployed verifier
 * addresses. Uses AsyncStorage for offline cache.
 *
 * Which circuits ref is read, per environment (`circuitsRef`):
 *   - development / staging: branch `main` (CIRCUITS_BRANCH)
 *   - production: exactly CIRCUITS_RELEASE_TAG, fixed in this build
 *   - Laboratory circuits (MAIN_BRANCH_CIRCUIT_IDS): `main` in every build
 *
 * Nothing asks GitHub which release is "latest". Until 2026-10-27 production
 * did, so publishing a circuits tag switched every installed app's circuits
 * and verifiers at its next launch.
 *
 * Flow: broadcast URL at that ref -> fetch JSON -> AsyncStorage cache -> fallback
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BROADCAST_PATHS,
  CIRCUITS_WITH_BROADCAST,
  CIRCUIT_NETWORKS,
  CIRCUIT_DATA_VERSIONS,
  FALLBACK_VERIFIERS,
  STATIC_CONFIGS,
  GITHUB_RAW,
  CIRCUITS_BRANCH,
} from './contracts';
import {MAIN_BRANCH_CIRCUIT_IDS} from './circuitIds';
import type {CircuitName, Environment} from './contracts';

const CACHE_PREFIX = '@proofport/deployment';

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
  /** The circuits ref (branch or tag) the address was read from. */
  ref?: string;
  fetchedAt: number;
}

/**
 * A production build's pinned circuits release does not answer: the tag was
 * never published, or was cut without this file. Raised instead of falling
 * back to `main` or to another release, and shown at launch as E3007.
 */
export class CircuitsReleaseMissingError extends Error {
  readonly tag: string;
  readonly urls: string[];
  constructor(tag: string, urls: string[]) {
    super(
      `Circuits release ${tag} is not available: ${urls.join(', ')} answered HTTP 404. ` +
        `This build proves only with circuits tag ${tag} (CIRCUITS_RELEASE_TAG) -- ` +
        'publish that release, or build with the tag that exists. Not falling back to main or another release.',
    );
    this.name = 'CircuitsReleaseMissingError';
    this.tag = tag;
    this.urls = urls;
  }
}

export function isCircuitsReleaseMissingError(e: unknown): e is CircuitsReleaseMissingError {
  return e instanceof CircuitsReleaseMissingError;
}

/**
 * The circuits ref (branch or exact tag) THIS circuit is read from in `env`:
 * circuit files and verifier record alike. One answer for both, so a circuit
 * is never paired with a verifier from another ref.
 */
export function circuitsRef(circuit: CircuitName, env: Environment): string {
  if (MAIN_BRANCH_CIRCUIT_IDS.includes(circuit)) return CIRCUITS_BRANCH;
  return environmentCircuitsRef(env);
}

/** The ref for the officially supported circuits in `env`. */
export function environmentCircuitsRef(env: Environment): string {
  const config = STATIC_CONFIGS[env];
  if (!config) {
    throw new Error(`Unknown environment '${env}'. Known: ${Object.keys(STATIC_CONFIGS).join(', ')}.`);
  }
  const source = config.circuitsSource;
  return source.type === 'branch' ? source.branch : source.tag;
}

function isReleaseRef(env: Environment, ref: string): boolean {
  const source = STATIC_CONFIGS[env].circuitsSource;
  return source.type === 'release' && source.tag === ref;
}

function cacheKey(env: Environment, circuit: CircuitName): string {
  // Experimental circuit bytes and verifiers change together on main. A
  // cache from an earlier circuit must not override the current verifier.
  if (MAIN_BRANCH_CIRCUIT_IDS.includes(circuit)) {
    return `${CACHE_PREFIX}/${env}/${circuit}/v${CIRCUIT_DATA_VERSIONS[circuit]}`;
  }
  // Keyed by the ref, so an address cached by an app version pinned to another
  // circuits tag is never read back by this one.
  return `${CACHE_PREFIX}/${env}/${circuit}@${circuitsRef(circuit, env)}`;
}

/**
 * The broadcast JSON URL for this circuit at its ref, or null when the
 * circuit has no broadcast record.
 */
function resolveBroadcastUrl(circuit: CircuitName, env: Environment): string | null {
  /*
   * The CIRCUIT's chain, not the build's.
   *
   * This read `config.network.chainId` — what chain the environment is
   * nominally on — and every circuit verified on Base was fine by accident.
   * GIWA is not on Base: its verifier lives on GIWA Sepolia (91342), so
   * asking the build produced `…/8453/run-latest.json`, a path that does not
   * exist. A 404 here is silent, so the address would simply never refresh
   * and nobody would see why.
   *
   * `CIRCUIT_NETWORKS` is exhaustive over the circuit list per environment,
   * so there is no default to fall through to.
   */
  const chainId = CIRCUIT_NETWORKS[env][circuit].chainId;
  const pathFn = BROADCAST_PATHS[circuit];
  if (!pathFn) return null;
  return `${GITHUB_RAW(circuitsRef(circuit, env))}/broadcast/${pathFn(chainId)}`;
}

/**
 * Fetch the deployment address from the broadcast JSON at the circuit's ref.
 *
 * Null when the record cannot be read right now (offline, timeout, a server
 * error): the cache or the build's fallback then answers, as before. A 404 at
 * a production build's pinned release is different -- the tag is missing or
 * incomplete, which no retry fixes -- and throws CircuitsReleaseMissingError.
 */
export async function fetchDeploymentAddress(
  circuit: CircuitName,
  env: Environment,
): Promise<string | null> {
  const url = resolveBroadcastUrl(circuit, env);
  if (!url) return null;
  const ref = circuitsRef(circuit, env);

  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    response = await fetch(url, {signal: controller.signal});
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.status === 404 && isReleaseRef(env, ref)) {
    throw new CircuitsReleaseMissingError(ref, [url]);
  }

  try {
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
      ref,
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
  // A circuit with no broadcast has nothing to refresh from, so a cached
  // address can only be left over from a build that read one -- for
  // coinbase_attestation, the v1 verifier. The fallback is the answer.
  if (BROADCAST_PATHS[circuit] === null) return FALLBACK_VERIFIERS[env][circuit];
  const cached = await getCachedAddress(circuit, env);
  if (cached) return cached;
  return FALLBACK_VERIFIERS[env][circuit];
}

/**
 * Sync all deployments from GitHub. Call on app startup.
 * Returns true if any address was updated.
 */
export async function syncDeployments(env: Environment): Promise<boolean> {
  /*
   * Derived from BROADCAST_PATHS, never typed out here.
   *
   * A circuit whose path is `null` there is excluded deliberately, and the
   * reason sits beside its row. A hand-written list used to sit here and left
   * out circuits that had a published broadcast JSON all along, so a redeploy
   * of their verifiers never reached a device. A hand-written list is exactly
   * the shape that goes stale when a circuit is added; this one cannot.
   */
  const circuits: ReadonlyArray<CircuitName> = CIRCUITS_WITH_BROADCAST;
  let updated = false;

  // Every circuit is tried before a missing release is reported, so the ones
  // that do answer are still cached, and the error names every missing file.
  const results = await Promise.allSettled(
    circuits.map(async (circuit) => {
      const oldAddress = await getCachedAddress(circuit, env);
      const newAddress = await fetchDeploymentAddress(circuit, env);
      if (newAddress && newAddress !== oldAddress) {
        updated = true;
      }
    }),
  );

  const missing = results.flatMap((r) =>
    r.status === 'rejected' && isCircuitsReleaseMissingError(r.reason) ? [r.reason] : [],
  );
  if (missing.length > 0) {
    throw new CircuitsReleaseMissingError(missing[0].tag, missing.flatMap((e) => e.urls));
  }
  const other = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (other) throw other.reason;

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
 * Where the officially supported circuits' files are read from in `env`:
 * `main` for development and staging, the exact CIRCUITS_RELEASE_TAG for
 * production. No network call decides it, and there is nothing to fall back
 * to: a production build whose tag is missing fails when it downloads (404,
 * naming the tag), never by reading `main` or another release.
 */
export function resolveCircuitBaseUrl(env: Environment): string {
  return GITHUB_RAW(environmentCircuitsRef(env));
}
