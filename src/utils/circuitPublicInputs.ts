/**
 * How many public inputs a downloaded circuit has, computed once per file.
 *
 * mopro's getNumPublicInputsFromCircuit parses the whole circuit JSON
 * (decompressing its bytecode) on the JavaScript thread: 2.7-3.1 s per proof
 * for the 8.7 MB Android OIDC circuit on a Galaxy A23 (2026-10-29,
 * [ProofTiming] "circuit public input count"). The answer only changes when
 * the file does, so it is kept with the file's size and modification time
 * and recomputed when either differs -- a re-downloaded circuit is a new file.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {getNumPublicInputsFromCircuit} from 'mopro-ffi';

const keyFor = (circuitPath: string) => `@zkproofport:circuitPublicInputs:v1:${circuitPath}`;

export async function publicInputCountOf(
  circuitPath: string,
  count: (path: string) => number = getNumPublicInputsFromCircuit,
): Promise<number> {
  const stat = await RNFS.stat(circuitPath);
  const mtime = new Date(stat.mtime as unknown as string | number | Date).getTime();
  const stamp = Number.isFinite(mtime) ? `${Number(stat.size)}:${mtime}` : null;
  if (stamp !== null) {
    try {
      const stored = JSON.parse((await AsyncStorage.getItem(keyFor(circuitPath))) ?? 'null') as {stamp?: unknown; count?: unknown} | null;
      if (stored && stored.stamp === stamp && Number.isInteger(stored.count) && (stored.count as number) >= 0) {
        return stored.count as number;
      }
    } catch {
      // An unreadable record is recomputed below.
    }
  }
  const n = count(circuitPath);
  if (stamp !== null && Number.isInteger(n) && n >= 0) {
    await AsyncStorage.setItem(keyFor(circuitPath), JSON.stringify({stamp, count: n})).catch(() => {});
  }
  return n;
}
