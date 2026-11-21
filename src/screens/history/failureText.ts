import type {ProofFailure} from '../../stores/proofHistoryStore';
import {ErrorCodes} from '../../constants/errorCodes';

/**
 * The stored reason a failed attempt ended. A code this build has no row for
 * (a record written by a newer build) is shown as the bare code.
 */
export function failureText(failure: ProofFailure, t: (key: string) => string): string {
  if (failure.kind === 'cancelled') return t('host.history.detail.failureCancelled');
  if (!Object.prototype.hasOwnProperty.call(ErrorCodes, failure.code)) return failure.code;
  return `[${failure.code}] ${t(`host.errors.${failure.code}.title`)} - ${t(`host.errors.${failure.code}.description`)}`;
}
