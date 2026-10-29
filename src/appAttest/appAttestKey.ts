/**
 * The App Attest key's life on this install: generate and attest it once, keep
 * it, sign with it, start over only when Apple says the key is gone.
 *
 * Apple's rules, from "Establishing your app's integrity" and the
 * DCAppAttestService pages (developer.apple.com/documentation/devicecheck):
 *   - record the key id at once: there is no way to get it back later;
 *   - `attestKey` reaches Apple's servers and is meant once per key; on
 *     `serverUnavailable` retry later with the SAME key and SAME
 *     clientDataHash; on any other error discard the key and make a new one;
 *   - keys survive app updates but not reinstalling, device migration or a
 *     restore from backup -- start over then;
 *   - `invalidKey` is what a lost, unattested or rejected key returns.
 *
 * Storage is AsyncStorage on purpose. It is deleted with the app, exactly like
 * the Secure Enclave key, so a reinstall starts clean. The keychain survives a
 * reinstall and would hand back an id whose key no longer exists. A restore
 * from backup can still bring back a stale id; `generateAssertion` then fails
 * with `invalidKey`, and that path regenerates.
 *
 * What is stored is not secret: the key id and the attestation object are
 * useless without the Secure Enclave key, which never leaves the device.
 *
 * CLIENT DATA HASH FOR attestKey. Apple uses it to bind a server's one-time
 * challenge. There is no server here: the circuit checks only that
 * SHA256(authData || clientDataHash) is the certificate's nonce, and it takes
 * the hash privately as `att_client_data_hash: [u8; 32]`. So it is derived
 * from the key id -- SHA256("ZKProofport/AA/attest/1" || keyId) -- which makes
 * a retry after `serverUnavailable` use the same value, as Apple asks, and is
 * always 32 bytes, as the circuit needs. Freshness comes from each proof's
 * assertion (timestamp, request digest, scope), not from this.
 */
import {timed} from '../utils/proofTiming';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ethers} from 'ethers';
import {AppAttestError, APP_ATTEST_ERROR_CODE} from './appAttestError';
import {base64ToBytes, decodeAssertion, sha256, toCircuitCredential, type CircuitAssertion, type CircuitCredential} from './appAttestObjects';
import {APP_ATTEST_APP_ID, APPLE_APP_ATTEST_CA1_KEY_HASH} from './constants';
import {NATIVE_CODE, nativeCodeOf, type AppAttestNative} from './nativeAppAttest';

export const APP_ATTEST_KEY_STORAGE = '@zkproofport:appAttest:key:v1';
const ATTEST_HASH_LABEL = 'ZKProofport/AA/attest/1';

export interface KeyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AppAttestDeps {
  native: AppAttestNative;
  storage?: KeyStorage;
  log: (msg: string) => void;
  /** The App ID and pinned CA; tests replace them to run synthetic chains. */
  appId?: string;
  pinnedCaKeyHash?: string;
  /** This build, `version(build)`; tests set it. Defaults to the native values. */
  buildId?: string;
}

interface StoredKey {
  keyId: string;
  /** base64 of the clientDataHash given to attestKey. */
  attestClientDataHash: string;
  /** base64 attestation object, once Apple has certified the key. */
  attestation?: string;
  /**
   * The build (`version(build)`) that attested it. A key's environment is
   * fixed when it is attested, by the entitlement of the build running then;
   * the record survives an app update, so a development key attested by a
   * locally signed build would otherwise be reused by the TestFlight or App
   * Store build installed over it. Absent on records from before 1.4.6.
   */
  attestedByBuild?: string;
}

export interface AttestedKey {
  keyId: string;
  credential: CircuitCredential;
}

const b64 = (b: Uint8Array) => ethers.utils.base64.encode(b);

export function attestClientDataHash(keyId: string): Uint8Array {
  return sha256(Uint8Array.from([...ethers.utils.toUtf8Bytes(ATTEST_HASH_LABEL), ...base64ToBytes(keyId)]));
}

function currentBuildId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {getVersion, getBuildNumber} = require('../utils/version') as typeof import('../utils/version');
  return `${getVersion()}(${getBuildNumber()})`;
}

