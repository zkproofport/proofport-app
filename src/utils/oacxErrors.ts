/**
 * OACX result codes that deserve their own modal instead of the mDL step's
 * generic E2001.
 *
 * OACX_NO_PARAM_PROVIDER ("인증사업자 값이 설정되지 않았습니다") is what the
 * raw-HTTP path (oacxClient runAppAuthFlow, a Developer Mode option) answers
 * when the verifier will not take the chosen card type on that path. It says
 * nothing about the default OmniOne CX widget path, which is a different flow.
 * The code reaches the failure text through oacxClient's assertSuccess.
 */
import type {ErrorCode} from '../constants/errorCodes';

const OACX_CODE_ERRORS: ReadonlyArray<{oacxCode: string; errorCode: ErrorCode}> = [
  {oacxCode: 'OACX_NO_PARAM_PROVIDER', errorCode: 'E2013'},
];

/** The specific code for an OACX failure, or null when the step's own code applies. */
export function errorCodeForOacxFailure(detail: string): ErrorCode | null {
  const hit = OACX_CODE_ERRORS.find(row => new RegExp(`\\b${row.oacxCode}\\b`).test(detail));
  return hit ? hit.errorCode : null;
}
