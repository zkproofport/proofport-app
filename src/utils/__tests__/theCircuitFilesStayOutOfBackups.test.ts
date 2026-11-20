/**
 * Everything in `Documents/circuits/` can be downloaded or rebuilt again:
 * each circuit's .json/.srs/.vk (circuitDownload.ts) and the prover's shared
 * reference string `bn254-crs/bn254_g1.dat` (up to 128 MiB, sharedSrs.ts).
 * So (circuitBackup.ts):
 *
 *   - on iOS `Documents/circuits` ITSELF is flagged NSURLIsExcludedFromBackupKey
 *     -- not only a sub-folder -- which covers everything inside it;
 *   - the flag is set at every launch (App.tsx), before every download, on
 *     the cached path too, and before the prover starts on every proof, so
 *     a directory that already existed gets it;
 *   - never on Android, which backs nothing up (android:allowBackup="false"
 *     -- held here too);
 *   - a flag that cannot be set is logged and the download / proof still runs;
 *   - getDownloadedCircuitsSize counts the shared file, deleteAllCircuitFiles
 *     removes it with the circuits directory, and deleting ONE circuit's
 *     files leaves it (every circuit shares it).
 */
import * as fs from 'fs';
import * as path from 'path';

const mockOs = {value: 'ios'};
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockOs.value;
    },
  },
  AppState: {currentState: 'active'},
}));

/** path -> size in bytes, or 'dir'. */
const mockFs = new Map<string, number | 'dir'>();
const mockCalls: string[] = [];
const mockMkdir = jest.fn(async (p: string, _opts?: Record<string, unknown>) => {
  mockCalls.push(`mkdir ${p}`);
  mockFs.set(p, 'dir');
});
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/docs',
    CachesDirectoryPath: '/cache',
    MainBundlePath: '/bundle',
    exists: async (p: string) => mockFs.has(p),
    mkdir: (p: string, o?: Record<string, unknown>) => mockMkdir(p, o),
    getFSInfo: async () => ({freeSpace: 8 * 1024 ** 3}),
    stat: async (p: string) => ({size: mockFs.get(p) === 'dir' ? 0 : mockFs.get(p) ?? 0}),
    readDir: async (dir: string) =>
      [...mockFs.entries()]
        .filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map(([p, v]) => ({
          path: p,
          name: p.slice(dir.length + 1),
          size: v === 'dir' ? 96 : v,
          isFile: () => v !== 'dir',
          isDirectory: () => v === 'dir',
        })),
    unlink: async (p: string) => {
      mockCalls.push(`unlink ${p}`);
      for (const k of [...mockFs.keys()]) if (k === p || k.startsWith(`${p}/`)) mockFs.delete(k);
    },
  },
}));
const mockStored = {value: null as string | null};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {getItem: async () => mockStored.value, setItem: async () => {}, removeItem: async () => {}},
}));
const mockStart = jest.fn((..._a: unknown[]) => {
  mockCalls.push('startNoirProof');
  return BigInt(1);
});
jest.mock('mopro-ffi', () => ({
  startNoirProof: (...a: unknown[]) => mockStart(...a),
  noirProofStatus: () => ({state: 'done', phase: '', elapsedMs: BigInt(1), phases: [], peakRssKb: BigInt(0), peakSwapKb: BigInt(0)}),
  takeNoirProof: () => new ArrayBuffer(4),
}));

import {proveOffThread} from '../noirProver';
import {sharedSrsDirectoryFor, SHARED_SRS_DIR_NAME} from '../sharedSrs';
import {excludeFromBackup, keepProverFilesOutOfBackup} from '../circuitBackup';
import {__setOprfCircuitsRefForTests} from '../../config/circuitArtifacts';

// GIWA reads OPRF_CIRCUITS_REF (empty until the OPRF circuits are pushed): a test commit in its place.
__setOprfCircuitsRefForTests('c0ffee'.repeat(6) + 'c0ff');
import {
  circuitBaseUrl,
  circuitDataVersion,
  deleteAllCircuitFiles,
  downloadCircuitFiles,
  ensureCircuitDirectory,
  deleteCircuitFiles,
  getCircuitDirectory,
  getCircuitFilePath,
  getDownloadedCircuitsSize,
  getSharedSrsDirectory,
} from '../circuitDownload';

const timer = {note: () => {}, record: () => {}, step: async <T,>(_n: string, f: () => Promise<T>) => f()};

