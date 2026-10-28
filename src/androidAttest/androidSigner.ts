/**
 * The Android phone as a statement signer: one call takes the statement
 * bytes (the 313-byte OIDC provider-key statement or the 225-byte Coinbase
 * KYC v2 clientData) and returns the signer inputs of the circuit this phone
 * proves with -- or throws an AppAttestError whose code is the ErrorModal to
 * show (E2015 / E2016 / E2017 / E3008).
 *
 *   1. native attestAndSign: a fresh hardware key, attested, signs the
 *      statement (SHA256withECDSA), then is deleted
 *   2. classifyAndroidChain: 5 certificates under Key Attestation CA1 is a
 *      Remote Key Provisioning phone (`android`), 4 under Google's RSA root a
 *      factory-provisioned one (`android_factory`); anything else is refused
 *   3. the chain checks the circuit would otherwise make after proving
 *      (androidChainChecks.ts), then the conversion (mirror of circuits'
 *      chain.js chainInputs / factoryChainInputs)
 *   4. statement_sig: the DER signature as r || s with s in low form
 *   5. factory only: a Play Integrity verdict for nonce =
 *      SHA256(SHA256(statement) || statement_sig), decrypted by the relay and
 *      checked (playIntegrity.ts)
 *
 * The signature is NOT verified against the leaf key here: the app has no
 * P-256 implementation among its own dependencies (only transitive copies),
 * and the circuit verifies it.
 */
import {ethers} from 'ethers';
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {N_P256} from '../appAttest/constants';
import {DerError, ecdsaDerToLowS} from '../appAttest/der';
import {
  androidChainInputs,
  androidFactoryChainInputs,
  classifyAndroidChain,
  GOOGLE_KEY_ATTESTATION_CA1,
  GOOGLE_RSA_ROOT_MODULUS_HEX,
  rsa4096Params,
} from '../utils/androidKeyAttestation';
import {knownAndroidChainKind, rememberAndroidChainKind, type AndroidChainKind} from '../config/signerPlatform';
import {
  requireAcceptableAndroidChain,
  requireAcceptableFactoryChain,
  ZKPROOFPORT_ANDROID_APP,
  type AndroidAppIdentity,
} from './androidChainChecks';
import type {AndroidFactorySignerInputs, AndroidSignerInputs, AnyAndroidSignerInputs} from './androidSignerInputs';
import {
  decryptIntegrityTokenViaRelay,
  integrityTokenInputs,
  PLAY_INTEGRITY_VERIFICATION_KEY,
  playIntegrityNonce,
  playIntegrityNonceText,
  type DecryptedIntegrityToken,
} from './playIntegrity';
import {
  androidNativeFailure,
  getAndroidKeyAttestationNative,
  type AndroidAttestationResult,
  type AndroidKeyAttestationNative,
} from './nativeAndroidKeyAttestation';

export interface AndroidTrust {
  /** The app the circuit accepts (ZKPROOFPORT_ANDROID_APP). */
  app: AndroidAppIdentity;
  /** Key Attestation CA1, X || Y (RKP chains). */
  rootKey: Uint8Array;
  /** Google's RSA root modulus, hex (factory chains). */
  rsaRootModulusHex: string;
  /** Our app's Play Integrity verification key, X || Y (factory chains). */
  playIntegrityKey: Uint8Array;
}

export interface AndroidSignOptions {
  /** Unix seconds the statement claims (OIDC `now`, Coinbase `attested_at`). */
  now: number;
  log: (msg: string) => void;
  /**
   * What the circuits pin -- ANDROID_CIRCUIT_TRUST in the app, the anchors a
   * synthetic chain carries in a test. Required, so a test cannot quietly
   * check against one set while the app uses another.
   */
  trust: AndroidTrust;
  /** Decrypts a Play Integrity token (the relay in the app; a fake in tests). Factory phones only. */
  integrity: {decrypt(token: string): Promise<DecryptedIntegrityToken>};
  /** Tests only: a fake native module. */
  native?: AndroidKeyAttestationNative;
}

/** The trust anchors the Android circuits pin. */
export const ANDROID_CIRCUIT_TRUST: AndroidTrust = Object.freeze({
  app: ZKPROOFPORT_ANDROID_APP,
  rootKey: GOOGLE_KEY_ATTESTATION_CA1,
  rsaRootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX,
  playIntegrityKey: PLAY_INTEGRITY_VERIFICATION_KEY,
});

/**
 * The relay that decrypts Play Integrity verdicts. `baseUrl` is read only
 * when a verdict is decrypted (factory phones), so the other paths never
 * resolve it.
 */
export function relayIntegrityDecrypter(baseUrl: () => string, log: (m: string) => void): AndroidSignOptions['integrity'] {
  return {decrypt: token => decryptIntegrityTokenViaRelay(token, {baseUrl: baseUrl(), log})};
}

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

async function attest(native: AndroidKeyAttestationNative, statement: Uint8Array) {
  let result: AndroidAttestationResult;
  try {
    result = await native.attestAndSign(ethers.utils.base64.encode(statement));
  } catch (e) {
    throw androidNativeFailure(e);
  }
  return {result, ...decodeResult(result)};
}

/** What the statement used to learn a phone's chain kind signs: nothing a circuit would take. */
export const CHAIN_KIND_PROBE = ethers.utils.toUtf8Bytes('ZKProofport/android-chain-kind/1');

