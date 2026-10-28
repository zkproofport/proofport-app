/**
 * The proving screen says "Downloading" only while bytes arrive. On
 * 2026-10-29 a person watching a cached proof saw a download step on every
 * proof: the stage was set to 'download' before the cache was even checked.
 */
jest.mock('react-native', () => ({NativeModules: {}}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {getItem: async () => null, setItem: async () => {}, removeItem: async () => {}},
}));
jest.mock('mopro-ffi', () => ({}));
jest.mock('react-native-fs', () => ({__esModule: true, default: {CachesDirectoryPath: '/cache'}}));
jest.mock('../../config/environment', () => ({getEnvironment: () => 'staging'}));
type Progress = (p: {circuitName: string; fileName: string; bytesWritten: number; contentLength: number; percent: number}) => void;
const mockDownload = jest.fn(async (_c: string, _e: string, _p?: Progress) => ({}));
jest.mock('../circuitDownload', () => ({downloadCircuitFiles: (c: string, e: string, p?: Progress) => mockDownload(c, e, p)}));

import {circuitFilesForProof} from '../proofRun';
import {resetProofProgress, subscribeProofProgress, type ProofStage} from '../proofProgress';

function stagesDuring(run: () => Promise<unknown>): Promise<ProofStage[]> {
  const seen: ProofStage[] = [];
  const off = subscribeProofProgress(p => seen.push(p.stage));
  return run().then(() => {
    off();
    return seen;
  });
}

beforeEach(() => resetProofProgress());

it('a cache hit never shows the download stage', async () => {
  mockDownload.mockImplementationOnce(async () => ({}));
  const stages = await stagesDuring(() => circuitFilesForProof('oidc_domain_attestation', () => {}));
  expect(stages).not.toContain('download');
  expect(stages[stages.length - 1]).toBe('prepare');
});

it('bytes arriving show it, with the count, and it ends at prepare', async () => {
  let shown = 0;
  const off = subscribeProofProgress(p => {
    if (p.stage === 'download') shown = p.downloadedBytes;
  });
  mockDownload.mockImplementationOnce(async (_c, _e, onProgress) => {
    onProgress?.({circuitName: 'x', fileName: 'x.json', bytesWritten: 500, contentLength: 1000, percent: 50});
    onProgress?.({circuitName: 'x', fileName: 'x.srs', bytesWritten: 700, contentLength: 700, percent: 100});
    return {};
  });
  const stages = await stagesDuring(() => circuitFilesForProof('oidc_domain_attestation', () => {}));
  off();
  expect(stages).toContain('download');
  expect(shown).toBe(1200);
  expect(stages[stages.length - 1]).toBe('prepare');
});