function prove(log: (m: string) => void = () => {}) {
  return proveOffThread({
    circuitPath: getCircuitFilePath('giwa_attestation', 'json'),
    srsPath: getCircuitFilePath('giwa_attestation', 'srs'),
    inputs: [],
    vk: new ArrayBuffer(0),
    onChain: true,
    timer: timer as never,
    log,
    watchdogMs: 60_000,
  });
}

beforeEach(() => {
  mockFs.clear();
  mockCalls.length = 0;
  mockMkdir.mockClear();
  mockStart.mockClear();
  mockOs.value = 'ios';
  mockStored.value = null;
});

const FLAG = {NSURLIsExcludedFromBackupKey: true};
const flaggedPaths = () => mockMkdir.mock.calls.filter(([, o]) => o?.NSURLIsExcludedFromBackupKey === true).map(([p]) => p);

describe('where the prover keeps it', () => {
  it("is bn254-crs beside the .srs, the prover's own name", () => {
    expect(SHARED_SRS_DIR_NAME).toBe('bn254-crs');
    expect(sharedSrsDirectoryFor('/docs/circuits/giwa_attestation.srs')).toBe('/docs/circuits/bn254-crs');
    expect(getSharedSrsDirectory()).toBe(`${getCircuitDirectory()}/bn254-crs`);
    expect(sharedSrsDirectoryFor(getCircuitFilePath('oidc_domain_attestation', 'srs'))).toBe(getSharedSrsDirectory());
  });

  it('a path with no directory is refused by name, and the flag is not set', async () => {
    expect(() => sharedSrsDirectoryFor('giwa.srs')).toThrow("Path 'giwa.srs' has no directory.");
    const log = jest.fn();
    await keepProverFilesOutOfBackup('giwa.srs', log);
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain("Path 'giwa.srs' has no directory.");
  });

  it('a file at the root keeps the root, as the prover does', () => {
    expect(sharedSrsDirectoryFor('/x.srs')).toBe('/bn254-crs');
  });
});

