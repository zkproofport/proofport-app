/**
 * Per-step timing and memory for a proof, under one grep-able prefix.
 *
 *   adb logcat -s ReactNativeJS | grep '\[ProofTiming\]'
 *
 * Every line is `[ProofTiming] <attempt> <step> <start|end|fail> ...` with the
 * duration in ms and the app's memory (pss/rss/swap on Android, footprint on
 * iOS) taken by the ProofRuntime native module. Step names and numbers only:
 * no token, address, nullifier or input ever goes into a line, so the log is
 * safe to share as it is (CLAUDE.md: personal values are masked).
 *
 * The lines go to console (logcat / the Xcode console) always, and to the
 * attempt's own log when one is given (the live panel and the History copy).
 */

export const PROOF_TIMING_PREFIX = '[ProofTiming]';

export interface MemorySnapshot {
  pssKb?: number;
  rssKb?: number;
  swapKb?: number;
  availMemKb?: number;
  lowMemory?: boolean;
  footprintKb?: number;
}

interface ProofRuntimeNative {
  memorySnapshot(): Promise<MemorySnapshot>;
  setKeepScreenOn(on: boolean): void;
  totalMemKb?: number;
  cpuCount?: number;
}

/*
 * Read lazily: this module is imported by input builders that also run in
 * plain Node (their tests, and the circuits reference comparison), where
 * there is no react-native to import.
 */
function nativeRuntime(): ProofRuntimeNative | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require('react-native') as {NativeModules?: {ProofRuntime?: ProofRuntimeNative}};
    return rn.NativeModules?.ProofRuntime ?? null;
  } catch {
    return null;
  }
}

/** The app's memory now, or null when the module is missing or fails. */
export async function memorySnapshot(): Promise<MemorySnapshot | null> {
  const m = nativeRuntime();
  if (!m) return null;
  try {
    return await m.memorySnapshot();
  } catch {
    return null;
  }
}

/** Keep the screen on while proving (no lock, no stopped activity). */
export function keepScreenOn(on: boolean): void {
  try {
    nativeRuntime()?.setKeepScreenOn(on);
  } catch {
    // A missing module only means the screen may lock; the proof is unaffected.
  }
}

/** The phone's total RAM in KiB and core count, when the module reports them. */
export function deviceProfile(): {totalMemKb: number | null; cpuCount: number | null} {
  const m = nativeRuntime();
  return {
    totalMemKb: typeof m?.totalMemKb === 'number' ? m.totalMemKb : null,
    cpuCount: typeof m?.cpuCount === 'number' ? m.cpuCount : null,
  };
}

const mib = (kb: number | undefined) => (typeof kb === 'number' && kb >= 0 ? `${Math.round(kb / 1024)}MiB` : '?');

/** `pss=812MiB rss=903MiB swap=0MiB avail=1210MiB` -- only the fields present. */
export function formatMemory(m: MemorySnapshot | null): string {
  if (!m) return 'mem=unavailable';
  const parts: string[] = [];
  if (m.pssKb !== undefined) parts.push(`pss=${mib(m.pssKb)}`);
  if (m.footprintKb !== undefined) parts.push(`footprint=${mib(m.footprintKb)}`);
  if (m.rssKb !== undefined) parts.push(`rss=${mib(m.rssKb)}`);
  if (m.swapKb !== undefined) parts.push(`swap=${mib(m.swapKb)}`);
  if (m.availMemKb !== undefined) parts.push(`avail=${mib(m.availMemKb)}`);
  if (m.lowMemory) parts.push('lowMemory');
  return parts.join(' ');
}

export interface ProofTimer {
  /** Short attempt label carried by every line. */
  readonly attempt: string;
  /** Run `fn` as step `name`: start, then end with ms and memory, or fail. */
  step<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  /** One line for something timed elsewhere (a native phase). */
  record(name: string, ms: number, extra?: string): void;
  /** A free-form line under the prefix. */
  note(text: string): void;
  /** ms since the timer started. */
  elapsed(): number;
}

type Clock = () => number;

/**
 * A timer for one proof attempt. `log` is the attempt's addLog (optional);
 * `memory` and `clock` are seams for tests.
 */
export function startProofTimer(
  label: string,
  log?: (msg: string) => void,
  deps: {memory?: () => Promise<MemorySnapshot | null>; clock?: Clock; console?: (msg: string) => void} = {},
): ProofTimer {
  const clock = deps.clock ?? Date.now;
  const memory = deps.memory ?? memorySnapshot;
  const out = deps.console ?? ((msg: string) => console.log(msg));
  const t0 = clock();
  const attempt = `${label}#${t0.toString(36)}`;
  const emit = (line: string) => {
    const text = `${PROOF_TIMING_PREFIX} ${attempt} ${line}`;
    out(text);
    log?.(text);
  };

  return {
    attempt,
    elapsed: () => clock() - t0,
    note: (text: string) => emit(text),
    record: (name: string, ms: number, extra?: string) =>
      emit(`${name} end ${Math.round(ms)}ms${extra ? ` ${extra}` : ''}`),
    async step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
      const start = clock();
      emit(`${name} start at=${start - t0}ms`);
      try {
        const value = await fn();
        emit(`${name} end ${clock() - start}ms ${formatMemory(await memory())}`);
        return value;
      } catch (e) {
        emit(`${name} fail ${clock() - start}ms ${formatMemory(await memory())}`);
        throw e;
      }
    },
  };
}

/*
 * The attempt's timer, for code several calls below the screen (the Android
 * signer, the Play Integrity request) that has no timer passed to it. Set by
 * the proving screen when an attempt starts and cleared when it ends; with
 * none set, `timed` just runs the step.
 */
let activeTimer: ProofTimer | null = null;

export function setActiveProofTimer(timer: ProofTimer | null): void {
  activeTimer = timer;
}

export function activeProofTimer(): ProofTimer | null {
  return activeTimer;
}

/** Run `fn` as a step of the active attempt, if there is one. */
export function timed<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const timer = activeTimer;
  if (!timer) return Promise.resolve().then(fn);
  return timer.step(name, fn);
}
