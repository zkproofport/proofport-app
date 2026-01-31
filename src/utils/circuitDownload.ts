import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {resolveCircuitBaseUrl} from '../config/deployments';
import {CIRCUIT_FILE_PATHS} from '../config/contracts';
import type {CircuitFilePaths, CircuitName, Environment} from '../config/contracts';

const GITHUB_MOPRO101 = 'https://raw.githubusercontent.com/hyuki0130/mopro-101/develop/ProofPortApp/assets/circuits';

const CIRCUIT_EXTENSIONS = ['json', 'srs', 'vk'] as const;

const BUNDLED_CIRCUITS: string[] = [];

const LEGACY_CONFIGS: Record<string, CircuitFilePaths & {repoBase: string}> = {
  age_verifier: {
    repoBase: GITHUB_MOPRO101,
    basePath: '',
    vkPath: '',
    vkFileName: 'age_verifier.vk',
  },
};

interface CircuitVersionMetadata {
  baseUrl: string;
  downloadedAt: number;
}

function getCircuitFilePaths(circuitName: string): CircuitFilePaths | null {
  if (circuitName in CIRCUIT_FILE_PATHS) {
    return CIRCUIT_FILE_PATHS[circuitName as CircuitName];
  }
  return null;
}

function buildFilePath(
  baseUrl: string,
  circuitName: string,
  extension: string,
  config: CircuitFilePaths,
): string {
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

async function getCircuitFileUrl(
  circuitName: string,
  extension: string,
  env: Environment,
): Promise<string> {
  const configPath = getCircuitFilePaths(circuitName);
  if (configPath) {
    const baseUrl = await resolveCircuitBaseUrl(env);
    return buildFilePath(baseUrl, circuitName, extension, configPath);
  }

  const legacyConfig = LEGACY_CONFIGS[circuitName];
  if (legacyConfig) {
    return buildFilePath(legacyConfig.repoBase, circuitName, extension, legacyConfig);
  }

  const baseUrl = await resolveCircuitBaseUrl(env);
  return `${baseUrl}/${circuitName}/target/${circuitName}.${extension}`;
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

  const downloadResult = RNFS.downloadFile({
    fromUrl: url,
    toFile: destPath,
    progress: (res) => {
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

  const result = await downloadResult.promise;

  if (result.statusCode !== 200) {
    throw new Error(`Failed to download ${fileName}: HTTP ${result.statusCode}`);
  }

  const stat = await RNFS.stat(destPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  log(`Downloaded ${fileName}: ${sizeMB} MB`);

  return destPath;
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

  const currentBaseUrl = await resolveCircuitBaseUrl(env);
  const stored = await getStoredCircuitVersion(circuitName);

  if (!stored) return false;

  return stored.baseUrl !== currentBaseUrl;
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
    const baseUrl = await resolveCircuitBaseUrl(env);
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
