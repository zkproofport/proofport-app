/**
 * At launch: a proof an earlier run left running (proofInFlight.ts) is
 * reported -- the ErrorModal (E2019), its History entry marked failed, and
 * the prover's leftover files removed. A relay request it was answering gets
 * E2019 from answerRequestsLeftOpen (relayAnswer.ts), not from here.
 */
import {proofHistoryStore} from '../stores';
import {showGlobalError} from './errorBridge';
import {clearProverTempDir} from './noirProver';
import {takeInterruptedProof} from './proofInFlight';

export async function reportInterruptedProof(): Promise<boolean> {
  const proof = await takeInterruptedProof();
  await clearProverTempDir(m => console.log(m));
  if (!proof) return false;
  const seconds = Math.round((Date.now() - proof.startedAt) / 1000);
  console.log(
    `[ProofTiming] interrupted ${proof.circuit} started ${new Date(proof.startedAt).toISOString()} ` +
      `(${seconds}s before this launch) request=${proof.requestId ?? 'in-app'}`,
  );
  if (proof.historyId) {
    await proofHistoryStore
      .update(proof.historyId, {overallStatus: 'failed', offChainStatus: 'failed', onChainStatus: 'failed'})
      .catch(e => console.error('[InterruptedProof] Could not mark History failed:', e));
  }
  showGlobalError('E2019', `${proof.circuit}, started ${new Date(proof.startedAt).toISOString()}`);
  return true;
}
