/**
 * What the proving screen shows while a proof runs: which stage, how much of
 * the circuit files has arrived, and how long proving usually takes on THIS
 * phone. One small store, written by the download and the prover, read by
 * the screen through `useProofProgress`.
 *
 * The estimate is this phone's own last time for the same circuit and signer
 * (kept in AsyncStorage when a proof finishes), never a number from another
 * device: a guess that is wrong by minutes is what makes a person give up.
 */
import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProofStage = 'idle' | 'download' | 'prepare' | 'prove' | 'done' | 'failed';

export interface ProofProgress {
  stage: ProofStage;
  /** Bytes of circuit files received in this attempt, and the total when known. */
  downloadedBytes: number;
  downloadTotalBytes: number | null;
  /** The prover's own phase ("load srs", "solve witness", "prove"), when proving. */
  proverPhase: string | null;
  /** Wall-clock ms when proving started (stage 'prove'), else null. */
  proveStartedAt: number | null;
  /** This phone's last proving time for this circuit+signer, ms, or null. */
  estimateMs: number | null;
  /** True after the app came back from the background during this proof. */
  wasInBackground: boolean;
}

const IDLE: ProofProgress = {
  stage: 'idle',
  downloadedBytes: 0,
  downloadTotalBytes: null,
  proverPhase: null,
  proveStartedAt: null,
  estimateMs: null,
  wasInBackground: false,
};

let state: ProofProgress = IDLE;
const listeners = new Set<(p: ProofProgress) => void>();

export function getProofProgress(): ProofProgress {
  return state;
}

export function updateProofProgress(patch: Partial<ProofProgress>): void {
  state = {...state, ...patch};
  listeners.forEach(l => l(state));
}

export function resetProofProgress(): void {
  state = IDLE;
  listeners.forEach(l => l(state));
}

export function subscribeProofProgress(listener: (p: ProofProgress) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The screen's view of the store, re-rendered on every change. */
export function useProofProgress(): ProofProgress {
  const [p, setP] = useState(state);
  useEffect(() => subscribeProofProgress(setP), []);
  return p;
}

const estimateKey = (circuit: string, variant: string) => `@zkproofport:proveMs:v1:${circuit}:${variant}`;

/** This phone's last proving time for the circuit and signer, or null. */
export async function loadProveEstimate(circuit: string, variant: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(estimateKey(circuit, variant));
    const ms = raw === null ? NaN : Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Remember how long proving took, for the next estimate. */
export async function saveProveEstimate(circuit: string, variant: string, ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    await AsyncStorage.setItem(estimateKey(circuit, variant), String(Math.round(ms)));
  } catch {
    // Only the next estimate is lost; the proof itself is unaffected.
  }
}
