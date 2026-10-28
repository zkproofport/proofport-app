/**
 * The Android phone as a statement signer: one call takes the statement
 * bytes (the 313-byte OIDC provider-key statement or the 225-byte Coinbase
 * KYC v2 clientData) and returns the Android packages' signer inputs --
 * statement_sig and the AndroidChain -- or throws an AppAttestError whose
 * code is the ErrorModal to show (E2015 / E2016).
 *
 *   1. native attestAndSign: a fresh hardware key, attested, signs the
 *      statement (SHA256withECDSA), then is deleted
 *   2. requireAcceptableAndroidChain: what the circuit would refuse about the
 *      chain, the key or this build, refused now with the reason
 *   3. androidChainInputs: the chain as the circuit's inputs (mirror of
 *      circuits' chain.js)
 *   4. statement_sig: the DER signature as r || s with s in low form (the
 *      circuit's P-256 check refuses a high s; n - s is the same signature)
 *
 * The signature is NOT verified against the leaf key here: the app has no
 * P-256 implementation among its own dependencies (only transitive copies),
 * and the circuit verifies it. A phone whose keystore signed with another key
 * than it attested would fail in the prover.
 */
import {ethers} from 'ethers';
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {N_P256} from '../appAttest/constants';
import {DerError, ecdsaDerToLowS} from '../appAttest/der';
import {androidChainInputs, GOOGLE_KEY_ATTESTATION_CA1} from '../utils/androidKeyAttestation';
import {requireAcceptableAndroidChain, ZKPROOFPORT_ANDROID_APP, type AndroidAppIdentity} from './androidChainChecks';
import type {AndroidSignerInputs} from './androidSignerInputs';
import {
  androidNativeFailure,
  getAndroidKeyAttestationNative,
  type AndroidAttestationResult,
  type AndroidKeyAttestationNative,
} from './nativeAndroidKeyAttestation';

export interface AndroidSignOptions {
  /** Unix seconds the statement claims (OIDC `now`, Coinbase `attested_at`). */
  now: number;
  log: (msg: string) => void;
  /**
   * What the circuit pins: the app identity (ZKPROOFPORT_ANDROID_APP) and the
   * root key (GOOGLE_KEY_ATTESTATION_CA1) in the app, the ones a synthetic
   * chain carries in a test. Required, so a test cannot quietly check against
   * one set while the app uses another.
   */
  trust: {app: AndroidAppIdentity; rootKey: Uint8Array};
  /** Tests only: a fake native module. */
  native?: AndroidKeyAttestationNative;
}

/** The trust anchors the Android circuits pin. */
export const ANDROID_CIRCUIT_TRUST = Object.freeze({app: ZKPROOFPORT_ANDROID_APP, rootKey: GOOGLE_KEY_ATTESTATION_CA1});

function decodeBase64(value: unknown, what: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, `${what} is not a base64 string`);
  }
  try {
    return ethers.utils.base64.decode(value);
  } catch (e) {
    throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, `${what} is not base64: ${String(e)}`);
  }
}

/** The native result as DER bytes, refusing anything that is not that shape. */
function decodeResult(result: AndroidAttestationResult): {chain: Uint8Array[]; signature: Uint8Array} {
  if (!result || !Array.isArray(result.chain)) {
    throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, `Android key attestation returned no chain: ${JSON.stringify(result)}`);
  }
  if (result.chain.length === 0) {
    throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.unavailable, 'Android key attestation returned an empty certificate chain');
  }
  return {
    chain: result.chain.map((c, i) => decodeBase64(c, `certificate ${i}`)),
    signature: decodeBase64(result.signature, 'the statement signature'),
  };
}

/** Sign `statement` with a fresh attested Android key and return the circuit's signer inputs. */
export async function signStatementOnAndroid(statement: Uint8Array, opts: AndroidSignOptions): Promise<AndroidSignerInputs> {
  const native = opts.native ?? getAndroidKeyAttestationNative();
  const {app, rootKey} = opts.trust;
  const log = opts.log;

  log(`[AndroidAttest] Making a fresh attested key to sign the ${statement.length}-byte statement`);
  let result: AndroidAttestationResult;
  try {
    result = await native.attestAndSign(ethers.utils.base64.encode(statement));
  } catch (e) {
    throw androidNativeFailure(e);
  }
  const {chain, signature} = decodeResult(result);
  log(
    `[AndroidAttest] Key made in ${result.strongBox ? 'StrongBox' : 'the TEE'} (SDK ${result.sdkInt}); ` +
      `chain of ${chain.length} certificates (${chain.map(c => c.length).join(', ')} bytes)`,
  );

  const summary = requireAcceptableAndroidChain(chain, {now: opts.now, app, rootKey});
  log(`[AndroidAttest] Chain accepted: key in ${summary.securityLevel}, attestation version ${summary.attestationVersion}`);

  const inputs = androidChainInputs(chain, rootKey);
  let statementSig: Uint8Array;
  try {
    statementSig = ecdsaDerToLowS(signature, 32, N_P256);
  } catch (e) {
    if (e instanceof DerError) {
      throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, `The statement signature is not a P-256 ECDSA signature: ${e.message}`);
    }
    throw e;
  }
  log(
    `[AndroidAttest] Signer inputs ready: TBS lengths CA2 ${inputs.ca2_tbs_len}, CA3 ${inputs.ca3_tbs_len}, ` +
      `attestation key ${inputs.att_tbs_len}, leaf ${inputs.leaf_tbs_len}`,
  );

  return {
    variant: 'android',
    statement_sig: statementSig,
    ca2_tbs: inputs.ca2_tbs,
    ca2_tbs_len: inputs.ca2_tbs_len,
    ca2_sig: inputs.ca2_sig,
    ca3_tbs: inputs.ca3_tbs,
    ca3_tbs_len: inputs.ca3_tbs_len,
    ca3_sig: inputs.ca3_sig,
    att_tbs: inputs.att_tbs,
    att_tbs_len: inputs.att_tbs_len,
    att_sig: inputs.att_sig,
    leaf_tbs: inputs.leaf_tbs,
    leaf_tbs_len: inputs.leaf_tbs_len,
    leaf_sig: inputs.leaf_sig,
  };
}
