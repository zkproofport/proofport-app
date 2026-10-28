/**
 * A proof that was running when the app died is told about on the next launch.
 *
 * The proof runs inside the app's process. When Android kills that process
 * for memory (a 2^21 proof holds about 2 GB on a 4 GB phone) or the person
 * swipes the app away, nothing in the process gets to say so. So a small
 * record is written when proving starts and removed when the attempt ends,
 * either way; a record still there at launch is a proof that was cut off.
 * The launch then shows E2019, marks the History entry failed, and (through
 * relayAnswer's open-request record, marked by markOpenRequestProving) answers
 * a relay request with E2019.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@zkproofport:proof:inFlight:v1';

export interface InFlightProof {
  circuit: string;
  startedAt: number;
  historyId: string | null;
  requestId: string | null;
}

export async function markProofInFlight(proof: InFlightProof): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(proof));
  } catch (e) {
    console.error('[ProofInFlight] Could not record the running proof:', e);
  }
}

export async function clearProofInFlight(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.error('[ProofInFlight] Could not clear the running-proof record:', e);
  }
}

/** The proof an earlier run left running, removed as it is read; null when none. */
export async function takeInterruptedProof(): Promise<InFlightProof | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY);
    if (raw !== null) await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.error('[ProofInFlight] Could not read the running-proof record:', e);
    return null;
  }
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw) as Partial<InFlightProof>;
    if (typeof p.circuit !== 'string' || typeof p.startedAt !== 'number') {
      console.error(`[ProofInFlight] Malformed running-proof record: ${raw}`);
      return null;
    }
    return {
      circuit: p.circuit,
      startedAt: p.startedAt,
      historyId: typeof p.historyId === 'string' ? p.historyId : null,
      requestId: typeof p.requestId === 'string' ? p.requestId : null,
    };
  } catch {
    console.error(`[ProofInFlight] Unreadable running-proof record: ${raw}`);
    return null;
  }
}