function settings(deps: AppAttestDeps) {
  return {
    storage: deps.storage ?? (AsyncStorage as KeyStorage),
    appId: deps.appId ?? APP_ATTEST_APP_ID,
    pinned: deps.pinnedCaKeyHash ?? APPLE_APP_ATTEST_CA1_KEY_HASH,
    buildId: deps.buildId ?? currentBuildId(),
  };
}

async function readStored(storage: KeyStorage, log: (m: string) => void): Promise<StoredKey | null> {
  const raw = await storage.getItem(APP_ATTEST_KEY_STORAGE);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.keyId === 'string' && typeof v.attestClientDataHash === 'string'
      && (v.attestation === undefined || typeof v.attestation === 'string')
      && (v.attestedByBuild === undefined || typeof v.attestedByBuild === 'string')) {
      return v;
    }
  } catch {
    // Unreadable is treated like absent, below, and replaced.
  }
  log('[AppAttest] Stored key record is unreadable; discarding it');
  await storage.removeItem(APP_ATTEST_KEY_STORAGE);
  return null;
}

/** Remove the stored key, but only if it is still the one that failed. */
async function discard(storage: KeyStorage, keyId: string, log: (m: string) => void): Promise<void> {
  const current = await storage.getItem(APP_ATTEST_KEY_STORAGE);
  if (current === null) return;
  try {
    if (JSON.parse(current).keyId !== keyId) return;
  } catch {
    // An unreadable record is not worth keeping either.
  }
  log(`[AppAttest] Discarding key ${keyId}`);
  await storage.removeItem(APP_ATTEST_KEY_STORAGE);
}

function mapNativeError(error: unknown, during: string): AppAttestError {
  if (error instanceof AppAttestError) return error;
  const code = nativeCodeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (code === NATIVE_CODE.unsupported) {
    return new AppAttestError(APP_ATTEST_ERROR_CODE.unsupported, `App Attest is not supported on this device (${during}): ${message}`);
  }
  if (code === NATIVE_CODE.serverUnavailable) {
    return new AppAttestError(
      APP_ATTEST_ERROR_CODE.serviceUnavailable,
      `Apple's App Attest service could not be reached (${during}): ${message}`,
    );
  }
  return new AppAttestError(APP_ATTEST_ERROR_CODE.malformed, `App Attest ${during} failed (${code ?? 'no code'}): ${message}`);
}

async function createAndAttest(deps: AppAttestDeps, existing: StoredKey | null, freshKeyRetry: boolean): Promise<AttestedKey> {
  const {storage, appId, pinned, buildId} = settings(deps);
  const {native, log} = deps;

  let record = existing;
  if (!record) {
    let keyId: string;
    try {
      keyId = await native.generateKey();
    } catch (e) {
      throw mapNativeError(e, 'key generation');
    }
    record = {keyId, attestClientDataHash: b64(attestClientDataHash(keyId))};
    // Before attesting: if Apple is unreachable the same key is retried later.
    await storage.setItem(APP_ATTEST_KEY_STORAGE, JSON.stringify(record));
    log(`[AppAttest] Generated key ${keyId}`);
  } else {
    log(`[AppAttest] Retrying attestation of key ${record.keyId}`);
  }

  let attestation: string;
  try {
    attestation = await timed('ios: App Attest key attestation', () => native.attestKey(record.keyId, record.attestClientDataHash));
  } catch (e) {
    const code = nativeCodeOf(e);
    if (code === NATIVE_CODE.serverUnavailable) {
      // Keep the key: Apple asks for a retry with the same inputs.
      throw mapNativeError(e, 'attestation');
    }
    if (code === NATIVE_CODE.unsupported) throw mapNativeError(e, 'attestation');
    await discard(storage, record.keyId, log);
    // invalidKey here means the stored key was attested already (the app
    // stopped before saving the result) or is gone. One fresh key, once.
    if (code === NATIVE_CODE.invalidKey && freshKeyRetry) {
      return createAndAttest(deps, null, false);
    }
    throw mapNativeError(e, 'attestation');
  }

  let credential: CircuitCredential;
  try {
    credential = toCircuitCredential(
      base64ToBytes(attestation), record.keyId, base64ToBytes(record.attestClientDataHash), appId, pinned,
    );
  } catch (e) {
    await discard(storage, record.keyId, log);
    throw e;
  }
  await storage.setItem(APP_ATTEST_KEY_STORAGE, JSON.stringify({...record, attestation, attestedByBuild: buildId}));
  log(`[AppAttest] Key ${record.keyId} attested by ${buildId} (${credential.production ? 'production' : 'development'} environment)`);
  return {keyId: record.keyId, credential};
}

