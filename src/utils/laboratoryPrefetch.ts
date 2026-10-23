/**
 * Download the Laboratory's circuits in the background once the switch is
 * turned on, so a first lab proof after that does not wait on a cold download.
 *
 * Best effort and never rejects: every lab proof hook calls
 * `downloadCircuitFiles` itself before proving (useGiwaKyc,
 * useDojangPlayground, useMdlKr), and that is where a failed download reaches
 * the person, as E2002. A failure here is logged in full and nothing else.
 */
import {getEnvironment} from '../config/environment';
import {downloadCircuitFiles} from './circuitDownload';
import {LABORATORY_CIRCUIT_IDS} from './laboratory';

export async function prefetchLaboratoryCircuits(
  download: typeof downloadCircuitFiles = downloadCircuitFiles,
): Promise<void> {
  const env = getEnvironment();
  // Each call is wrapped so a synchronous throw lands in allSettled too.
  const results = await Promise.allSettled(
    LABORATORY_CIRCUIT_IDS.map(async circuit => download(circuit, env, undefined, message => console.log(message))),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[laboratory] background download of ${LABORATORY_CIRCUIT_IDS[index]} failed: ${reason}`);
    }
  });
}
