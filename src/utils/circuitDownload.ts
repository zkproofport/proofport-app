import RNFS from 'react-native-fs';
import {
  manifestLocation,
  parseSha256Manifest,
  verifyCircuitFile,
} from './circuitIntegrity';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {environmentCircuitsRef, resolveCircuitBaseUrl} from '../config/deployments';
import {CIRCUIT_FILE_PATHS, CIRCUIT_DATA_VERSIONS, GITHUB_RAW, CIRCUITS_BRANCH, STATIC_CONFIGS} from '../config/contracts';
import type {CircuitFilePaths, CircuitName, Environment} from '../config/contracts';
import {MAIN_BRANCH_CIRCUIT_IDS} from '../config/circuitIds';
import {circuitArtifactSource} from '../config/circuitArtifacts';
import {cacheNeedsInvalidation} from './cacheInvalidation';

const GITHUB_MOPRO101 = 'https://raw.githubusercontent.com/hyuki0130/mopro-101/develop/ProofportApp/assets/circuits';

const CIRCUIT_EXTENSIONS = ['json', 'srs', 'vk'] as const;

const BUNDLED_CIRCUITS: string[] = [];

const LEGACY_CONFIGS: Record<string, CircuitFilePaths & {repoBase: string}> = {
};

interface CircuitVersionMetadata {
  baseUrl: string;
  downloadedAt: number;
  dataVersion?: number;
}

/** Where a circuit's files sit in the circuits repo, and their name there. */
type RemoteFilePaths = CircuitFilePaths & {remoteFileName: string};

function getCircuitFilePaths(circuitName: string): RemoteFilePaths | null {
  // A circuit read from a pinned commit (src/config/circuitArtifacts.ts) is
  // stored on the phone under its own id, but its files carry the name they
  // have on the circuits branch -- see also circuitBaseUrl.
  const pinned = circuitArtifactSource(circuitName);
  if (pinned) {
    return {basePath: pinned.basePath, vkPath: pinned.vkPath, vkFileName: pinned.vkFileName, remoteFileName: pinned.remoteFileName};
  }
  if (Object.prototype.hasOwnProperty.call(CIRCUIT_FILE_PATHS, circuitName)) {
    const paths = CIRCUIT_FILE_PATHS[circuitName as CircuitName];
    return paths ? {...paths, remoteFileName: circuitName} : null;
  }
  return null;
}

function buildFilePath(
  baseUrl: string,
  extension: string,
  config: RemoteFilePaths,
): string {
  const circuitName = config.remoteFileName;
  if (extension === 'vk') {
    const path = config.vkPath ? `${config.vkPath}/${config.vkFileName}` : config.vkFileName;
    return `${baseUrl}/${path}`;
  }
  const path = config.basePath
    ? `${config.basePath}/${circuitName}.${extension}`
    : `${circuitName}.${extension}`;
  return `${baseUrl}/${path}`;
}

function getBundledAssetPath(circuitName: string, extension: string): string {
  const Platform = require('react-native').Platform;
  if (Platform.OS === 'ios') {
    return `${RNFS.MainBundlePath}/${circuitName}.${extension}`;
  }
  return `${RNFS.MainBundlePath}/assets/circuits/${circuitName}.${extension}`;
}

export interface DownloadProgress {
  circuitName: string;
  fileName: string;
  bytesWritten: number;
  contentLength: number;
  percent: number;
}

export interface CircuitDownloadResult {
  circuitPath: string;
  srsPath: string;
  vkPath: string;
}

export function getCircuitDirectory(): string {
  return `${RNFS.DocumentDirectoryPath}/circuits`;
}

export function getCircuitFilePath(circuitName: string, extension: string): string {
  return `${getCircuitDirectory()}/${circuitName}.${extension}`;
}

export async function circuitFileExists(
  circuitName: string,
  extension: string,
): Promise<boolean> {
  const filePath = getCircuitFilePath(circuitName, extension);
  return RNFS.exists(filePath);
}

