import type {ErrorCode} from '../constants/errorCodes';
import {deviceCheckCode, type DeviceCheckReason} from './deviceCheckReasons';

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
  /** The precise cause, neutral (src/appAttest/deviceCheckReasons.ts); the code follows from it. */
  readonly reason: DeviceCheckReason;

  constructor(reason: DeviceCheckReason, message: string) {
    super(message);
    this.name = 'AppAttestError';
    this.code = deviceCheckCode(reason);
    this.reason = reason;
  }
}

/**
 * Throw for `reason`, which must belong to `expected`: a refusal helper of
 * one E-code that is handed another code's reason is a mistake in this app,
 * said as such rather than shown as the wrong modal.
 */
export function refuseWith(expected: ErrorCode, reason: DeviceCheckReason, message: string): never {
  const code = deviceCheckCode(reason);
  if (code !== expected) {
    throw new Error(`Device-check reason '${reason}' is ${code}, not ${expected}: ${message}`);
  }
  throw new AppAttestError(reason, message);
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
  /**
   * Factory-provisioned phones only: the Play Integrity verdict says this app
   * is not the store's build or this phone does not meet device integrity.
   */
  integrityNotMet: 'E2017',
  /**
   * No verifier contract exists for this phone's Android package of the
   * circuit in this build (src/config/variantVerifiers.ts), so a proof could
   * not be checked by anyone: refused before proving.
   */
  noVerifier: 'E2018',
  /**
   * The device check could not be made now: Play Integrity's service or the
   * relay that decrypts its answer did not answer, rate-limited, or is not
   * configured. Worth trying again later; nothing is wrong with the phone.
   */
  checkUnavailable: 'E3008',
} satisfies Record<string, ErrorCode>);
