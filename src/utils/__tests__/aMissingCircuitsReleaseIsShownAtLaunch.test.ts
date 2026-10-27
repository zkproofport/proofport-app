/**
 * A production build whose pinned circuits release does not exist says so at
 * launch (E3007, naming the tag) and when a circuit file is downloaded (E3005's
 * reason names the tag). Offline stays what it was: logged, no modal from the
 * sync, cached or built-in addresses used.
 */
const mockFiles = new Map<string, number>();
const mockUnlinked: string[] = [];
let mockStatus = 404;
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/docs',
    MainBundlePath: '/bundle',
    exists: async (p: string) => mockFiles.has(p) || p === '/docs/circuits',
    mkdir: async () => {},
    unlink: async (p: string) => {
      mockUnlinked.push(p);
      mockFiles.delete(p);
    },
    stat: async (p: string) => ({size: mockFiles.get(p) ?? 0}),
    hash: async () => 'ab'.repeat(32),
    stopDownload: () => {},
    downloadFile: ({toFile}: {toFile: string}) => {
      mockFiles.set(toFile, 14); // GitHub's "404: Not Found" body
      return {jobId: 1, promise: Promise.resolve({statusCode: mockStatus, bytesWritten: 14})};
    },
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {getItem: async () => null, setItem: async () => {}, removeItem: async () => {}},
}));
jest.mock('react-native', () => ({Platform: {OS: 'ios'}}));

import {syncDeploymentsAtLaunch} from '../launchDeploymentSync';
import {CircuitsReleaseMissingError} from '../../config/deployments';
import {downloadCircuitFiles} from '../circuitDownload';

describe('the launch sync', () => {
  it('shows E3007 with the tag when the pinned release is missing', async () => {
    const showError = jest.fn();
    const log = jest.fn();
    await syncDeploymentsAtLaunch({
      sync: async () => {
        throw new CircuitsReleaseMissingError('v2.0.0', ['https://raw.githubusercontent.com/zkproofport/circuits/v2.0.0/broadcast/x.json']);
      },
      showError,
      log,
    });
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError.mock.calls[0][0]).toBe('E3007');
    expect(showError.mock.calls[0][1]).toContain('Circuits release v2.0.0 is not available');
  });

  it('shows nothing for any other failure, and logs it', async () => {
    const showError = jest.fn();
    const log = jest.fn();
    await syncDeploymentsAtLaunch({sync: async () => { throw new Error('Network request failed'); }, showError, log});
    expect(showError).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('Network request failed');
  });

  it('shows nothing when the sync succeeds', async () => {
    const showError = jest.fn();
    await syncDeploymentsAtLaunch({sync: async () => true, showError, log: () => {}});
    expect(showError).not.toHaveBeenCalled();
  });
});

describe('a circuit download from the pinned release', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockUnlinked.length = 0;
    (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 404, text: async () => ''}));
  });

  it('a 404 in production names the tag, and the error body is deleted', async () => {
    mockStatus = 404;
    const err = await downloadCircuitFiles('coinbase_attestation', 'production', undefined, () => {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('/circuits/v2.0.0/');
    expect((err as Error).message).toContain('circuits release v2.0.0 (CIRCUITS_RELEASE_TAG) is missing or does not contain this file');
    expect(mockUnlinked).toContain('/docs/circuits/coinbase_attestation.json');
    expect(mockFiles.has('/docs/circuits/coinbase_attestation.json')).toBe(false);
  });

  it('a 404 on main in staging is reported plainly, not as a missing release', async () => {
    mockStatus = 404;
    const err = await downloadCircuitFiles('coinbase_attestation', 'staging', undefined, () => {}).catch((e: Error) => e);
    expect((err as Error).message).toContain('HTTP 404 from https://raw.githubusercontent.com/zkproofport/circuits/main/');
    expect((err as Error).message).not.toContain('CIRCUITS_RELEASE_TAG');
  });

  it('a Laboratory circuit in production reads main, not the tag', async () => {
    mockStatus = 404;
    const err = await downloadCircuitFiles('giwa_attestation', 'production', undefined, () => {}).catch((e: Error) => e);
    expect((err as Error).message).toContain('/circuits/main/');
    expect((err as Error).message).not.toContain('CIRCUITS_RELEASE_TAG');
  });
});
