/**
 * The native App Attest calls (ios/ProofportApp/AppAttestModule.m), behind an
 * interface so the key lifecycle can be tested without a device.
 *
 * iOS only. Android's equivalent is Keystore key attestation
 * (src/androidAttest/*), proved by the Android packages of the same circuit
 * ids; asking for App Attest on Android is a bug and throws by name.
 */
import {NativeModules, Platform} from 'react-native';
import {AppAttestError} from './appAttestError';

export interface AppAttestNative {
  isSupported(): Promise<boolean>;
  generateKey(): Promise<string>;
  /** Resolves the attestation object, base64. */
  attestKey(keyId: string, clientDataHashBase64: string): Promise<string>;
  /** Resolves the assertion object, base64. */
  generateAssertion(keyId: string, clientDataHashBase64: string): Promise<string>;
}

/** The rejection codes AppAttestModule.m uses. */
export const NATIVE_CODE = Object.freeze({
  unsupported: 'APPATTEST_UNSUPPORTED',
  invalidInput: 'APPATTEST_INVALID_INPUT',
  invalidKey: 'APPATTEST_INVALID_KEY',
  serverUnavailable: 'APPATTEST_SERVER_UNAVAILABLE',
  unknownFailure: 'APPATTEST_UNKNOWN_FAILURE',
});

export function nativeCodeOf(error: unknown): string | undefined {
  const code = (error as {code?: unknown} | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function getAppAttestNative(): AppAttestNative {
  if (Platform.OS !== 'ios') {
    // Not a person's error: on Android the statement goes to the Android
    // signer (src/androidAttest/*); asking for App Attest there is a bug.
    throw new Error(`App Attest is iOS-only; this is ${Platform.OS}. The Android signer is src/androidAttest/androidSigner.ts.`);
  }
  const mod = NativeModules.AppAttest as AppAttestNative | undefined;
  if (!mod) {
    throw new AppAttestError(
      'ios_native_module_missing',
      'This build has no AppAttest native module (ios/ProofportApp/AppAttestModule.m).',
    );
  }
  return mod;
}
