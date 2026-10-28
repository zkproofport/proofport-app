/**
 * Coinbase KYC v2's files come from the circuits COMMIT the app pins
 * (src/config/circuitArtifacts.ts), under their name on that branch, and are
 * stored on the phone under the canonical id `coinbase_attestation` -- never
 * from main or a release tag, where the v1 files of the same id live. An id
 * with no paths anywhere is an error rather than a guessed URL.
 */
// Coinbase KYC v2 and OIDC read per-platform circuit files; this test is the iPhone's.
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
const mockDownloads: Array<{fromUrl: string; toFile: string}> = [];
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/documents',
    MainBundlePath: '/tmp/bundle',
    exists: async () => false,
    mkdir: async () => {},
    unlink: async () => {},
    stat: async () => ({size: 10}),
    hash: async () => 'ff',
    stopDownload: () => {},
    downloadFile: (o: {fromUrl: string; toFile: string}) => {
      mockDownloads.push({fromUrl: o.fromUrl, toFile: o.toFile});
      return {jobId: 1, promise: Promise.resolve({statusCode: 200, bytesWritten: 10})};
    },
  },
}));

import {circuitArtifactSource, coinbaseKycArtifact} from '../../config/circuitArtifacts';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {downloadCircuitFiles, circuitBaseUrl, circuitDataVersion} = require('../circuitDownload');

const RAW = `https://raw.githubusercontent.com/zkproofport/circuits/${coinbaseKycArtifact().ref}`;

beforeEach(() => {
  mockDownloads.length = 0;
  mockDisk.clear();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''}));
});

describe('coinbase_attestation (v2)', () => {
  it('is pinned to a circuits pre-release tag, never a branch', () => {
    // v2.0.0-rc.1 is a GitHub pre-release on circuits commit b0ca9fe. A branch
    // name (main, coinbase-app-attest-poc) would move under installed apps.
    expect(coinbaseKycArtifact().ref).toMatch(/^v\d+\.\d+\.\d+-rc\.\d+$/);
    expect(coinbaseKycArtifact().ref).toBe('v2.0.0-rc.1');
  });

  it.each(['development', 'staging', 'production'])('downloads from that commit in a %s build, stored as coinbase_attestation', async env => {
    await downloadCircuitFiles('coinbase_attestation', env, undefined, () => {});
    expect(mockDownloads.map(d => d.fromUrl)).toEqual([
      `${RAW}/coinbase-attestation-v2/target/coinbase_attestation_v2.json`,
      `${RAW}/coinbase-attestation-v2/target/coinbase_attestation_v2.srs`,
      `${RAW}/coinbase-attestation-v2/target/vk/vk`,
    ]);
    expect(mockDownloads.map(d => d.toFile)).toEqual([
      '/tmp/documents/circuits/coinbase_attestation.json',
      '/tmp/documents/circuits/coinbase_attestation.srs',
      '/tmp/documents/circuits/coinbase_attestation.vk',
    ]);
    expect(await circuitBaseUrl('coinbase_attestation', env)).toBe(RAW);
  });

  it('replaces a v1 cache: the stored base URL is main, so the files are fetched again', async () => {
    mockDisk.set('@proofport/circuit-version/coinbase_attestation', JSON.stringify({
      baseUrl: 'https://raw.githubusercontent.com/zkproofport/circuits/main', downloadedAt: 1, dataVersion: 2,
    }));
    const logs: string[] = [];
    await downloadCircuitFiles('coinbase_attestation', 'staging', undefined, (m: string) => logs.push(m));
    expect(logs).toContain('Circuit version changed, invalidating cache...');
    expect(mockDownloads).toHaveLength(3);
  });

  it('has its own cache version', () => {
    expect(circuitDataVersion('coinbase_attestation')).toBe(coinbaseKycArtifact().dataVersion);
  });

  it('leaves every other circuit on main / its release', async () => {
    expect(circuitArtifactSource('coinbase_country_attestation')).toBeUndefined();
    expect(circuitArtifactSource('__proto__')).toBeUndefined();
    await downloadCircuitFiles('giwa_attestation', 'development', undefined, () => {});
    expect(mockDownloads[0].fromUrl).toBe('https://raw.githubusercontent.com/zkproofport/circuits/main/giwa-attestation/target/giwa_attestation.json');
  });
});

describe('an id nothing describes', () => {
  it('is an error, not a guessed path', async () => {
    await expect(downloadCircuitFiles('no_such_circuit', 'development', undefined, () => {})).rejects.toThrow(/No file paths for circuit 'no_such_circuit'/);
    expect(mockDownloads).toEqual([]);
  });
});
