import type {ErrorCode} from '../constants/errorCodes';

/**
 * A failure on the App Attest path, carrying the ErrorModal code the person
 * sees. The proof screen reads `code` instead of reporting every one of these
 * as a generic proof failure: "this phone cannot do App Attest", "Apple's
 * service did not answer" and "your Coinbase verification was revoked" ask
 * the person to do three different things.
 */
export class AppAttestError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppAttestError';
    this.code = code;
  }
}

/** The modal codes this path raises, by cause. One table, no default. */
export const APP_ATTEST_ERROR_CODE = Object.freeze({
  /** The device (or the simulator) has no App Attest. */
  unsupported: 'E2009',
  /** App Attest is iOS-only; Android key attestation is a later step. */
  platform: 'E2010',
  /** The Coinbase attestation is revoked: no assertion is made. */
  revoked: 'E2011',
  /** An object Apple returned, or the chain it carries, is not what the circuit takes. */
  malformed: 'E2014',
  /** Apple's App Attest service could not be reached to certify the key. */
  serviceUnavailable: 'E3006',
  /** The EAS lookup did not complete. */
  lookupFailed: 'E3002',
  /** No usable Coinbase attestation for this wallet. */
  notFound: 'E2005',
} satisfies Record<string, ErrorCode>);
