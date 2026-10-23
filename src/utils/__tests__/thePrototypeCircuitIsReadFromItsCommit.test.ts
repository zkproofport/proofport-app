/**
 * The App Attest prototype's files come from the circuits COMMIT the app pins,
 * under the prototype's own name -- never from main, a release tag, or
 * coinbase_attestation's paths -- and an id with no paths anywhere is an error
 * rather than a guessed `<id>/target/<id>.<ext>` URL.
 */
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
const mockUrls: string[] = [];
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
    downloadFile: ({fromUrl}: {fromUrl: string}) => {
      mockUrls.push(fromUrl);
      return {jobId: 1, promise: Promise.resolve({statusCode: 200, bytesWritten: 10})};
    },
  },
}));

import {COINBASE_APP_ATTEST_POC, prototypeCircuit} from '../../config/prototypeCircuits';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {downloadCircuitFiles, circuitBaseUrl, circuitDataVersion} = require('../circuitDownload');

const RAW = `https://raw.githubusercontent.com/zkproofport/circuits/${COINBASE_APP_ATTEST_POC.ref}`;

beforeEach(() => {
  mockUrls.length = 0;
  mockDisk.clear();
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''}));
});

describe('the App Attest prototype circuit', () => {
  it('is pinned to a full commit hash', () => {
    expect(COINBASE_APP_ATTEST_POC.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(['development', 'staging', 'production'])('downloads from that commit in a %s build', async env => {
    await downloadCircuitFiles(COINBASE_APP_ATTEST_POC.id, env, undefined, () => {});
    expect(mockUrls).toEqual([
      `${RAW}/coinbase-app-attest-poc/target/coinbase_app_attest_poc.json`,
      `${RAW}/coinbase-app-attest-poc/target/coinbase_app_attest_poc.srs`,
      `${RAW}/coinbase-app-attest-poc/target/vk/vk`,
    ]);
    expect(await circuitBaseUrl(COINBASE_APP_ATTEST_POC.id, env)).toBe(RAW);
  });

  it('has its own cache version', () => {
    expect(circuitDataVersion(COINBASE_APP_ATTEST_POC.id)).toBe(COINBASE_APP_ATTEST_POC.dataVersion);
  });

  it('is not reachable through an inherited property name', () => {
    expect(prototypeCircuit('__proto__')).toBeUndefined();
    expect(prototypeCircuit('constructor')).toBeUndefined();
  });
});

describe('an id nothing describes', () => {
  it('is an error, not a guessed path', async () => {
    await expect(downloadCircuitFiles('no_such_circuit', 'development', undefined, () => {})).rejects.toThrow(/No file paths for circuit 'no_such_circuit'/);
    expect(mockUrls).toEqual([]);
  });
});
