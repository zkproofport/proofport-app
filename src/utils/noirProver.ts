/**
 * Proving off the JavaScript thread.
 *
 * mopro's `generateNoirProof` is synchronous, and React Native runs it on the
 * JavaScript thread: on the 2^21 Android circuits the whole app froze for
 * minutes on a 4 GB phone -- no progress, no timer, no reaction to the app
 * leaving the foreground (logcat showed no JS line for 3 m 23 s on
 * 2026-10-28). The Rust side now runs the proof as a job on its own thread
 * (mopro/src/prove_job.rs); this starts it, polls its status twice a second
 * (the JS thread stays free for the screen), logs every native phase under
 * `[ProofTiming]`, and hands back the proof bytes.
 *
 * How barretenberg runs, chosen from measurements on a Galaxy A23
 * (scripts/bench-mopro-android.sh; numbers in .claude/agents/mopro-dev.md):
 * polynomials in files under the app's cache directory instead of RAM
 * (`lowMemoryMode` with a real `tempDir` -- Android has no /tmp, so before
 * this the flag silently did nothing and the phone swapped 1.3 GB).
 */
import RNFS from 'react-native-fs';
import {noirProofStatus, startNoirProof, takeNoirProof} from 'mopro-ffi';
import type {ProofTimer} from './proofTiming';
import {updateProofProgress} from './proofProgress';

/** Where barretenberg keeps its polynomial files while proving. */
export function proverTempDir(): string {
  return `${RNFS.CachesDirectoryPath}/prover`;
}

/**
 * Free space the file-backed prover needs: measured 1.3 GB of polynomial
 * files at once for a 2^21 circuit, plus margin.
 */
export const PROVER_DISK_BYTES = 2 * 1024 * 1024 * 1024;

const POLL_MS = 500;

/**
 * Remove polynomial files a killed earlier proof left behind (barretenberg
 * deletes its own when a proof ends normally; a killed process deletes
 * nothing, and they are over a gigabyte).
 */
export async function clearProverTempDir(log?: (m: string) => void): Promise<void> {
  const dir = proverTempDir();
  try {
    if (!(await RNFS.exists(dir))) return;
    const files = await RNFS.readDir(dir);
    let bytes = 0;
    for (const f of files) {
      bytes += f.size;
      await RNFS.unlink(f.path).catch(() => {});
    }
    if (files.length > 0) log?.(`[Prover] Removed ${files.length} leftover prover files (${Math.round(bytes / 1048576)} MiB)`);
  } catch (e) {
    log?.(`[Prover] Could not clear ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface ProveRequest {
  circuitPath: string;
  srsPath: string;
  inputs: string[];
  vk: ArrayBuffer;
  /** Keccak transcript, for the Solidity verifier (every app proof). */
  onChain: boolean;
  timer: ProofTimer;
  log: (msg: string) => void;
  /**
   * Give up waiting after this much FOREGROUND time, with an error that says
   * so. The native job cannot be interrupted; this only stops the app from
   * waiting forever on a prover that never returns. Time in the background
   * does not count: Android freezes a backgrounded app, the prover with it,
   * and the proof simply continues when the person comes back.
   */
  watchdogMs: number;
}

/**
 * How much of one poll interval counts toward the watchdog: none while the
 * app is not in the foreground, and at most a few intervals for one gap (a
 * gap longer than that is the process having been frozen, not the prover
 * being slow).
 */
function foregroundShare(gapMs: number): number {
  let state: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    state = (require('react-native') as {AppState?: {currentState?: string}}).AppState?.currentState;
  } catch {
    state = undefined;
  }
  if (state !== undefined && state !== 'active') return 0;
  return Math.min(Math.max(gapMs, 0), POLL_MS * 4);
}

const toNumber = (v: bigint | number): number => (typeof v === 'bigint' ? Number(v) : v);

/** Prove on the native job thread; resolves with mopro's proof bytes. */
export async function proveOffThread(req: ProveRequest): Promise<ArrayBuffer> {
  const {timer, log} = req;
  await clearProverTempDir(log);

  let lowMemory = true;
  const tempDir = proverTempDir();
  try {
    if (!(await RNFS.exists(tempDir))) await RNFS.mkdir(tempDir);
    const free = (await RNFS.getFSInfo()).freeSpace;
    if (free < PROVER_DISK_BYTES) {
      lowMemory = false;
      log(`[Prover] Only ${Math.round(free / 1048576)} MiB free; proving in memory`);
    }
  } catch (e) {
    lowMemory = false;
    log(`[Prover] No prover directory (${e instanceof Error ? e.message : String(e)}); proving in memory`);
  }

  const options = {lowMemoryMode: lowMemory, tempDir: lowMemory ? tempDir : undefined, threads: undefined};
  timer.note(`prover options lowMemory=${lowMemory} threads=all`);
  const jobId = startNoirProof(req.circuitPath, req.srsPath, req.inputs, req.onChain, req.vk, options);

  let watched = 0;
  let last = Date.now();
  let seenPhases = 0;
  let lastPhase = '';
  for (;;) {
    await new Promise<void>(resolve => setTimeout(resolve, POLL_MS));
    const now = Date.now();
    watched += foregroundShare(now - last);
    last = now;
    const s = noirProofStatus(jobId);
    for (; seenPhases < s.phases.length; seenPhases++) {
      const p = s.phases[seenPhases];
      timer.record(`native:${p.name}`, toNumber(p.durationMs), `rss=${Math.round(toNumber(p.rssKbAfter) / 1024)}MiB`);
    }
    if (s.phase !== lastPhase && s.phase !== '') {
      lastPhase = s.phase;
      updateProofProgress({proverPhase: s.phase});
    }
    if (s.state === 'done') {
      timer.note(
        `native:total ${toNumber(s.elapsedMs)}ms peakRss=${Math.round(toNumber(s.peakRssKb) / 1024)}MiB ` +
          `peakSwap=${Math.round(toNumber(s.peakSwapKb) / 1024)}MiB`,
      );
      return takeNoirProof(jobId);
    }
    if (s.state === 'failed') {
      timer.note(`native:failed ${toNumber(s.elapsedMs)}ms`);
      // takeNoirProof throws the job's own error (MoproError.NoirError).
      return takeNoirProof(jobId);
    }
    if (watched > req.watchdogMs) {
      throw new Error(
        `The prover has not finished after ${Math.round(watched / 1000)} s ` +
          `(phase ${s.phase || 'unknown'}); stopped waiting.`,
      );
    }
  }
}
