/**
 * The App Attest half of a statement-signer witness: the ten private inputs
 * that both circuits verifying a statement through circuits' shared
 * `statement-signer` library take after their own inputs, as the APP signer
 * kind:
 *
 *   signer_kind u8 (app = 1), statement_sig [u8; 64] (the assertion
 *   signature, r || s, low s), credential_tbs [u8; 1000], credential_tbs_len,
 *   credential_sig [u8; 96], att_auth_data [u8; 256], att_auth_data_len,
 *   att_client_data_hash [u8; 32], assertion_auth_data [u8; 128],
 *   assertion_auth_data_len
 *
 * Used by Coinbase KYC v2 (the revocation statement) and the OIDC domain
 * circuit (the provider-key statement). One place refuses what the library
 * refuses, so the two circuits cannot drift apart: an intermediate other than
 * the pinned one, a development (sandbox) key, and a high-s assertion -- each
 * E2014, before anything reaches the prover.
 */
import {ethers} from 'ethers';
import {AppAttestError, APP_ATTEST_ERROR_CODE} from './appAttestError';
import type {CircuitAssertion, CircuitCredential} from './appAttestObjects';
import {ASSERT_AUTH_DATA_MAX_LEN, ATT_AUTH_DATA_MAX_LEN, CREDENTIAL_TBS_MAX_LEN, N_P256} from './constants';

/** statement-signer `KIND_APP`: the statement is signed by an App Attest key. */
export const SIGNER_KIND_APP = 1;
const N_P256_HALF = N_P256 >> 1n;

export interface AppSignerInputs {
  signer_kind: number;
  statement_sig: Uint8Array;
  credential_tbs: Uint8Array;
  credential_tbs_len: number;
  credential_sig: Uint8Array;
  att_auth_data: Uint8Array;
  att_auth_data_len: number;
  att_client_data_hash: Uint8Array;
  assertion_auth_data: Uint8Array;
  assertion_auth_data_len: number;
}

function fixed(bytes: Uint8Array, length: number, what: string): Uint8Array {
  if (bytes.length !== length) throw new Error(`${what} is ${bytes.length} bytes; the circuit takes ${length}`);
  return Uint8Array.from(bytes);
}

function padded(bytes: Uint8Array, max: number, what: string): Uint8Array {
  if (bytes.length > max) throw new Error(`${what} is ${bytes.length} bytes; the circuit holds ${max}`);
  const out = new Uint8Array(max);
  out.set(bytes);
  return out;
}

/**
 * The app-kind inputs for one assertion. `pinnedCaKeyHash` is SHA256(X || Y)
 * of the intermediate the circuit pins (Apple's CA 1 in the app, a synthetic
 * one in tests); it is required so a test cannot quietly prove against
 * Apple's while the app uses another.
 */
export function appSignerInputs(
  credential: CircuitCredential,
  assertion: CircuitAssertion,
  pinnedCaKeyHash: string,
): AppSignerInputs {
  const refuse = (why: string): never => {
    throw new AppAttestError(APP_ATTEST_ERROR_CODE.malformed, why);
  };
  if (credential.caKeyHash.toLowerCase() !== pinnedCaKeyHash.toLowerCase()) {
    refuse(`intermediate CA key hash ${credential.caKeyHash} is not the one the circuit pins (${pinnedCaKeyHash})`);
  }
  if (!credential.production) {
    refuse('development (sandbox) App Attest key; the circuit accepts production keys only');
  }
  if (assertion.signature.length === 64 && BigInt(ethers.utils.hexlify(assertion.signature.slice(32))) > N_P256_HALF) {
    refuse('assertion signature s is not in low form; the circuit refuses a high s');
  }
  return {
    signer_kind: SIGNER_KIND_APP,
    statement_sig: fixed(assertion.signature, 64, 'statement_sig'),
    credential_tbs: padded(credential.credentialTbs, CREDENTIAL_TBS_MAX_LEN, 'credential_tbs'),
    credential_tbs_len: credential.credentialTbs.length,
    credential_sig: fixed(credential.credentialSig, 96, 'credential_sig'),
    att_auth_data: padded(credential.attAuthData, ATT_AUTH_DATA_MAX_LEN, 'att_auth_data'),
    att_auth_data_len: credential.attAuthData.length,
    att_client_data_hash: fixed(credential.attClientDataHash, 32, 'att_client_data_hash'),
    assertion_auth_data: padded(assertion.authenticatorData, ASSERT_AUTH_DATA_MAX_LEN, 'assertion_auth_data'),
    assertion_auth_data_len: assertion.authenticatorData.length,
  };
}