export async function allCircuitFilesExist(circuitName: string): Promise<boolean> {
  for (const ext of CIRCUIT_EXTENSIONS) {
    const exists = await circuitFileExists(circuitName, ext);
    if (!exists) {
      return false;
    }
  }
  return true;
}

export async function getCircuitFileSizes(
  circuitName: string,
): Promise<{json: number; srs: number; vk: number}> {
  const sizes = {json: 0, srs: 0, vk: 0};

  for (const ext of CIRCUIT_EXTENSIONS) {
    const filePath = getCircuitFilePath(circuitName, ext);
    try {
      if (await RNFS.exists(filePath)) {
        const stat = await RNFS.stat(filePath);
        sizes[ext] = stat.size;
      }
    } catch {}
  }

  return sizes;
}

async function copyBundledCircuitFile(
  circuitName: string,
  extension: string,
  env: Environment,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;
  const fileName = `${circuitName}.${extension}`;
  const sourcePath = getBundledAssetPath(circuitName, extension);
  const destPath = getCircuitFilePath(circuitName, extension);

  const circuitDir = getCircuitDirectory();
  if (!(await RNFS.exists(circuitDir))) {
    await RNFS.mkdir(circuitDir);
  }

  const sourceExists = await RNFS.exists(sourcePath);

  if (sourceExists) {
    log(`Copying bundled ${fileName}...`);

    await RNFS.copyFile(sourcePath, destPath);

    const stat = await RNFS.stat(destPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    log(`Copied ${fileName}: ${sizeMB} MB`);

    if (onProgress) {
      onProgress({
        circuitName,
        fileName,
        bytesWritten: stat.size,
        contentLength: stat.size,
        percent: 100,
      });
    }

    return destPath;
  }

  log(`Bundle file not found at ${sourcePath}, downloading instead...`);
  return downloadCircuitFileFromGitHub(circuitName, extension, env, onProgress, log);
}

function isPinnedRelease(env: Environment): boolean {
  return STATIC_CONFIGS[env].circuitsSource.type === 'release';
}

/**
 * Which ref THIS circuit reads from. One answer, three readers.
 *
 * Circuits that are not officially supported -- the experimental and planned
 * ones (GIWA, the three Korea mDL predicates) -- exist only on main, never in
 * a release tag, so they are always fetched from main regardless of
 * environment. Asking for the derived list rather than naming them is what
 * stops the next circuit from being forgotten here; one experimental circuit
 * was, for exactly as long as it sat in neither of two lists.
 *
 * The download URL, the cache-staleness check and the metadata written beside
 * the files each used to work this out on their own, and only the first one
 * knew about the main-only circuits. The other two asked for the ENVIRONMENT's
 * base URL, so on a production build they recorded and compared a release tag
 * for files that had come from main — a stored value that was simply untrue.
 *
 * The stored base URL carries the ref, so a build pinned to another circuits
 * tag than the one the files came from re-downloads them (cacheInvalidation).
 */
export async function circuitBaseUrl(
  circuitName: string,
  env: Environment,
): Promise<string> {
  const pinned = circuitArtifactSource(circuitName);
  if (pinned) {
    return GITHUB_RAW(pinned.ref);
  }
  if (MAIN_BRANCH_CIRCUIT_IDS.includes(circuitName as CircuitName)) {
    return GITHUB_RAW(CIRCUITS_BRANCH);
  }
  return resolveCircuitBaseUrl(env);
}

/**
 * The cache version a circuit's downloaded files must carry. An id with no
 * entry is an error, never version 0: a 0 would match an old cache that was
 * also written with the fallback, so the files would never be refreshed.
 */
export function circuitDataVersion(circuitName: string): number {
  const pinned = circuitArtifactSource(circuitName);
  if (pinned) return pinned.dataVersion;
  const version = CIRCUIT_DATA_VERSIONS[circuitName as CircuitName];
  if (version === undefined) {
    throw new Error(
      `No CIRCUIT_DATA_VERSIONS entry for circuit '${circuitName}'. Known: ${Object.keys(CIRCUIT_DATA_VERSIONS).join(', ')}.`,
    );
  }
  return version;
}

async function getCircuitFileUrl(
  circuitName: string,
  extension: string,
  env: Environment,
): Promise<string> {
  const configPath = getCircuitFilePaths(circuitName);
  if (configPath) {
    const baseUrl = await circuitBaseUrl(circuitName, env);
    return buildFilePath(baseUrl, extension, configPath);
  }

  const legacyConfig = Object.prototype.hasOwnProperty.call(LEGACY_CONFIGS, circuitName)
    ? LEGACY_CONFIGS[circuitName]
    : undefined;
  if (legacyConfig) {
    return buildFilePath(legacyConfig.repoBase, extension, {...legacyConfig, remoteFileName: circuitName});
  }

  // No row anywhere: an error, not a guessed `<id>/target/<id>.<ext>` path,
  // which would download whatever happens to sit there under another name.
  throw new Error(
    `No file paths for circuit '${circuitName}'. Known: ${Object.keys(CIRCUIT_FILE_PATHS).join(', ')} and the pinned sources in src/config/circuitArtifacts.ts.`,
  );
}

async function downloadCircuitFileFromGitHub(
  circuitName: string,
  extension: string,
  env: Environment,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;
  const fileName = `${circuitName}.${extension}`;
  const url = await getCircuitFileUrl(circuitName, extension, env);
  const destPath = getCircuitFilePath(circuitName, extension);

  const circuitDir = getCircuitDirectory();
  if (!(await RNFS.exists(circuitDir))) {
    await RNFS.mkdir(circuitDir);
  }

  log(`Downloading ${fileName}...`);

  const DOWNLOAD_TIMEOUT_MS = 120000;

  /*
   * `Content-Length`, captured from the progress callback because that is the
   * only place RNFS exposes it — `DownloadResult` carries `statusCode` and
   * `bytesWritten` and no headers at all. Chunked responses report 0 here, and
   * `verifyCircuitFile` treats that as "nothing to compare against" rather than
   * as a zero-length file.
   */
  let declaredLength = 0;

  const downloadResult = RNFS.downloadFile({
    fromUrl: url,
    toFile: destPath,
    connectionTimeout: 10000,
    readTimeout: 30000,
    progress: (res) => {
      if (res.contentLength > declaredLength) declaredLength = res.contentLength;
      const percent = res.contentLength > 0
        ? Math.round((res.bytesWritten / res.contentLength) * 100)
        : 0;

      if (onProgress) {
        onProgress({
          circuitName,
          fileName,
          bytesWritten: res.bytesWritten,
          contentLength: res.contentLength,
          percent,
        });
      }
    },
    progressDivider: 5,
  });

  // Cleared once the race settles: left running, it stopped an already
  // finished job two minutes later and held a test process open as long.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      RNFS.stopDownload(downloadResult.jobId);
      reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s: ${fileName}`));
    }, DOWNLOAD_TIMEOUT_MS);
  });

  let result: Awaited<typeof downloadResult.promise>;
  try {
    result = await Promise.race([downloadResult.promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  if (result.statusCode !== 200) {
    await RNFS.unlink(destPath).catch(() => {});
    // A 404 at a pinned release tag is a missing or incomplete release, not a
    // network problem: say which tag, so it is not retried as one.
    // A circuit read from a pinned commit (circuitArtifacts.ts) never reads
    // the release tag, so its 404 names the commit instead.
    const artifact = circuitArtifactSource(circuitName);
    const pinned = !artifact && !MAIN_BRANCH_CIRCUIT_IDS.includes(circuitName as CircuitName) && isPinnedRelease(env);
    let reason = `Failed to download ${fileName}: HTTP ${result.statusCode} from ${url}`;
    if (result.statusCode === 404 && artifact) {
      reason += ` -- circuits ref ${artifact.ref} (src/config/circuitArtifacts.ts) does not contain this file`;
    } else if (result.statusCode === 404 && pinned) {
      reason += ` -- circuits release ${environmentCircuitsRef(env)} (CIRCUITS_RELEASE_TAG) is missing or does not contain this file`;
    }
    throw new Error(reason);
  }

  const stat = await RNFS.stat(destPath);

  /*
   * VERIFY, AND DELETE WHAT DOES NOT VERIFY.
   *
   * HTTP 200 says the request was understood. It does not say the body arrived.
   * A connection that drops after the headers leaves a 200, a partial file and
   * no error — and until this block existed the partial file STAYED, because
   * `allCircuitFilesExist` asks only whether the path exists. Every later launch
   * saw three files, skipped the download, and handed truncated bytes to the
   * prover; the person got a proof failure that pointed nowhere.
   *
   * Deleting is the part that matters. A thrown error alone would leave the bad
   * file behind for the next launch to trust, so the download would never be
   * retried and the failure would be permanent.
   */
  const verdict = verifyCircuitFile({
    size: stat.size,
    declaredLength: declaredLength ?? null,
    digest: await digestOrNull(destPath, log),
    expectedDigest: await expectedDigestFor(circuitName, extension, env, log),
  });

  if (!verdict.ok) {
    await RNFS.unlink(destPath).catch(() => {});
    throw new Error(
      `Downloaded ${fileName} failed verification (${verdict.reason}): ${verdict.detail}`,
    );
  }

  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  log(`Downloaded ${fileName}: ${sizeMB} MB (verified: ${verdict.level})`);

  return destPath;
}

/**
 * The file's sha256, or null when it could not be computed.
 *
 * Hashing a 100MB srs can fail on a device that is short of memory, and that is
 * a reason to fall back to the length check — not a reason to reject a file
 * that may be perfectly good. `verifyCircuitFile` handles the null.
 */
async function digestOrNull(path: string, log: (m: string) => void): Promise<string | null> {
  try {
    const h = await RNFS.hash(path, 'sha256');
    return typeof h === 'string' ? h.toLowerCase() : null;
  } catch (e) {
    log(`Could not hash ${path}: ${String(e)}`);
    return null;
  }
}

/*
 * The published digests for one base URL, fetched once per launch.
 *
 * Keyed by URL rather than by circuit because the manifest covers every file at
 * that tag — and because the dev-only circuits deliberately read from `main`
 * while the rest read from a release tag, so two manifests can be live at once.
 *
 * `null` is a REMEMBERED ABSENCE: a release cut before the manifest existed has
 * no such file, and re-requesting a 404 for every one of the three downloads is
 * three round trips to learn the same thing.
 */
const manifestCache = new Map<string, Record<string, string> | null>();

/** Test seam. A module-level cache outlives a test file otherwise. */
export function __resetCircuitManifestCache(): void {
  manifestCache.clear();
}

async function expectedDigestFor(
  circuitName: string,
  extension: string,
  env: Environment,
  log: (m: string) => void,
): Promise<string | null> {
  try {
    const fileUrl = await getCircuitFileUrl(circuitName, extension, env);
    const { manifestUrl, key: publishedName } = manifestLocation(fileUrl);

    if (!manifestCache.has(manifestUrl)) {
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        /*
         * Not an error. Tags cut before the manifest existed must stay
         * installable — and the verdict still says `length` rather than
         * pretending a digest was checked.
         */
        log(`No SHA256SUMS at ${manifestUrl} (HTTP ${res.status}); falling back to length`);
        manifestCache.set(manifestUrl, null);
      } else {
        manifestCache.set(manifestUrl, parseSha256Manifest(await res.text()));
      }
    }

    return manifestCache.get(manifestUrl)?.[publishedName] ?? null;
  } catch (e) {
    log(`Could not read the circuit manifest: ${String(e)}`);
    return null;
  }
}

export async function downloadCircuitFile(
  circuitName: string,
  extension: string,
  env: Environment,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;

  if (BUNDLED_CIRCUITS.includes(circuitName)) {
    return copyBundledCircuitFile(circuitName, extension, env, onProgress, log);
  }

  return downloadCircuitFileFromGitHub(circuitName, extension, env, onProgress, log);
}

async function getStoredCircuitVersion(circuitName: string): Promise<CircuitVersionMetadata | null> {
  try {
    const key = `@proofport/circuit-version/${circuitName}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function storeCircuitVersion(circuitName: string, baseUrl: string): Promise<void> {
  try {
    const key = `@proofport/circuit-version/${circuitName}`;
    const metadata: CircuitVersionMetadata = {
      baseUrl,
      downloadedAt: Date.now(),
      dataVersion: circuitDataVersion(circuitName),
    };
    await AsyncStorage.setItem(key, JSON.stringify(metadata));
  } catch {}
}

async function shouldInvalidateCache(
  circuitName: string,
  env: Environment,
): Promise<boolean> {
  const configPath = getCircuitFilePaths(circuitName);
  if (!configPath) return false;

  const stored = await getStoredCircuitVersion(circuitName);
  const expectedVersion = circuitDataVersion(circuitName);
  const currentBaseUrl = await circuitBaseUrl(circuitName, env);
  // hasCachedFiles only matters when there is no stored metadata, so skip the
  // extra disk hit otherwise.
  const hasCachedFiles = stored ? false : await allCircuitFilesExist(circuitName);

  return cacheNeedsInvalidation({
    stored,
    expectedVersion,
    currentBaseUrl,
    hasCachedFiles,
  });
}

export async function downloadCircuitFiles(
  circuitName: string,
  env: Environment,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<CircuitDownloadResult> {
  const log = addLog || console.log;

  log(`=== Downloading circuit files for ${circuitName} ===`);

  const needsInvalidation = await shouldInvalidateCache(circuitName, env);
  if (needsInvalidation) {
    log(`Circuit version changed, invalidating cache...`);
    await deleteCircuitFiles(circuitName, log);
  }

  const paths: CircuitDownloadResult = {
    circuitPath: '',
    srsPath: '',
    vkPath: '',
  };

  for (const ext of CIRCUIT_EXTENSIONS) {
    const exists = await circuitFileExists(circuitName, ext);
    let filePath: string;

    if (exists && !needsInvalidation) {
      filePath = getCircuitFilePath(circuitName, ext);
      log(`${circuitName}.${ext} already exists`);
    } else {
      filePath = await downloadCircuitFile(circuitName, ext, env, onProgress, log);
    }

    if (ext === 'json') paths.circuitPath = filePath;
    else if (ext === 'srs') paths.srsPath = filePath;
    else if (ext === 'vk') paths.vkPath = filePath;
  }

  const configPath = getCircuitFilePaths(circuitName);
  if (configPath) {
    // The ref the files ACTUALLY came from, so the next launch compares like
    // with like.
    const baseUrl = await circuitBaseUrl(circuitName, env);
    await storeCircuitVersion(circuitName, baseUrl);
  }

  log(`=== Circuit files ready ===`);
  return paths;
}

export async function deleteCircuitFiles(
  circuitName: string,
  addLog?: (msg: string) => void,
): Promise<void> {
  const log = addLog || console.log;

  for (const ext of CIRCUIT_EXTENSIONS) {
    const filePath = getCircuitFilePath(circuitName, ext);
    try {
      if (await RNFS.exists(filePath)) {
        await RNFS.unlink(filePath);
        log(`Deleted ${circuitName}.${ext}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Failed to delete ${circuitName}.${ext}: ${errorMsg}`);
    }
  }
}

export async function deleteAllCircuitFiles(
  addLog?: (msg: string) => void,
): Promise<void> {
  const log = addLog || console.log;
  const circuitDir = getCircuitDirectory();

  try {
    if (await RNFS.exists(circuitDir)) {
      await RNFS.unlink(circuitDir);
      log('Deleted all circuit files');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to delete circuit directory: ${errorMsg}`);
  }
}

export async function getDownloadedCircuitsSize(): Promise<{
  files: number;
  bytes: number;
  sizeMB: string;
}> {
  const circuitDir = getCircuitDirectory();
  let totalFiles = 0;
  let totalBytes = 0;

  try {
    if (await RNFS.exists(circuitDir)) {
      const files = await RNFS.readDir(circuitDir);
      for (const file of files) {
        if (file.isFile()) {
          totalFiles++;
          totalBytes += file.size;
        }
      }
    }
  } catch {}

  return {
    files: totalFiles,
    bytes: totalBytes,
    sizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
  };
}
