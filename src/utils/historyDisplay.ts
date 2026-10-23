/**
 * The text a History record carries, computed once when the record is saved.
 *
 * History reads only stored fields (src/screens/history/historyRecordText.ts)
 * so that a record outlives the circuit tables that described it -- an Arc
 * proof saved before Arc was removed must still show. The lookup happens
 * here, at save time, while the circuit is one this build serves.
 */
import type {CircuitName} from '../config/circuitIds';
import type {ProofHistoryItem} from '../stores/proofHistoryStore';
import {getProofRequestPresentation} from './proofRequestPresentation';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Title, icon key and condition rows for `circuit` with these inputs. A
 * presentation that cannot be built leaves the record without `display`; it
 * is then shown with its raw stored values. Saving the proof matters more
 * than its label.
 */
export function historyDisplay(
  circuit: CircuitName,
  inputs: Record<string, unknown>,
  t: Translate,
): ProofHistoryItem['display'] {
  try {
    const p = getProofRequestPresentation({circuit, inputs}, t);
    return {
      title: p.title,
      icon: p.icon,
      // Stored as JSON: only plain values survive the round trip, which is all
      // a condition row holds.
      conditions: JSON.parse(JSON.stringify(p.conditions)),
    };
  } catch (e) {
    console.log(`[History] no display text for ${circuit}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
