import type {ErrorCode} from '../constants/errorCodes';

/**
 * A failure on a device-signer path -- App Attest on iPhone, Android key
 * attestation on Android -- carrying the ErrorModal code the person
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

/**
 * The codes the Android signer (src/androidAttest/*) raises, by cause. The
 * revocation lookup's own codes (revoked, lookupFailed, notFound) are the
 * App Attest table's: the lookup is the same on both platforms.
 */
export const ANDROID_ATTEST_ERROR_CODE = Object.freeze({
  /**
   * This phone cannot vouch for a statement the circuit accepts: no hardware
   * key attestation, a factory-provisioned chain (RSA root) or any chain other
   * than Remote Key Provisioning under Key Attestation CA1, a software key, an
   * unlocked bootloader or unverified boot, an app build not signed by Google
   * Play, or certificates not valid at the statement's time.
   */
  unavailable: 'E2015',
  /** The chain or signature the phone returned is not what the circuit takes. */
  malformed: 'E2016',
} satisfies Record<string, ErrorCode>);
