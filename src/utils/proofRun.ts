/**
 * The two slow halves every proof hook shares, timed and shown on screen:
 * getting this circuit's files, and proving off the JavaScript thread.
 *
 * Files are fetched here and only here: a circuit's json/srs/vk (for this
 * phone's signer variant) arrive when a proof of THAT circuit starts, and are
 * kept for the next one (circuitDownload.ts owns the cache, the integrity
 * checks and the retries). Nothing downloads at launch.
 */
import {getEnvironment} from '../config/environment';
import {downloadCircuitFiles, type CircuitDownloadResult, type DownloadProgress} from './circuitDownload';
import {proveOffThread} from './noirProver';
import {
  getProofProgress,
  loadProveEstimate,
  saveProveEstimate,
  updateProofProgress,
} from './proofProgress';
import {activeProofTimer, keepScreenOn, startProofTimer, type ProofTimer} from './proofTiming';

/** The attempt's timer, or a fresh one for a hook driven without the screen. */
export function timerFor(circuit: string, log: (m: string) => void): ProofTimer {
  return activeProofTimer() ?? startProofTimer(circuit, log);
}

/**
 * This circuit's files, downloaded now if they are missing or stale, with the
 * bytes received shown on the proving screen.
 */
export async function circuitFilesForProof(
  circuit: string,
  log: (m: string) => void,
): Promise<CircuitDownloadResult> {
  const timer = timerFor(circuit, log);
  // Bytes of files already finished in this download, plus the current one.
  let finished = 0;
  let current = {name: '', bytes: 0};
  const onProgress = (p: DownloadProgress) => {
    if (p.fileName !== current.name) {
      finished += current.bytes;
      current = {name: p.fileName, bytes: 0};
    }
    current.bytes = p.bytesWritten;
    // "Downloading" only once bytes are actually arriving: a cached circuit
    // never shows it.
    updateProofProgress({stage: 'download', downloadedBytes: finished + current.bytes});
  };
  updateProofProgress({stage: 'prepare', downloadedBytes: 0, downloadTotalBytes: null});
  const files = await timer.step('circuit files', () => downloadCircuitFiles(circuit, getEnvironment(), onProgress, log));
  const received = finished + current.bytes;
  timer.note(received > 0 ? `circuit files downloaded ${received} bytes` : 'circuit files from cache');
  updateProofProgress({stage: 'prepare'});
  return files;
}

export interface ProveCircuitRequest {
  circuit: string;
  /** Which package proves it (app_attest / android / android_factory / standard). */
  variant: string;
  circuitPath: string;
  srsPath: string;
  inputs: string[];
  vk: ArrayBuffer;
  log: (m: string) => void;
}

/** No proof on any phone we measured takes this long; past it the app stops waiting and says so. */
const MIN_WATCHDOG_MS = 15 * 60 * 1000;

/**
 * Prove on the native job thread with the screen kept on, show the stage and
 * this phone's last time, and remember this time for the next estimate.
 */
export async function proveCircuit(req: ProveCircuitRequest): Promise<ArrayBuffer> {
  const timer = timerFor(req.circuit, req.log);
  const estimateMs = await loadProveEstimate(req.circuit, req.variant);
  updateProofProgress({
    stage: 'prove',
    proverPhase: null,
    proveStartedAt: Date.now(),
    estimateMs,
  });
  timer.note(`prove estimate ${estimateMs === null ? 'none' : `${estimateMs}ms`} (this phone's last ${req.circuit} ${req.variant})`);
  keepScreenOn(true);
  const started = Date.now();
  try {
    const proof = await timer.step('prove (native)', () =>
      proveOffThread({
        circuitPath: req.circuitPath,
        srsPath: req.srsPath,
        inputs: req.inputs,
        vk: req.vk,
        onChain: true,
        timer,
        log: req.log,
        watchdogMs: Math.max(MIN_WATCHDOG_MS, (estimateMs ?? 0) * 4),
      }),
    );
    // Not counted when the app spent part of it in the background: Android
    // may pause a backgrounded app, and that time says nothing about the phone.
    if (!getProofProgress().wasInBackground) {
      await saveProveEstimate(req.circuit, req.variant, Date.now() - started);
    }
    return proof;
  } finally {
    keepScreenOn(false);
  }
}
