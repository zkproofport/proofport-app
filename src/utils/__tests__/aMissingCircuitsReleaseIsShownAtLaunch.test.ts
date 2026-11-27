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
import {__setOprfCircuitsRefForTests, GIWA_V2_CIRCUITS_REF} from '../../config/circuitArtifacts';

// Every wallet credential circuit reads OPRF_CIRCUITS_REF since the OPRF
// nullifier (empty until pushed); these cases run with a test commit there.
const OPRF_REF = 'c0ffee'.repeat(6) + 'c0ff';
__setOprfCircuitsRefForTests(OPRF_REF);
const COUNTRY_V2_CIRCUITS_REF = OPRF_REF;

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

  // Since Coinbase Country v2 every official circuit reads a pinned ref
  // (src/config/circuitArtifacts.ts), so no download reaches
  // CIRCUITS_RELEASE_TAG; the launch sync above still reads broadcasts there.
  it.each(['production', 'staging'] as const)(
    '%s: Coinbase Country v2 reads its pinned commit, never the release tag or main',
    async env => {
      mockStatus = 404;
      const err = await downloadCircuitFiles('coinbase_country_attestation', env, undefined, () => {}).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).not.toContain('CIRCUITS_RELEASE_TAG');
      expect(message).not.toContain('/circuits/main/');
      expect(COUNTRY_V2_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
      expect(message).toContain(`/circuits/${COUNTRY_V2_CIRCUITS_REF}/coinbase-country-attestation-v2/`);
      expect(message).toContain(`circuits ref ${COUNTRY_V2_CIRCUITS_REF} (src/config/circuitArtifacts.ts) does not contain this file`);
      expect(mockFiles.has('/docs/circuits/coinbase_country_attestation.json')).toBe(false);
    },
  );

  it('a 404 for Coinbase KYC v2 names its pinned ref, never CIRCUITS_RELEASE_TAG', async () => {
    mockStatus = 404;
    const err = await downloadCircuitFiles('coinbase_attestation', 'production', undefined, () => {}).catch((e: Error) => e);
    expect((err as Error).message).toContain(`/circuits/${OPRF_REF}/`);
    expect((err as Error).message).toContain(`circuits ref ${OPRF_REF} (src/config/circuitArtifacts.ts) does not contain this file`);
    expect((err as Error).message).not.toContain('CIRCUITS_RELEASE_TAG');
    expect(mockFiles.has('/docs/circuits/coinbase_attestation.json')).toBe(false);
  });

  // GIWA and the Dojang Playground read GIWA_V2_CIRCUITS_REF (circuitArtifacts.ts)
  // in every environment since their v2 packages (2026-11-27); a pinned commit, never main.
  it.each(['staging', 'production'] as const)('a 404 for a Laboratory circuit in %s names its pinned commit, never main or the release', async env => {
    mockStatus = 404;
    const err = await downloadCircuitFiles('giwa_attestation', env, undefined, () => {}).catch((e: Error) => e);
    const ref = GIWA_V2_CIRCUITS_REF;
    expect((err as Error).message).toContain(`HTTP 404 from https://raw.githubusercontent.com/zkproofport/circuits/${ref}/`);
    expect((err as Error).message).toContain(`circuits ref ${ref} (src/config/circuitArtifacts.ts) does not contain this file`);
    expect((err as Error).message).not.toContain('/circuits/main/');
    expect((err as Error).message).not.toContain('CIRCUITS_RELEASE_TAG');
  });
});
