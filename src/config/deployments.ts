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
  CIRCUITS_WITH_BROADCAST,
  CIRCUIT_NETWORKS,
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

/** How long a resolved tag is used without asking GitHub again. */
const RELEASE_TAG_TTL_MS = 60 * 60 * 1000;

/**
 * The release tag this device last resolved, whatever its age.
 *
 * Separate from the TTL check because the two questions are different: "is it
 * fresh enough to skip the network" and "is there a real tag here at all". The
 * second one is what keeps an offline launch working.
 */
async function readCachedReleaseTag(): Promise<{tag: string; fetchedAt: number} | null> {
  try {
    const raw = await AsyncStorage.getItem(RELEASE_TAG_CACHE_KEY);
    if (!raw) return null;
    const {tag, fetchedAt} = JSON.parse(raw);
    // A stored entry that is not a tag is not a tag. Storage can hold a
    // truncated write or a value from an older shape of this record.
    if (typeof tag !== 'string' || !tag) return null;
    return {tag, fetchedAt: typeof fetchedAt === 'number' ? fetchedAt : 0};
  } catch {
    return null;
  }
}

/**
 * The latest GitHub Release tag, or null when this device has never seen one.
 *
 * Fresh cache -> that tag. Otherwise ask GitHub; and when GitHub cannot be
 * asked — offline, timed out, HTTP 403 because the unauthenticated API allows
 * 60 calls an hour per IP and a carrier NAT shares one — fall back to the tag
 * this device resolved LAST TIME, however old it is.
 *
 * A stale tag is a real tag: it is the release the circuit files on disk
 * actually came from, so reusing it keeps an offline app working on the bytes
 * it already verified. What must never be substituted is a DIFFERENT source.
 * Returning null here is how the caller learns it has nothing.
 */
async function resolveReleaseTag(repo: string): Promise<string | null> {
  const cached = await readCachedReleaseTag();
  if (cached && Date.now() - cached.fetchedAt < RELEASE_TAG_TTL_MS) {
    return cached.tag;
  }

  const controller = new AbortController();
  // Cleared in `finally`, not after the await: when fetch REJECTS — which is
  // the offline case, the one this whole function is about — a timer left
  // running holds the process for another ten seconds and then aborts a
  // request nobody is waiting for.
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {Accept: 'application/vnd.github.v3+json'},
        signal: controller.signal,
      },
    );

    if (response.ok) {
      const release = await response.json();
      const tag = release?.tag_name;
      if (typeof tag === 'string' && tag) {
        await AsyncStorage.setItem(
          RELEASE_TAG_CACHE_KEY,
          JSON.stringify({tag, fetchedAt: Date.now()}),
        );
        return tag;
      }
    }
  } catch {
    // Falls through to the stale tag below.
  } finally {
    clearTimeout(timeoutId);
  }

  return cached?.tag ?? null;
}

/**
 * Build the broadcast JSON URL based on environment source config.
 */
async function resolveBroadcastUrl(
  circuit: CircuitName,
  env: Environment,
): Promise<string | null> {
  const config = STATIC_CONFIGS[env];
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {signal: controller.signal});
    clearTimeout(timeoutId);
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
  /*
   * Derived from BROADCAST_PATHS, never typed out here.
   *
   * `giwa_attestation` is still excluded, and deliberately: its path is `null`
   * because the PoC verifier address is pinned in FALLBACK_VERIFIERS.
   *
   * The three `mdl_kr_*` circuits were excluded too, and that was NOT
   * deliberate — nothing said so, and the comment that used to sit here
   * explained only the GIWA case. All three have had a published broadcast
   * JSON since the day they were deployed (checked 2026-09-04: every
   * `DeployMdlKr*.s.sol/84532/run-latest.json` answers 200 on circuits@main,
   * with HonkVerifier addresses equal to the pinned fallbacks), so the effect
   * was that a redeploy of any mDL verifier would never have reached a device.
   * A hand-written list is exactly the shape that goes stale when a circuit is
   * added; this one cannot.
   */
  const circuits: ReadonlyArray<CircuitName> = CIRCUITS_WITH_BROADCAST;
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
 * Where a release-pinned build reads circuit data from.
 *
 * Development and staging read `main`. Production reads the latest GitHub
 * Release tag, and when no tag can be produced it THROWS.
 *
 * It used to answer `main` in that case, and that is the shape this repository
 * bans: the download succeeds, against bytes nobody released. The failure is
 * invisible from here — the digest manifest is published beside the file at the
 * same ref, so `main`'s circuit and `main`'s digests agree — and it is
 * asymmetric: `resolveBroadcastUrl` returns null on the very same failure, so
 * the verifier ADDRESS stays at the release's while the circuit bytes come from
 * `main`. One unreachable API call was enough to pair a circuit with a verifier
 * that was never deployed for it.
 *
 * Offline is not that case: `resolveReleaseTag` reuses the last tag this device
 * saw. Throwing here means there is no tag at all — a first launch that has
 * never reached GitHub — and then there is nothing to download from.
 */
export async function resolveCircuitBaseUrl(env: Environment): Promise<string> {
  const config = STATIC_CONFIGS[env];
  const source = config.broadcastSource;

  if (source.type === 'branch') {
    // Branch mode: strip '/broadcast' suffix from baseUrl
    return source.baseUrl.replace(/\/broadcast$/, '');
  }

  const tag = await resolveReleaseTag(source.repo);
  if (!tag) {
    throw new Error(
      `No circuits release tag for the ${env} build: ` +
        `https://api.github.com/repos/${source.repo}/releases/latest could not be read ` +
        'and this device has no tag cached from an earlier launch. ' +
        'Refusing to read circuit data from main — an untagged circuit would be ' +
        "proved against the release's verifier address.",
    );
  }
  return GITHUB_RAW(tag);
}
