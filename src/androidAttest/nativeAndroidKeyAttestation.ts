/**
 * The native Android key attestation call
 * (android/app/src/main/java/com/masselabs/zkproofport/AndroidKeyAttestationModule.kt),
 * behind an interface so the signer can be tested without a phone.
 *
 * `attestAndSign(statementBase64)` makes a FRESH P-256 key in the Android
 * Keystore (StrongBox when the phone has it, else the TEE) with the
 * attestation challenge SHA-256(statement), signs the statement with it
 * (SHA256withECDSA), returns the key's attestation chain and the signature,
 * and deletes the key. A fresh key per statement because the Remote Key
 * Provisioning attestation-key certificate in the chain lives about two
 * weeks; a stored key would outlive it.
 */
import {NativeModules, Platform} from 'react-native';
import {AppAttestError} from '../appAttest/appAttestError';
import type {DeviceCheckReason} from '../appAttest/deviceCheckReasons';

export interface AndroidAttestationResult {
  /** Base64 DER certificates, leaf first, as KeyStore.getCertificateChain returns them. */
  chain: string[];
  /** Base64 DER ECDSA-Sig-Value over the statement bytes (SHA256withECDSA). */
  signature: string;
  /** Whether the key was made in StrongBox (false: the TEE). */
  strongBox: boolean;
  /** android.os.Build.VERSION.SDK_INT. */
  sdkInt: number;
}

export interface AndroidKeyAttestationNative {
  attestAndSign(statementBase64: string): Promise<AndroidAttestationResult>;
  /**
   * A classic Play Integrity token for `nonceBase64Url` (base64url, no
   * padding): the encrypted JWE as Play returns it. Factory-provisioned
   * phones only.
   */
  requestIntegrityToken(nonceBase64Url: string): Promise<string>;
}

/** The rejection codes AndroidKeyAttestationModule.kt uses. */
export const ANDROID_NATIVE_CODE = Object.freeze({
  unsupported: 'ANDROIDATTEST_UNSUPPORTED',
  invalidInput: 'ANDROIDATTEST_INVALID_INPUT',
  keyGeneration: 'ANDROIDATTEST_KEYGEN_FAILED',
  emptyChain: 'ANDROIDATTEST_EMPTY_CHAIN',
  signing: 'ANDROIDATTEST_SIGN_FAILED',
  /** Play Integrity answered with an error worth retrying (network, rate limit, server). */
  integrityTransient: 'ANDROIDATTEST_INTEGRITY_TRANSIENT',
  /** Play Integrity cannot answer on this phone (no Play Store / services, outdated, not installed from Play). */
  integrityUnavailable: 'ANDROIDATTEST_INTEGRITY_UNAVAILABLE',
});

/** The reason (and so the modal code) for each native rejection. One table; an unknown code is reported as such. */
const REASON_BY_NATIVE: Readonly<Record<string, DeviceCheckReason>> = Object.freeze({
  [ANDROID_NATIVE_CODE.unsupported]: 'android_key_unsupported',
  [ANDROID_NATIVE_CODE.keyGeneration]: 'android_key_generation_failed',
  [ANDROID_NATIVE_CODE.emptyChain]: 'android_key_empty_chain',
  [ANDROID_NATIVE_CODE.signing]: 'android_key_signing_failed',
  [ANDROID_NATIVE_CODE.invalidInput]: 'android_key_invalid_input',
  [ANDROID_NATIVE_CODE.integrityTransient]: 'integrity_service_transient',
  [ANDROID_NATIVE_CODE.integrityUnavailable]: 'integrity_service_unavailable_on_device',
});

/**
 * The AppAttestError for a native rejection. A code the table does not hold
 * is still an error -- E2016, with the code in the message -- never a pass.
 */
export function androidNativeFailure(error: unknown): AppAttestError {
  const nativeCode = (error as {code?: unknown} | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof nativeCode === 'string' && Object.prototype.hasOwnProperty.call(REASON_BY_NATIVE, nativeCode)) {
    return new AppAttestError(REASON_BY_NATIVE[nativeCode], `Android key attestation failed (${nativeCode}): ${message}`);
  }
  return new AppAttestError(
    'android_key_unknown_native_failure',
    `Android key attestation failed with an unknown code ${String(nativeCode)} (known: ${Object.keys(REASON_BY_NATIVE).join(', ')}): ${message}`,
  );
}

export function getAndroidKeyAttestationNative(): AndroidKeyAttestationNative {
  if (Platform.OS !== 'android') {
    throw new Error(`Android key attestation runs on Android only; this is ${Platform.OS}.`);
  }
  const mod = NativeModules.AndroidKeyAttestation as AndroidKeyAttestationNative | undefined;
  if (!mod) {
    throw new AppAttestError(
      'android_native_module_missing',
      'This build has no AndroidKeyAttestation native module (AndroidKeyAttestationModule.kt).',
    );
  }
  return mod;
}
