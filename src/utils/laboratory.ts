/**
 * The Laboratory switch (More > Laboratory), applied outside the screens.
 *
 * Which circuits it covers is the proof catalog's answer
 * (`isLaboratoryCircuit`), never a list kept here.
 */
import {ALL_CIRCUIT_IDS, type CircuitName} from '../config/circuitIds';
import {settingsStore} from '../stores/settingsStore';
import {isLaboratoryCircuit} from '../screens/proof/proofCatalog';

export const LABORATORY_CIRCUIT_IDS: readonly CircuitName[] = ALL_CIRCUIT_IDS.filter(isLaboratoryCircuit);

export type LaboratoryGate =
  | {allowed: true}
  | {allowed: false; code: 'E1008' | 'E5002'; reason: string};

/**
 * May a dApp's request for `circuit` go on to review?
 *
 * Rejects only for an id that is not a circuit (the catalog throws), which
 * `validateProofRequest` refuses before this runs; otherwise it resolves, so it
 * can run beside the relay check. A request for a
 * Laboratory proof while the switch is off is refused with E1008, which tells
 * the person where the switch is. When the settings cannot be read at all,
 * nobody knows what the person chose, so the request is refused with the
 * load-failure code rather than let through or blamed on the switch.
 */
export async function laboratoryRequestGate(circuit: CircuitName): Promise<LaboratoryGate> {
  if (!isLaboratoryCircuit(circuit)) return {allowed: true};
  let enabled: boolean;
  try {
    enabled = (await settingsStore.get()).laboratoryEnabled;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {allowed: false, code: 'E5002', reason: `Could not read the Laboratory setting: ${message}`};
  }
  if (enabled) return {allowed: true};
  return {
    allowed: false,
    code: 'E1008',
    reason: `'${circuit}' is a Laboratory proof and the Laboratory is turned off in More.`,
  };
}

/** The circuits to warm up at launch: every circuit, minus the Laboratory's while it is off. */
export function circuitsToPrefetch(circuits: readonly string[], laboratoryEnabled: boolean): string[] {
  if (typeof laboratoryEnabled !== 'boolean') {
    throw new Error(`laboratoryEnabled must be a boolean, got ${JSON.stringify(laboratoryEnabled)}.`);
  }
  return circuits.filter(id => laboratoryEnabled || !isLaboratoryCircuit(id));
}
