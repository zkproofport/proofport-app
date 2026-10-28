import RNFS from 'react-native-fs';
import {
  isSha256Hex,
  manifestLocation,
  parseSha256Manifest,
  verifyCircuitFile,
} from './circuitIntegrity';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {environmentCircuitsRef, resolveCircuitBaseUrl} from '../config/deployments';
import {CIRCUIT_FILE_PATHS, CIRCUIT_DATA_VERSIONS, GITHUB_RAW, CIRCUITS_BRANCH, STATIC_CONFIGS} from '../config/contracts';
import type {CircuitFilePaths, CircuitName, Environment} from '../config/contracts';
import {MAIN_BRANCH_CIRCUIT_IDS} from '../config/circuitIds';
import {circuitArtifactSource, requireArtifactRef, SRS_PART_MAX_BYTES, type CircuitArtifactSource} from '../config/circuitArtifacts';
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
    // Throws, naming the constant, for an Android row whose commit is not set.
    return GITHUB_RAW(requireArtifactRef(pinned));
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

const DOWNLOAD_TIMEOUT_MS = 120000;

/**
 * One HTTP download to `destPath`. Resolves the status and the
 * `Content-Length` the server declared (0 when it declared none); never
 * deletes, checks or interprets the file -- the callers do that.
 */
