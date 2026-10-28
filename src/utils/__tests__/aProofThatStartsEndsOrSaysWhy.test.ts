/**
 * A proof that has started either finishes or ends with an error that says
 * why -- it never waits forever and never disappears without a word:
 *
 *   - the prover runs as a native job; a job that fails hands its own error
 *     back, a job that never returns is given up on by the watchdog with a
 *     message naming the phase;
 *   - the JS thread is polled, not blocked (the status is read repeatedly
 *     while the job runs);
 *   - a proof the app died in the middle of is reported at the next launch
 *     (E2019, History marked failed), once;
 *   - a relay request being proved is answered E2019 on the next launch,
 *     not a plain "cancelled";
 *   - [ProofTiming] lines carry step, duration and memory, and nothing else.
 */
jest.mock('react-native', () => ({View: 'View', Text: 'Text', StyleSheet: {create: (x: unknown) => x}, NativeModules: {}, AppState: {currentState: 'active'}}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockAppState = (require('react-native') as {AppState: {currentState: string}}).AppState;
jest.mock('react-i18next', () => ({useTranslation: () => ({t: (k: string) => k})}));
jest.mock('../../context', () => ({useThemeColors: () => ({colors: {}})}));
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockDisk.has(k) ? mockDisk.get(k)! : null),
    setItem: async (k: string, v: string) => void mockDisk.set(k, v),
    removeItem: async (k: string) => void mockDisk.delete(k),
  },
}));
const mockFsFiles = new Map<string, number>();
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    CachesDirectoryPath: '/cache',
    exists: async (p: string) => p === '/cache/prover' || mockFsFiles.has(p),
    mkdir: async () => {},
    readDir: async () => [...mockFsFiles.entries()].map(([path, size]) => ({path, size})),
    unlink: async (p: string) => void mockFsFiles.delete(p),
    getFSInfo: async () => ({freeSpace: 8 * 1024 ** 3}),
  },
}));
type Status = {state: string; phase: string; elapsedMs: bigint; phases: Array<{name: string; durationMs: bigint; rssKbAfter: bigint}>; peakRssKb: bigint; peakSwapKb: bigint};
const mockStatuses: Status[] = [];
const mockStart = jest.fn((..._a: unknown[]) => BigInt(7));
const mockTake = jest.fn((_id: bigint): ArrayBuffer => new ArrayBuffer(3));
const mockStatusCalls = jest.fn();
jest.mock('mopro-ffi', () => ({
  startNoirProof: (...a: unknown[]) => mockStart(...a),
  noirProofStatus: (id: bigint) => {
    mockStatusCalls(id);
    return mockStatuses.length > 1 ? mockStatuses.shift() : mockStatuses[0];
  },
  takeNoirProof: (id: bigint) => mockTake(id),
}));
const mockShowError = jest.fn();
jest.mock('../errorBridge', () => ({showGlobalError: (...a: unknown[]) => mockShowError(...a)}));
const mockHistoryUpdate = jest.fn(async () => {});
jest.mock('../../stores', () => ({proofHistoryStore: {update: (...a: unknown[]) => (mockHistoryUpdate as (...x: unknown[]) => Promise<void>)(...a)}}));
jest.mock('../deeplink', () => ({
  checkRelayCallbackUrl: () => ({trusted: true}),
  postRelayCallback: jest.fn(async () => ({kind: 'ok'})),
}));

import {proveOffThread, clearProverTempDir} from '../noirProver';
import {startProofTimer, formatMemory, PROOF_TIMING_PREFIX} from '../proofTiming';
import {markProofInFlight, clearProofInFlight} from '../proofInFlight';
import {reportInterruptedProof} from '../interruptedProof';
import {
  markOpenRequestProving,
  rememberOpenRelayRequest,
  resetRelayAnswersForTests,
  answerRequestsLeftOpen,
} from '../relayAnswer';
import {progressLines, formatDuration} from '../../components/ProofProgressCard';
import {getProofProgress, resetProofProgress} from '../proofProgress';

const running = (phase: string, phases: Status['phases'] = []): Status => ({
  state: 'running', phase, elapsedMs: BigInt(1), phases, peakRssKb: BigInt(0), peakSwapKb: BigInt(0),
});

