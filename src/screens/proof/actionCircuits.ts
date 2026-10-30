/**
 * Which circuits the action screen offers, given the one it was opened for.
 *
 * The circuits that can carry an action come from the SDK's table (with the
 * app's overrides, src/config/circuitIds.ts), not a list typed here: one of
 * those is how `giwa_attestation` sat unserved for a day after its circuit
 * could take an action. Only circuits on the same surface as the one opened
 * (Coinbase KYC on the Proof tab must not offer the Laboratory's).
 *
 * Circuits that need inputs of their own besides the action (Coinbase
 * Country's list, from the country screen) are offered only when the screen
 * was opened for them, and then alone: switching to or from one would start
 * a proof without the inputs it needs.
 */
import {ALL_CIRCUIT_IDS, CIRCUIT_ACTION_BINDING, type CircuitName} from '../../config/circuitIds';
import {isLaboratoryCircuit} from './proofCatalog';

export const CIRCUITS_WITH_OWN_INPUTS: readonly CircuitName[] = ['coinbase_country_attestation', 'human_passport_score'];

export const ACTION_CIRCUITS: readonly CircuitName[] = ALL_CIRCUIT_IDS.filter(
  id => CIRCUIT_ACTION_BINDING[id] !== 'none',
);

export function actionCircuitsFor(openedFor: CircuitName): CircuitName[] {
  if (!ACTION_CIRCUITS.includes(openedFor)) {
    throw new Error(`${openedFor} takes no action. Circuits that do: ${ACTION_CIRCUITS.join(', ')}.`);
  }
  if (CIRCUITS_WITH_OWN_INPUTS.includes(openedFor)) return [openedFor];
  return ACTION_CIRCUITS.filter(
    id => isLaboratoryCircuit(id) === isLaboratoryCircuit(openedFor) && !CIRCUITS_WITH_OWN_INPUTS.includes(id),
  );
}
