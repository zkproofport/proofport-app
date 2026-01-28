import RNFS from 'react-native-fs';

// GitHub raw URL bases
const GITHUB_ZKPROOFPORT = 'https://raw.githubusercontent.com/zkproofport/circuits/main';
const GITHUB_MOPRO101 = 'https://raw.githubusercontent.com/hyuki0130/mopro-101/develop/ProofPortApp/assets/circuits';

// Circuit configurations with their repo and paths
const CIRCUIT_CONFIGS: Record<string, {
  repoBase: string;
  basePath: string;
  vkPath: string;
  vkFileName: string; // 'vk' for no extension, '{name}.vk' for extension
}> = {
  age_verifier: {
    repoBase: GITHUB_MOPRO101,
    basePath: '',
    vkPath: '',
    vkFileName: 'age_verifier.vk',
  },
  coinbase_attestation: {
    repoBase: GITHUB_ZKPROOFPORT,
    basePath: 'coinbase-attestation/target',
    vkPath: 'coinbase-attestation/target/vk',
    vkFileName: 'vk', // no extension
  },
};

// Circuit file extensions
const CIRCUIT_EXTENSIONS = ['json', 'srs', 'vk'] as const;

// No bundled circuits - all downloaded from GitHub
const BUNDLED_CIRCUITS: string[] = [];

/**
 * Get the bundled asset path for a circuit file
 * iOS: Resources are copied directly to MainBundlePath
 * Android: Resources are in assets/circuits/ subdirectory
 */
const getBundledAssetPath = (circuitName: string, extension: string): string => {
  const Platform = require('react-native').Platform;
  if (Platform.OS === 'ios') {
    return `${RNFS.MainBundlePath}/${circuitName}.${extension}`;
  } else {
    return `${RNFS.MainBundlePath}/assets/circuits/${circuitName}.${extension}`;
  }
};

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

/**
 * Get the local directory for storing downloaded circuit files
 */
export const getCircuitDirectory = (): string => {
  return `${RNFS.DocumentDirectoryPath}/circuits`;
};

/**
 * Get the local path for a specific circuit file
 */
export const getCircuitFilePath = (circuitName: string, extension: string): string => {
  return `${getCircuitDirectory()}/${circuitName}.${extension}`;
};

/**
 * Check if a circuit file exists locally
 */
export const circuitFileExists = async (
  circuitName: string,
  extension: string,
): Promise<boolean> => {
  const filePath = getCircuitFilePath(circuitName, extension);
  return RNFS.exists(filePath);
};

/**
 * Check if all circuit files exist locally
 */
export const allCircuitFilesExist = async (circuitName: string): Promise<boolean> => {
  for (const ext of CIRCUIT_EXTENSIONS) {
    const exists = await circuitFileExists(circuitName, ext);
    if (!exists) {
      return false;
    }
  }
  return true;
};

/**
 * Get file sizes for a circuit (returns 0 if file doesn't exist)
 */
export const getCircuitFileSizes = async (
  circuitName: string,
): Promise<{json: number; srs: number; vk: number}> => {
  const sizes = {json: 0, srs: 0, vk: 0};

  for (const ext of CIRCUIT_EXTENSIONS) {
    const filePath = getCircuitFilePath(circuitName, ext);
    try {
      if (await RNFS.exists(filePath)) {
        const stat = await RNFS.stat(filePath);
        sizes[ext] = stat.size;
      }
    } catch {
      // Ignore errors
    }
  }

  return sizes;
};

/**
 * Copy a bundled circuit file from app assets to DocumentDirectory
 * Falls back to download if bundle file is not available
 */
