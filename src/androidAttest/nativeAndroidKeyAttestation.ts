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
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';

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
}

/** The rejection codes AndroidKeyAttestationModule.kt uses. */
export const ANDROID_NATIVE_CODE = Object.freeze({
  unsupported: 'ANDROIDATTEST_UNSUPPORTED',
  invalidInput: 'ANDROIDATTEST_INVALID_INPUT',
  keyGeneration: 'ANDROIDATTEST_KEYGEN_FAILED',
  emptyChain: 'ANDROIDATTEST_EMPTY_CHAIN',
  signing: 'ANDROIDATTEST_SIGN_FAILED',
});

/** The modal code for each native rejection. One table; an unknown code is reported as such. */
const MODAL_CODE_BY_NATIVE: Readonly<Record<string, string>> = Object.freeze({
  [ANDROID_NATIVE_CODE.unsupported]: ANDROID_ATTEST_ERROR_CODE.unavailable,
  [ANDROID_NATIVE_CODE.keyGeneration]: ANDROID_ATTEST_ERROR_CODE.unavailable,
  [ANDROID_NATIVE_CODE.emptyChain]: ANDROID_ATTEST_ERROR_CODE.unavailable,
  [ANDROID_NATIVE_CODE.signing]: ANDROID_ATTEST_ERROR_CODE.malformed,
  [ANDROID_NATIVE_CODE.invalidInput]: ANDROID_ATTEST_ERROR_CODE.malformed,
});

/**
 * The AppAttestError for a native rejection. A code the table does not hold
 * is still an error -- E2016, with the code in the message -- never a pass.
 */
export function androidNativeFailure(error: unknown): AppAttestError {
  const nativeCode = (error as {code?: unknown} | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof nativeCode === 'string' && Object.prototype.hasOwnProperty.call(MODAL_CODE_BY_NATIVE, nativeCode)) {
    return new AppAttestError(
      MODAL_CODE_BY_NATIVE[nativeCode] as AppAttestError['code'],
      `Android key attestation failed (${nativeCode}): ${message}`,
    );
  }
  return new AppAttestError(
    ANDROID_ATTEST_ERROR_CODE.malformed,
    `Android key attestation failed with an unknown code ${String(nativeCode)} (known: ${Object.keys(MODAL_CODE_BY_NATIVE).join(', ')}): ${message}`,
  );
}

export function getAndroidKeyAttestationNative(): AndroidKeyAttestationNative {
  if (Platform.OS !== 'android') {
    throw new Error(`Android key attestation runs on Android only; this is ${Platform.OS}.`);
  }
  const mod = NativeModules.AndroidKeyAttestation as AndroidKeyAttestationNative | undefined;
  if (!mod) {
    throw new AppAttestError(
      ANDROID_ATTEST_ERROR_CODE.unavailable,
      'This build has no AndroidKeyAttestation native module (AndroidKeyAttestationModule.kt).',
    );
  }
  return mod;
}
