import {isCircuitsReleaseMissingError} from '../config/deployments';
import type {ErrorCode} from '../constants/errorCodes';

/**
 * The launch-time verifier sync, and what a person is told when it fails.
 *
 * Offline or a GitHub hiccup: logged, and the cached / built-in addresses
 * answer, as before. A production build whose pinned circuits release does
 * not exist (CircuitsReleaseMissingError): E3007, because every proof this
 * build makes would be checked against a release that is not there, and no
 * retry fixes that.
 */
export async function syncDeploymentsAtLaunch(deps: {
  sync: () => Promise<boolean>;
  showError: (code: ErrorCode, details?: string) => void;
  log: (msg: string) => void;
}): Promise<void> {
  try {
    const updated = await deps.sync();
    deps.log(updated ? 'Deployment sync: addresses updated' : 'Deployment sync: using cached addresses');
  } catch (error) {
    if (isCircuitsReleaseMissingError(error)) {
      deps.log(`Deployment sync: ${error.message}`);
      deps.showError('E3007', error.message);
      return;
    }
    deps.log(`Deployment sync failed, using cached or built-in addresses: ${String(error)}`);
  }
}