/**
 * This phone's chain kind, learned once by making (and deleting) one attested
 * key, then kept (signerPlatform.ts). Called before a sign-in, so the circuit
 * files for the right package are chosen before anything is proved.
 */
export async function ensureAndroidChainKind(
  native: AndroidKeyAttestationNative,
  log: (m: string) => void,
  trust: AndroidTrust,
): Promise<AndroidChainKind> {
  const known = knownAndroidChainKind();
  if (known !== null) return known;
  log('[AndroidAttest] Learning this phone\'s attestation chain kind');
  const {chain} = await attest(native, CHAIN_KIND_PROBE);
  const kind = classifyAndroidChain(chain, trust);
  await rememberAndroidChainKind(kind);
  log(`[AndroidAttest] Attestation chain kind: ${kind}`);
  return kind;
}

function lowStatementSig(signature: Uint8Array): Uint8Array {
  try {
    return ecdsaDerToLowS(signature, 32, N_P256);
  } catch (e) {
    if (e instanceof DerError) {
      throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, `The statement signature is not a P-256 ECDSA signature: ${e.message}`);
    }
    throw e;
  }
}

/** Sign `statement` with a fresh attested Android key and return this phone's circuit's signer inputs. */
export async function signStatementOnAndroid(statement: Uint8Array, opts: AndroidSignOptions): Promise<AnyAndroidSignerInputs> {
  const native = opts.native ?? getAndroidKeyAttestationNative();
  const log = opts.log;

  log(`[AndroidAttest] Making a fresh attested key to sign the ${statement.length}-byte statement`);
  const {result, chain, signature} = await attest(native, statement);
  log(
    `[AndroidAttest] Key made in ${result.strongBox ? 'StrongBox' : 'the TEE'} (SDK ${result.sdkInt}); ` +
      `chain of ${chain.length} certificates (${chain.map(c => c.length).join(', ')} bytes)`,
  );

  const kind = classifyAndroidChain(chain, opts.trust);
  const known = knownAndroidChainKind();
  await rememberAndroidChainKind(kind);
  if (known !== null && known !== kind) {
    // The circuit files were chosen for the kind this phone showed before.
    throw new AppAttestError(
      ANDROID_ATTEST_ERROR_CODE.malformed,
      `This phone's attestation chain is now ${kind}, not ${known} as before; start the proof again to use the matching circuit`,
    );
  }
  const statementSig = lowStatementSig(signature);
  return kind === 'android'
    ? rkpInputs(chain, statementSig, opts)
    : factoryInputs(statement, chain, statementSig, native, opts);
}

function rkpInputs(chain: Uint8Array[], statementSig: Uint8Array, opts: AndroidSignOptions): AndroidSignerInputs {
  const {app, rootKey} = opts.trust;
  const summary = requireAcceptableAndroidChain(chain, {now: opts.now, app, rootKey});
  opts.log(`[AndroidAttest] RKP chain accepted: key in ${summary.securityLevel}, attestation version ${summary.attestationVersion}`);
  const inputs = androidChainInputs(chain, rootKey);
  opts.log(
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

async function factoryInputs(
  statement: Uint8Array,
  chain: Uint8Array[],
  statementSig: Uint8Array,
  native: AndroidKeyAttestationNative,
  opts: AndroidSignOptions,
): Promise<AndroidFactorySignerInputs> {
  const {app, rsaRootModulusHex, playIntegrityKey} = opts.trust;
  const summary = requireAcceptableFactoryChain(chain, {app, rootModulusHex: rsaRootModulusHex});
  opts.log(`[AndroidAttest] Factory chain accepted: key in ${summary.securityLevel}, attestation version ${summary.attestationVersion}`);
  const c = androidFactoryChainInputs(chain, rsaRootModulusHex);

  const nonce = playIntegrityNonce(statement, statementSig);
  const nonceText = playIntegrityNonceText(nonce);
  opts.log(`[PlayIntegrity] Requesting a verdict for nonce ${nonceText}`);
  let token: string;
  try {
    token = await native.requestIntegrityToken(nonceText);
  } catch (e) {
    throw androidNativeFailure(e);
  }
  const jws = await opts.integrity.decrypt(token);
  const verdict = integrityTokenInputs(jws, {nonce, packageName: app.packageName});
  opts.log(`[PlayIntegrity] Verdict accepted (${verdict.integrity_payload_b64_len} base64url characters)`);

  const root = rsa4096Params(rsaRootModulusHex);
  if (playIntegrityKey.length !== 64) throw new Error(`The Play Integrity key is ${playIntegrityKey.length} bytes, not 64`);
  return {
    variant: 'android_factory',
    statement_sig: statementSig,
    ik_tbs: c.ik_tbs,
    ik_tbs_len: c.ik_tbs_len,
    ik_sig: c.ik_sig,
    batch_tbs: c.batch_tbs,
    batch_tbs_len: c.batch_tbs_len,
    batch_sig: c.batch_sig,
    leaf_tbs: c.leaf_tbs,
    leaf_tbs_len: c.leaf_tbs_len,
    leaf_sig: c.leaf_sig,
    integrity_payload_b64: verdict.integrity_payload_b64,
    integrity_payload_b64_len: verdict.integrity_payload_b64_len,
    integrity_signature: verdict.integrity_signature,
    rsa_root_modulus: root.modulus,
    rsa_root_redc: root.redc,
    play_integrity_key: Uint8Array.from(playIntegrityKey),
  };
}