describe('iOS backup: the circuits directory itself', () => {
  it('excludeFromBackup creates and flags exactly the directory it is given', async () => {
    await excludeFromBackup('/docs/circuits');
    expect(mockMkdir.mock.calls).toEqual([['/docs/circuits', FLAG]]);
  });

  it('ensureCircuitDirectory flags /docs/circuits, not a folder inside it', async () => {
    await ensureCircuitDirectory(() => {});
    expect(flaggedPaths()).toEqual(['/docs/circuits']);
    expect(getCircuitDirectory()).toBe('/docs/circuits');
  });

  it('flags a directory that already exists, on every call', async () => {
    mockFs.set('/docs/circuits', 'dir');
    mockFs.set('/docs/circuits/giwa_attestation.srs', 33_554_496);
    await ensureCircuitDirectory(() => {});
    await ensureCircuitDirectory(() => {});
    expect(flaggedPaths()).toEqual(['/docs/circuits', '/docs/circuits']);
    expect(mockFs.get('/docs/circuits/giwa_attestation.srs')).toBe(33_554_496);
  });

  it('a download whose files are all cached still flags the directory', async () => {
    for (const ext of ['json', 'srs', 'vk']) mockFs.set(`/docs/circuits/giwa_attestation.${ext}`, 10);
    mockFs.set('/docs/circuits', 'dir');
    mockStored.value = JSON.stringify({
      baseUrl: await circuitBaseUrl('giwa_attestation', 'staging'),
      downloadedAt: 1,
      dataVersion: circuitDataVersion('giwa_attestation'),
    });
    const paths = await downloadCircuitFiles('giwa_attestation', 'staging', undefined, () => {});
    expect(paths.srsPath).toBe('/docs/circuits/giwa_attestation.srs');
    expect(flaggedPaths()).toEqual(['/docs/circuits']);
  });

  it('flags the directory holding the .srs before the prover starts, on every proof', async () => {
    await prove();
    await prove();
    expect(flaggedPaths()).toEqual(['/docs/circuits', '/docs/circuits']);
    const flagged = mockCalls.indexOf('mkdir /docs/circuits');
    expect(flagged).toBeGreaterThanOrEqual(0);
    expect(flagged).toBeLessThan(mockCalls.indexOf('startNoirProof'));
  });

  it('flags nothing narrower than the circuits directory anywhere', async () => {
    await ensureCircuitDirectory(() => {});
    await prove();
    expect(flaggedPaths().every(p => p === '/docs/circuits')).toBe(true);
    expect(flaggedPaths().length).toBe(2);
  });

  it('a flag that cannot be set is logged; the proof runs and the directory is still made', async () => {
    mockMkdir.mockImplementation(async (p: string, o?: Record<string, unknown>) => {
      if (o?.NSURLIsExcludedFromBackupKey) throw new Error('NSCocoaErrorDomain 513');
      mockCalls.push(`mkdir ${p}`);
      mockFs.set(p, 'dir');
    });
    const log = jest.fn();
    await expect(prove(log)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join('\n')).toContain('Could not exclude /docs/circuits from backup: NSCocoaErrorDomain 513');
    log.mockClear();
    await expect(ensureCircuitDirectory(log)).resolves.toBeUndefined();
    expect(mockFs.get('/docs/circuits')).toBe('dir');
    expect(log.mock.calls.flat().join('\n')).toContain('Could not exclude /docs/circuits from backup: NSCocoaErrorDomain 513');
    mockMkdir.mockImplementation(async (p: string) => {
      mockCalls.push(`mkdir ${p}`);
      mockFs.set(p, 'dir');
    });
  });

  it.each(['android', 'web'])('is not set on %s, and the directory is still made', async os => {
    mockOs.value = os;
    await prove();
    await ensureCircuitDirectory(() => {});
    expect(flaggedPaths()).toEqual([]);
    expect(mockFs.get('/docs/circuits')).toBe('dir');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe('every launch', () => {
  it('App.tsx calls ensureCircuitDirectory in its run-once launch effect', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../../App.tsx'), 'utf8');
    expect(app).toMatch(/import \{ensureCircuitDirectory\} from '\.\/src\/utils\/circuitDownload';/);
    const effects = [...app.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/g)].map(m => m[1]);
    expect(effects.some(body => /\n\s*ensureCircuitDirectory\(\)\.catch\(/.test(body))).toBe(true);
  });
});

describe('Android backup', () => {
  it('stays off: turning it on needs a rule excluding the circuits directory', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../../../android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toMatch(/android:allowBackup="false"/);
    expect(manifest).not.toMatch(/android:fullBackupContent|android:dataExtractionRules/);
  });
});

describe('downloaded size and delete', () => {
  function seed() {
    mockFs.set('/docs/circuits', 'dir');
    mockFs.set('/docs/circuits/giwa_attestation.json', 1000);
    mockFs.set('/docs/circuits/giwa_attestation.srs', 33_554_496);
    mockFs.set('/docs/circuits/giwa_attestation.vk', 1888);
    mockFs.set('/docs/circuits/bn254-crs', 'dir');
    mockFs.set('/docs/circuits/bn254-crs/bn254_g1.dat', 134_217_728);
    mockFs.set('/docs/circuits/bn254-crs/crs.lock', 0);
  }

  it('counts the shared reference string with the circuit files', async () => {
    seed();
    const size = await getDownloadedCircuitsSize();
    expect(size.files).toBe(5);
    expect(size.bytes).toBe(1000 + 33_554_496 + 1888 + 134_217_728);
    expect(size.sizeMB).toBe(((1000 + 33_554_496 + 1888 + 134_217_728) / 1048576).toFixed(2));
  });

  it('is zero with no circuits directory, and counts the shared file alone', async () => {
    expect(await getDownloadedCircuitsSize()).toEqual({files: 0, bytes: 0, sizeMB: '0.00'});
    mockFs.set('/docs/circuits', 'dir');
    mockFs.set('/docs/circuits/bn254-crs', 'dir');
    mockFs.set('/docs/circuits/bn254-crs/bn254_g1.dat', 32_768);
    expect(await getDownloadedCircuitsSize()).toEqual({files: 1, bytes: 32_768, sizeMB: '0.03'});
  });

  it('deleting every circuit removes it too', async () => {
    seed();
    await deleteAllCircuitFiles(() => {});
    expect(mockCalls).toContain('unlink /docs/circuits');
    expect([...mockFs.keys()].filter(k => k.includes('bn254'))).toEqual([]);
    expect(await getDownloadedCircuitsSize()).toEqual({files: 0, bytes: 0, sizeMB: '0.00'});
  });

  it("deleting one circuit's files leaves it for the others", async () => {
    seed();
    await deleteCircuitFiles('giwa_attestation', () => {});
    expect(mockFs.has('/docs/circuits/bn254-crs/bn254_g1.dat')).toBe(true);
    expect(mockCalls.some(c => c.includes('bn254'))).toBe(false);
  });
});