const copyBundledCircuitFile = async (
  circuitName: string,
  extension: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> => {
  const log = addLog || console.log;
  const fileName = `${circuitName}.${extension}`;
  const sourcePath = getBundledAssetPath(circuitName, extension);
  const destPath = getCircuitFilePath(circuitName, extension);

  // Ensure directory exists
  const circuitDir = getCircuitDirectory();
  if (!(await RNFS.exists(circuitDir))) {
    await RNFS.mkdir(circuitDir);
  }

  // Check if source exists in bundle
  const sourceExists = await RNFS.exists(sourcePath);

  if (sourceExists) {
    log(`Copying bundled ${fileName}...`);

    // Copy file
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
  } else {
    // Fallback to download if bundle file not available
    log(`Bundle file not found at ${sourcePath}, downloading instead...`);
    return downloadCircuitFileFromGitHub(circuitName, extension, onProgress, log);
  }
};

/**
 * Get the GitHub URL for a circuit file based on circuit config
 */
const getCircuitFileUrl = (circuitName: string, extension: string): string => {
  const config = CIRCUIT_CONFIGS[circuitName];

  if (!config) {
    // Fallback for unknown circuits - use zkproofport repo
    return `${GITHUB_ZKPROOFPORT}/${circuitName}/target/${circuitName}.${extension}`;
  }

  const { repoBase, basePath, vkPath, vkFileName } = config;

  if (extension === 'vk') {
    // Use vkPath and vkFileName for verification key
    const path = vkPath ? `${vkPath}/${vkFileName}` : vkFileName;
    return `${repoBase}/${path}`;
  }

  // For json and srs files
  const path = basePath ? `${basePath}/${circuitName}.${extension}` : `${circuitName}.${extension}`;
  return `${repoBase}/${path}`;
};

/**
 * Download a single circuit file from GitHub (internal function)
 */
const downloadCircuitFileFromGitHub = async (
  circuitName: string,
  extension: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> => {
  const log = addLog || console.log;
  const fileName = `${circuitName}.${extension}`;
  const url = getCircuitFileUrl(circuitName, extension);
  const destPath = getCircuitFilePath(circuitName, extension);

  // Ensure directory exists
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
};

/**
 * Download a single circuit file (tries bundle first, then downloads)
 */
export const downloadCircuitFile = async (
  circuitName: string,
  extension: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> => {
  const log = addLog || console.log;

  // If circuit is bundled, try to copy from assets first
  if (BUNDLED_CIRCUITS.includes(circuitName)) {
    return copyBundledCircuitFile(circuitName, extension, onProgress, log);
  }

  // Otherwise download from GitHub
  return downloadCircuitFileFromGitHub(circuitName, extension, onProgress, log);
};

/**
 * Download all circuit files (json, srs, vk)
 */
export const downloadCircuitFiles = async (
  circuitName: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<CircuitDownloadResult> => {
  const log = addLog || console.log;

  log(`=== Downloading circuit files for ${circuitName} ===`);

  const paths: CircuitDownloadResult = {
    circuitPath: '',
    srsPath: '',
    vkPath: '',
  };

  for (const ext of CIRCUIT_EXTENSIONS) {
    const exists = await circuitFileExists(circuitName, ext);
    if (exists) {
      const filePath = getCircuitFilePath(circuitName, ext);
      log(`${circuitName}.${ext} already exists`);

      if (ext === 'json') paths.circuitPath = filePath;
      else if (ext === 'srs') paths.srsPath = filePath;
      else if (ext === 'vk') paths.vkPath = filePath;
    } else {
      const filePath = await downloadCircuitFile(circuitName, ext, onProgress, log);

      if (ext === 'json') paths.circuitPath = filePath;
      else if (ext === 'srs') paths.srsPath = filePath;
      else if (ext === 'vk') paths.vkPath = filePath;
    }
  }

  log(`=== Circuit files ready ===`);
  return paths;
};

/**
 * Delete all downloaded circuit files for a specific circuit
 */
export const deleteCircuitFiles = async (
  circuitName: string,
  addLog?: (msg: string) => void,
): Promise<void> => {
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
};

/**
 * Delete all downloaded circuit files
 */
export const deleteAllCircuitFiles = async (
  addLog?: (msg: string) => void,
): Promise<void> => {
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
};

/**
 * Get total size of downloaded circuit files
 */
export const getDownloadedCircuitsSize = async (): Promise<{
  files: number;
  bytes: number;
  sizeMB: string;
}> => {
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
  } catch {
    // Ignore errors
  }

  return {
    files: totalFiles,
    bytes: totalBytes,
    sizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
  };
};