async function loadOrCreate(deps: AppAttestDeps): Promise<AttestedKey> {
  const {storage, appId, pinned, buildId} = settings(deps);
  let supported: boolean;
  try {
    supported = await deps.native.isSupported();
  } catch (e) {
    throw mapNativeError(e, 'support check');
  }
  if (!supported) {
    throw new AppAttestError(
      APP_ATTEST_ERROR_CODE.unsupported,
      'App Attest is not supported on this device (DCAppAttestService.isSupported is false; the simulator never supports it).',
    );
  }
  const stored = await readStored(storage, deps.log);
  if (stored?.attestation) {
    try {
      const credential = toCircuitCredential(
        base64ToBytes(stored.attestation), stored.keyId, base64ToBytes(stored.attestClientDataHash), appId, pinned,
      );
      // A development key attested by ANOTHER build (or by one that did not
      // record itself) is not evidence about this one: a TestFlight build
      // installed over a locally signed one inherits the record. Attest a
      // fresh key once; this build's entitlement decides its environment. A
      // development key this very build attested is kept -- re-attesting it
      // would only ask Apple again for the same answer -- and the proof code
      // refuses it (E2014). A production key is kept whichever build made it:
      // it is what every circuit accepts.
      if (!credential.production && stored.attestedByBuild !== buildId) {
        deps.log(
          `[AppAttest] Stored key ${stored.keyId} is a development key attested by ` +
            `${stored.attestedByBuild ?? 'an earlier build'}, not ${buildId}; attesting a fresh key`,
        );
        await discard(storage, stored.keyId, deps.log);
        return createAndAttest(deps, null, true);
      }
      return {keyId: stored.keyId, credential};
    } catch (e) {
      deps.log(`[AppAttest] Stored attestation no longer fits the circuit: ${e instanceof Error ? e.message : String(e)}`);
      await discard(storage, stored.keyId, deps.log);
      return createAndAttest(deps, null, true);
    }
  }
  return createAndAttest(deps, stored, true);
}

let inFlight: Promise<AttestedKey> | null = null;

/**
 * The attested key, creating it when there is none. Concurrent callers share
 * one attempt, so two proofs started together cannot attest two keys (each
 * `attestKey` is a call to Apple and a key counted against this device).
 */
export function ensureAttestedKey(deps: AppAttestDeps): Promise<AttestedKey> {
  if (!inFlight) {
    inFlight = loadOrCreate(deps).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export interface AssertionResult {
  keyId: string;
  credential: CircuitCredential;
  assertion: CircuitAssertion;
}

/**
 * Sign `clientData` with the attested key. A key Apple no longer recognises
 * (`invalidKey`: reinstall-like restore, a key the service rejected) is
 * replaced once and the assertion retried; a second refusal is reported.
 */
export async function assertClientData(deps: AppAttestDeps, clientData: Uint8Array): Promise<AssertionResult> {
  const {storage, appId} = settings(deps);
  const hash = b64(sha256(clientData));
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = await ensureAttestedKey(deps);
    let raw: string;
    try {
      raw = await timed('ios: App Attest assertion', () => deps.native.generateAssertion(key.keyId, hash));
    } catch (e) {
      if (nativeCodeOf(e) === NATIVE_CODE.invalidKey && attempt === 0) {
        deps.log(`[AppAttest] Key ${key.keyId} was refused for an assertion; replacing it`);
        await discard(storage, key.keyId, deps.log);
        continue;
      }
      throw mapNativeError(e, 'assertion');
    }
    return {keyId: key.keyId, credential: key.credential, assertion: decodeAssertion(base64ToBytes(raw), appId)};
  }
  throw new AppAttestError(APP_ATTEST_ERROR_CODE.malformed, 'App Attest refused a freshly attested key for an assertion.');
}

/** Test seam: forget an in-flight attempt left over by another test. */
export function __resetAppAttestKeyForTests(): void {
  inFlight = null;
}