function timer(lines: string[]) {
  return startProofTimer('oidc_domain_attestation', undefined, {
    memory: async () => ({pssKb: 2048, rssKb: 4096, swapKb: 0}),
    console: (m: string) => lines.push(m),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockDisk.clear();
  mockFsFiles.clear();
  mockStatuses.length = 0;
  mockStart.mockClear();
  mockTake.mockReset().mockReturnValue(new ArrayBuffer(3));
  mockStatusCalls.mockClear();
  mockShowError.mockClear();
  mockHistoryUpdate.mockClear();
  resetProofProgress();
});
afterEach(() => {
  jest.useRealTimers();
  mockAppState.currentState = 'active';
});

async function runProof(watchdogMs = 60_000) {
  const lines: string[] = [];
  const p = proveOffThread({
    circuitPath: '/c.json', srsPath: '/c.srs', inputs: ['1'], vk: new ArrayBuffer(1), onChain: true,
    timer: timer(lines), log: () => {}, watchdogMs,
  });
  return {p, lines};
}

describe('the prover runs off the JS thread and always ends', () => {
  it('polls while the job runs, logs each native phase, and hands back the proof', async () => {
    mockStatuses.push(
      running('load srs'),
      running('solve witness', [{name: 'load srs', durationMs: BigInt(1900), rssKbAfter: BigInt(150000)}]),
      {state: 'done', phase: '', elapsedMs: BigInt(140000), peakRssKb: BigInt(2200000), peakSwapKb: BigInt(300000),
        phases: [
          {name: 'load srs', durationMs: BigInt(1900), rssKbAfter: BigInt(150000)},
          {name: 'solve witness', durationMs: BigInt(32000), rssKbAfter: BigInt(170000)},
        ]},
    );
    const {p, lines} = await runProof();
    for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(500);
    const proof = await p;
    expect(proof.byteLength).toBe(3);
    expect(mockStatusCalls.mock.calls.length).toBeGreaterThanOrEqual(3);
    const [, , , , , options] = mockStart.mock.calls[0] as unknown[];
    expect(options).toEqual({lowMemoryMode: true, tempDir: '/cache/prover', threads: undefined});
    expect(lines.filter(l => l.includes('native:load srs end 1900ms'))).toHaveLength(1);
    expect(lines.some(l => l.includes('native:solve witness end 32000ms rss=166MiB'))).toBe(true);
    expect(lines.some(l => /native:total 140000ms peakRss=2148MiB peakSwap=293MiB/.test(l))).toBe(true);
    expect(getProofProgress().proverPhase).toBe('solve witness');
  });

  it('a failed job ends with the job\'s own error', async () => {
    mockStatuses.push(running('prove'), {...running(''), state: 'failed'});
    mockTake.mockImplementation(() => {
      throw new Error('NoirError: Generate Proof error: Failed to solve program');
    });
    const {p} = await runProof();
    const settled = p.catch((e: Error) => e);
    for (let i = 0; i < 3; i++) await jest.advanceTimersByTimeAsync(500);
    expect(((await settled) as Error).message).toMatch(/Failed to solve program/);
  });

  it('a job that never returns is given up on, with the phase it was stuck in', async () => {
    mockStatuses.push(running('prove'));
    const {p} = await runProof(2000);
    const settled = p.catch((e: Error) => e);
    for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(500);
    expect(((await settled) as Error).message).toMatch(/The prover has not finished after \d+ s \(phase prove\); stopped waiting/);
  });

  it('time in the background does not count toward giving up', async () => {
    mockStatuses.push(running('prove'));
    mockAppState.currentState = 'background';
    const {p} = await runProof(2000);
    let settled: unknown = 'pending';
    p.then(v => (settled = v), e => (settled = e));
    for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(500);
    expect(settled).toBe('pending');
    mockAppState.currentState = 'active';
    for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(500);
    expect((settled as Error).message).toMatch(/stopped waiting/);
  });

  it('one long gap (the app was frozen) counts as at most a few polls', async () => {
    mockStatuses.push(running('prove'));
    const {p} = await runProof(5000);
    let settled: unknown = 'pending';
    p.then(v => (settled = v), e => (settled = e));
    await jest.advanceTimersByTimeAsync(500);
    jest.setSystemTime(Date.now() + 60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(500);
    expect(settled).toBe('pending');
    for (let i = 0; i < 12; i++) await jest.advanceTimersByTimeAsync(500);
    expect((settled as Error).message).toMatch(/stopped waiting/);
  });

  it('leftover polynomial files from a killed proof are removed before the next one', async () => {
    mockFsFiles.set('/cache/prover/poly-mmap-123-0', 600_000_000);
    mockFsFiles.set('/cache/prover/poly-mmap-123-1', 700_000_000);
    const logs: string[] = [];
    await clearProverTempDir(m => logs.push(m));
    expect(mockFsFiles.size).toBe(0);
    expect(logs[0]).toMatch(/Removed 2 leftover prover files \(1240 MiB\)/);
  });
});

describe('a proof the app died in is reported on the next launch', () => {
  it('shows E2019 once, marks History failed, and is not reported twice', async () => {
    jest.useRealTimers();
    await markProofInFlight({circuit: 'oidc_domain_attestation', startedAt: 1_793_000_000_000, historyId: 'h1', requestId: 'r1'});
    expect(await reportInterruptedProof()).toBe(true);
    expect(mockShowError).toHaveBeenCalledWith('E2019', expect.stringContaining('oidc_domain_attestation'));
    expect(mockHistoryUpdate).toHaveBeenCalledWith('h1', {overallStatus: 'failed', offChainStatus: 'failed', onChainStatus: 'failed'});
    mockShowError.mockClear();
    expect(await reportInterruptedProof()).toBe(false);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('a proof that ended normally is not reported', async () => {
    jest.useRealTimers();
    await markProofInFlight({circuit: 'coinbase_attestation', startedAt: 1, historyId: null, requestId: null});
    await clearProofInFlight();
    expect(await reportInterruptedProof()).toBe(false);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it.each([['not json'], [JSON.stringify({circuit: 7})], [JSON.stringify(null)]])(
    'a damaged record (%s) is dropped without a modal',
    async raw => {
      jest.useRealTimers();
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockDisk.set('@zkproofport:proof:inFlight:v1', raw);
      expect(await reportInterruptedProof()).toBe(false);
      expect(mockShowError).not.toHaveBeenCalled();
      expect(mockDisk.has('@zkproofport:proof:inFlight:v1')).toBe(false);
      err.mockRestore();
    },
  );

  it('a relay request being proved is answered E2019 at the next launch, not "cancelled"', async () => {
    jest.useRealTimers();
    resetRelayAnswersForTests(Date.now());
    const request = {requestId: 'req-1', circuit: 'oidc_domain_attestation' as const, callbackUrl: 'https://stg-relay.zkproofport.app/api/v1/proof/callback'};
    await rememberOpenRelayRequest(request);
    await markOpenRequestProving('req-1');
    // The next launch.
    resetRelayAnswersForTests(Date.now() + 1000);
    const {postRelayCallback} = jest.requireMock('../deeplink');
    postRelayCallback.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(await answerRequestsLeftOpen()).toBe(1);
    expect(postRelayCallback.mock.calls[0][0]).toMatchObject({requestId: 'req-1', status: 'error', errorCode: 'E2019'});
  });
});

describe('[ProofTiming] lines', () => {
  it('carry the step, its duration and memory, under one prefix', async () => {
    jest.useRealTimers();
    const lines: string[] = [];
    const t = timer(lines);
    await t.step('load vk', async () => 1);
    await expect(t.step('sign-in', async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(lines.every(l => l.startsWith(`${PROOF_TIMING_PREFIX} oidc_domain_attestation#`))).toBe(true);
    expect(lines.some(l => / load vk end \d+ms pss=2MiB rss=4MiB swap=0MiB$/.test(l))).toBe(true);
    expect(lines.some(l => / sign-in fail \d+ms /.test(l))).toBe(true);
  });

  it('say so when memory cannot be read, rather than printing zeros', () => {
    expect(formatMemory(null)).toBe('mem=unavailable');
    expect(formatMemory({footprintKb: 1048576})).toBe('footprint=1024MiB');
  });
});

describe('the progress card says what is happening and how long it took last time', () => {
  const t = (k: string, o?: Record<string, string>) => `${k}${o ? JSON.stringify(o) : ''}`;
  const base = getProofProgress();

  it('download: bytes received', () => {
    expect(progressLines({...base, stage: 'download', downloadedBytes: 45_600_000}, 0, t).title)
      .toBe('host.proof.generation.progress.download{"received":"45.6 MB"}');
  });

  it('proving with a previous time: phase, elapsed, the last time, keep open', () => {
    const lines = progressLines({...base, stage: 'prove', proverPhase: 'solve witness', proveStartedAt: 1000, estimateMs: 139_000}, 66_000, t);
    expect(lines.detail).toEqual([
      'host.proof.generation.progress.phase.solve witness',
      'host.proof.generation.progress.elapsed{"elapsed":"1:05"}',
      'host.proof.generation.progress.estimate{"time":"2:19"}',
      'host.proof.generation.progress.keepOpen',
    ]);
  });

  it('first proof on this phone: no invented number', () => {
    const lines = progressLines({...base, stage: 'prove', proverPhase: 'mystery', proveStartedAt: 0, estimateMs: null}, 0, t);
    expect(lines.detail).toContain('host.proof.generation.progress.firstTime');
    expect(lines.detail.some(l => l.includes('estimate'))).toBe(false);
    expect(lines.detail.some(l => l.includes('phase.'))).toBe(false);
  });

  it('formats durations', () => {
    expect([formatDuration(0), formatDuration(59_400), formatDuration(60_000), formatDuration(605_000)]).toEqual(['0:00', '0:59', '1:00', '10:05']);
  });
});
