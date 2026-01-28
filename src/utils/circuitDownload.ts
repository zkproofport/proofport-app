import RNFS from 'react-native-fs';

const GITHUB_ZKPROOFPORT = 'https://raw.githubusercontent.com/zkproofport/circuits/main';
const GITHUB_MOPRO101 = 'https://raw.githubusercontent.com/hyuki0130/mopro-101/develop/ProofPortApp/assets/circuits';

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

const CIRCUIT_EXTENSIONS = ['json', 'srs', 'vk'] as const;

const BUNDLED_CIRCUITS: string[] = [];

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
    } catch {
      // Ignore errors
    }
  }

  return sizes;
}

async function copyBundledCircuitFile(
  circuitName: string,
  extension: string,
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
  }

  log(`Bundle file not found at ${sourcePath}, downloading instead...`);
  return downloadCircuitFileFromGitHub(circuitName, extension, onProgress, log);
}

function getCircuitFileUrl(circuitName: string, extension: string): string {
  const config = CIRCUIT_CONFIGS[circuitName];

  if (!config) {
    // Fallback for unknown circuits - use zkproofport repo
    return `${GITHUB_ZKPROOFPORT}/${circuitName}/target/${circuitName}.${extension}`;
  }

  const { repoBase, basePath, vkPath, vkFileName } = config;

  if (extension === 'vk') {
    const path = vkPath ? `${vkPath}/${vkFileName}` : vkFileName;
    return `${repoBase}/${path}`;
  }

  const path = basePath ? `${basePath}/${circuitName}.${extension}` : `${circuitName}.${extension}`;
  return `${repoBase}/${path}`;
}

async function downloadCircuitFileFromGitHub(
  circuitName: string,
  extension: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;
  const fileName = `${circuitName}.${extension}`;
  const url = getCircuitFileUrl(circuitName, extension);
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
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;

  if (BUNDLED_CIRCUITS.includes(circuitName)) {
    return copyBundledCircuitFile(circuitName, extension, onProgress, log);
  }

  return downloadCircuitFileFromGitHub(circuitName, extension, onProgress, log);
}

export async function downloadCircuitFiles(
  circuitName: string,
  onProgress?: (progress: DownloadProgress) => void,
  addLog?: (msg: string) => void,
): Promise<CircuitDownloadResult> {
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
  } catch {
    // Ignore errors
  }

  return {
    files: totalFiles,
    bytes: totalBytes,
    sizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
  };
}
