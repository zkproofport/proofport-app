/**
 * Pure decision logic for on-device circuit cache invalidation.
 *
 * Kept dependency-free (no react-native / RNFS / AsyncStorage imports) so it
 * can be unit-tested in isolation. circuitDownload.ts gathers the IO (stored
 * metadata, current base URL, whether files are on disk) and delegates the
 * decision here.
 */

export interface StoredCircuitVersion {
  baseUrl: string;
  downloadedAt: number;
  dataVersion?: number;
}

export interface CacheInvalidationInput {
  /** Version metadata previously persisted for this circuit, or null. */
  stored: StoredCircuitVersion | null;
  /** Version the running build expects (CIRCUIT_DATA_VERSIONS[circuit]). */
  expectedVersion: number;
  /** Base URL the running build would download from now. */
  currentBaseUrl: string;
  /**
   * Whether circuit files are already on disk. Only consulted when there is
   * no stored metadata — an unknown-version cached file cannot be trusted.
   */
  hasCachedFiles: boolean;
}

/**
 * Returns true when the on-device cache for a circuit is stale and must be
 * deleted + re-downloaded.
 *
 * Rules (in order):
 *   1. No metadata + files on disk  -> invalidate (legacy/unknown version).
 *   2. No metadata + no files       -> nothing to invalidate.
 *   3. Stored data version differs from expected -> invalidate (recompiled).
 *   4. Stored base URL differs from current      -> invalidate (source moved).
 */
export function cacheNeedsInvalidation(input: CacheInvalidationInput): boolean {
  const {stored, expectedVersion, currentBaseUrl, hasCachedFiles} = input;

  if (!stored) {
    return hasCachedFiles;
  }

  if ((stored.dataVersion ?? 0) !== expectedVersion) {
    return true;
  }

  return stored.baseUrl !== currentBaseUrl;
}