async function fetchToFile(
  url: string,
  destPath: string,
  circuitName: string,
  fileName: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<{statusCode: number; declaredLength: number}> {
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
  return {statusCode: result.statusCode, declaredLength};
}

/** The reason line for a download that did not answer 200. */
function httpFailureReason(circuitName: string, fileName: string, url: string, statusCode: number, env: Environment): string {
  // A 404 at a pinned release tag is a missing or incomplete release, not a
  // network problem: say which tag, so it is not retried as one.
  // A circuit read from a pinned commit (circuitArtifacts.ts) never reads
  // the release tag, so its 404 names the commit instead.
  const artifact = circuitArtifactSource(circuitName);
  const pinned = !artifact && !MAIN_BRANCH_CIRCUIT_IDS.includes(circuitName as CircuitName) && isPinnedRelease(env);
  let reason = `Failed to download ${fileName}: HTTP ${statusCode} from ${url}`;
  if (statusCode === 404 && artifact) {
    reason += ` -- circuits ref ${artifact.ref} (src/config/circuitArtifacts.ts) does not contain this file`;
  } else if (statusCode === 404 && pinned) {
    reason += ` -- circuits release ${environmentCircuitsRef(env)} (CIRCUITS_RELEASE_TAG) is missing or does not contain this file`;
  }
  return reason;
}

async function ensureCircuitDirectory(): Promise<void> {
  const circuitDir = getCircuitDirectory();
  if (!(await RNFS.exists(circuitDir))) {
    await RNFS.mkdir(circuitDir);
  }
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

  await ensureCircuitDirectory();

  log(`Downloading ${fileName}...`);

  const {statusCode, declaredLength} = await fetchToFile(url, destPath, circuitName, fileName, onProgress);

  if (statusCode !== 200) {
    await RNFS.unlink(destPath).catch(() => {});
    throw new Error(httpFailureReason(circuitName, fileName, url, statusCode, env));
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
 * Bytes read from a part and appended to the joined file per step. RNFS
 * moves file contents through the bridge as base64, so one step holds about
 * 5.6 MB of string in JS; the whole 128 MiB file never is.
 */
export const SRS_JOIN_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * A .srs published in parts (CircuitArtifactSource.srsParts): download each
 * part, check it against SHA256SUMS, append it to `<id>.srs.joining` in
 * SRS_JOIN_CHUNK_BYTES steps, check the joined file against the
 * `<package>.srs` line, and only then move it to `<id>.srs`.
 *
 * Stricter than a single file on purpose: the manifest is REQUIRED (a part
 * has no other meaningful check -- its Content-Length says nothing about
 * whether it is the right part), every digest must actually be computed and
 * match, and anything that fails deletes every part, the half-joined file and
 * the destination, so a later launch never finds a file to trust.
 */
async function downloadSplitSrs(
  circuitName: string,
  source: CircuitArtifactSource & {srsParts: number},
  env: Environment,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  log: (msg: string) => void,
): Promise<string> {
  const joinedUrl = await getCircuitFileUrl(circuitName, 'srs', env);
  const {manifestUrl, key: joinedName} = manifestLocation(joinedUrl);
  const destPath = getCircuitFilePath(circuitName, 'srs');
  const joinPath = `${destPath}.joining`;
  const partPath = (i: number) => `${destPath}.part${i}`;
  const partCount = source.srsParts;
  if (!Number.isInteger(partCount) || partCount < 1) {
    throw new Error(`${circuitName}: srsParts is ${partCount}; it must be a positive integer (src/config/circuitArtifacts.ts).`);
  }

  await ensureCircuitDirectory();
  const removeAll = async () => {
    for (let i = 0; i < partCount; i++) await RNFS.unlink(partPath(i)).catch(() => {});
    await RNFS.unlink(joinPath).catch(() => {});
    await RNFS.unlink(destPath).catch(() => {});
  };

  try {
    const manifest = await manifestFor(manifestUrl, log);
    if (!manifest) {
      throw new Error(`No SHA256SUMS at ${manifestUrl}: a .srs published in parts is never joined unchecked`);
    }
    const digestOf = (name: string): string => {
      const d = manifest[name];
      if (!isSha256Hex(d)) throw new Error(`SHA256SUMS at ${manifestUrl} has no sha256 for ${name}`);
      return d;
    };
    const joinedDigest = digestOf(joinedName);

    log(`Downloading ${circuitName}.srs in ${partCount} parts...`);
    for (let i = 0; i < partCount; i++) {
      const partName = `${joinedName}.part${i}`;
      const expectedDigest = digestOf(partName);
      const url = `${joinedUrl}.part${i}`;
      const {statusCode, declaredLength} = await fetchToFile(url, partPath(i), circuitName, partName, onProgress);
      if (statusCode !== 200) {
        throw new Error(httpFailureReason(circuitName, partName, url, statusCode, env));
      }
      const {size} = await RNFS.stat(partPath(i));
      if (size > SRS_PART_MAX_BYTES) {
        throw new Error(`${partName} is ${size} bytes; a part is at most ${SRS_PART_MAX_BYTES}`);
      }
      const verdict = verifyCircuitFile({
        size,
        declaredLength,
        digest: await digestOrNull(partPath(i), log),
        expectedDigest,
      });
      if (!verdict.ok) throw new Error(`Downloaded ${partName} failed verification (${verdict.reason}): ${verdict.detail}`);
      if (verdict.level !== 'sha256') throw new Error(`${partName} could not be hashed; a part is joined only after its sha256 matched`);
      log(`Downloaded ${partName}: ${size} bytes (verified: sha256)`);
    }

    await RNFS.unlink(joinPath).catch(() => {});
    await RNFS.writeFile(joinPath, '', 'base64');
    let joined = 0;
    for (let i = 0; i < partCount; i++) {
      const {size} = await RNFS.stat(partPath(i));
      for (let pos = 0; pos < size; pos += SRS_JOIN_CHUNK_BYTES) {
        const length = Math.min(SRS_JOIN_CHUNK_BYTES, size - pos);
        const chunk = await RNFS.read(partPath(i), length, pos, 'base64');
        await RNFS.appendFile(joinPath, chunk, 'base64');
      }
      joined += size;
      // Freed as soon as it is in the joined file: the parts and the whole
      // never sit on the phone twice over.
      await RNFS.unlink(partPath(i));
    }

    const {size: joinedSize} = await RNFS.stat(joinPath);
    if (joinedSize !== joined) {
      throw new Error(`Joined ${circuitName}.srs is ${joinedSize} bytes; its parts held ${joined}`);
    }
    const verdict = verifyCircuitFile({size: joinedSize, digest: await digestOrNull(joinPath, log), expectedDigest: joinedDigest});
    if (!verdict.ok) throw new Error(`Joined ${circuitName}.srs failed verification (${verdict.reason}): ${verdict.detail}`);
    if (verdict.level !== 'sha256') throw new Error(`Joined ${circuitName}.srs could not be hashed; it is kept only after its sha256 matched`);

    await RNFS.unlink(destPath).catch(() => {});
    await RNFS.moveFile(joinPath, destPath);
    log(`Joined ${circuitName}.srs from ${partCount} parts: ${joinedSize} bytes (verified: sha256)`);
    return destPath;
  } catch (e) {
    await removeAll();
    throw e;
  }
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

/**
 * The parsed SHA256SUMS at `manifestUrl`, or null when there is none (a
 * remembered absence). Throws only when fetching or reading fails.
 */
async function manifestFor(manifestUrl: string, log: (m: string) => void): Promise<Record<string, string> | null> {
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
  return manifestCache.get(manifestUrl) ?? null;
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
    return (await manifestFor(manifestUrl, log))?.[publishedName] ?? null;
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

  const pinned = circuitArtifactSource(circuitName);
  if (extension === 'srs' && pinned && pinned.srsParts !== null) {
    return downloadSplitSrs(circuitName, {...pinned, srsParts: pinned.srsParts}, env, onProgress, log);
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
