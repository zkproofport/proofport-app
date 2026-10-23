/**
 * The input vector for `coinbase_app_attest_poc` (circuits branch
 * `coinbase-app-attest-poc`, `src/main.nr`), in its `fn main` order.
 *
 * bb reads the vector positionally, so the order below IS the contract:
 *
 *   public   signal_hash 32, domain_separator 32, action_hash 32,
 *            signer_list_merkle_root 32, scope 32, nullifier 32,
 *            app_attest_ca_key_hash 32, attested_at 1, app_attest_production 1
 *            -> 226 field elements
 *   private  user_address 20, user_signature 64, user_pubkey_x 32, user_pubkey_y 32,
 *            raw_transaction 300, tx_length 1, coinbase_attester_pubkey_x 32,
 *            coinbase_attester_pubkey_y 32, coinbase_signer_merkle_proof 256,
 *            coinbase_signer_leaf_index 1, merkle_proof_depth 1,
 *            client_data 225, app_attest_ca_key 96, credential_tbs 1000,
 *            credential_tbs_len 1, credential_sig 96, att_auth_data 256,
 *            att_auth_data_len 1, att_client_data_hash 32,
 *            assertion_auth_data 128, assertion_auth_data_len 1, assertion_sig 64
 *            -> 2,897 values in all
 *
 * `coinbaseAppAttestInputs.test.ts` holds this against the compiled circuit's
 * ABI and against a vector the circuit's own fixture generator produced.
 */
import {ethers} from 'ethers';
import type {AppAttestWitness} from '../appAttest/revocationStatement';
import {
  ASSERT_AUTH_DATA_MAX_LEN,
  ATT_AUTH_DATA_MAX_LEN,
  CREDENTIAL_TBS_MAX_LEN,
} from '../appAttest/constants';
import {CLIENT_DATA_LEN} from '../appAttest/clientData';
import {bytesToNoirInput, nullifierForCircuit, padArray, type AttesterCircuitInputs} from './circuitHelpers';
import {COINBASE_APP_ATTEST_POC} from '../config/prototypeCircuits';

const ZERO32 = new Array(32).fill(0);

export interface CoinbaseAppAttestInputs {
  signal_hash: string[];
  domain_separator: string[];
  action_hash: string[];
  signer_list_merkle_root: string[];
  scope: string[];
  nullifier: string[];
  app_attest_ca_key_hash: string[];
  attested_at: string;
  app_attest_production: string;

  user_address: string[];
  user_signature: string[];
  user_pubkey_x: string[];
  user_pubkey_y: string[];
  raw_transaction: string[];
  tx_length: string;
  coinbase_attester_pubkey_x: string[];
  coinbase_attester_pubkey_y: string[];
  coinbase_signer_merkle_proof: string[];
  coinbase_signer_leaf_index: string;
  merkle_proof_depth: string;

  client_data: string[];
  app_attest_ca_key: string[];
  credential_tbs: string[];
  credential_tbs_len: string;
  credential_sig: string[];
  att_auth_data: string[];
  att_auth_data_len: string;
  att_client_data_hash: string[];
  assertion_auth_data: string[];
  assertion_auth_data_len: string;
  assertion_sig: string[];
}

function fixed(bytes: Uint8Array, length: number, what: string): string[] {
  if (bytes.length !== length) throw new Error(`${what} is ${bytes.length} bytes; the circuit takes ${length}`);
  return bytesToNoirInput(Array.from(bytes));
}

function padded(bytes: Uint8Array, max: number, what: string): string[] {
  if (bytes.length > max) throw new Error(`${what} is ${bytes.length} bytes; the circuit holds ${max}`);
  return bytesToNoirInput(padArray(Array.from(bytes), max));
}

/**
 * Build the prototype's vector from the Coinbase half (as `prepareCircuitInputs`
 * builds it for the shipped circuit) and the App Attest witness.
 *
 * Takes over three things from the Coinbase half rather than trusting them:
 *   - the request pair: personal_sign mode sends `signal_hash` and two zero
 *     hashes; EIP-712 mode sends a zero `signal_hash` and the two hashes. The
 *     circuit refuses a request with both or neither.
 *   - the nullifier, recomputed by the prototype's own rule (wallet +
 *     keccak256("coinbase_attestation") + scope), never signal_hash's.
 *   - the clientData's wallet, digest and scope, compared with what is being
 *     proved, so a mismatch is reported here and not by the prover.
 */
export function prepareCoinbaseAppAttestInputs(
  coinbase: AttesterCircuitInputs,
  request: {
    userAddress: string;
    scope: Uint8Array;
    /** The digest the wallet signed. */
    signedDigest: string;
    /** Present in EIP-712 action mode. */
    publicHashes?: {domainSeparator: string; actionHash: string};
  },
  witness: AppAttestWitness,
): CoinbaseAppAttestInputs {
  const cd = witness.clientData;
  if (cd.length !== CLIENT_DATA_LEN) throw new Error(`clientData is ${cd.length} bytes, not ${CLIENT_DATA_LEN}`);
  const hexOf = (from: number, len: number) => ethers.utils.hexlify(cd.slice(from, from + len)).toLowerCase();
  if (hexOf(48, 20) !== request.userAddress.toLowerCase()) {
    throw new Error(`clientData names wallet ${hexOf(48, 20)}, the proof is for ${request.userAddress}`);
  }
  if (hexOf(161, 32) !== request.signedDigest.toLowerCase()) {
    throw new Error(`clientData binds request ${hexOf(161, 32)}, the wallet signed ${request.signedDigest}`);
  }
  if (hexOf(193, 32) !== ethers.utils.hexlify(request.scope).toLowerCase()) {
    throw new Error('clientData binds another scope');
  }

  const actionMode = Boolean(request.publicHashes);
  const signal = actionMode ? bytesToNoirInput(ZERO32) : coinbase.signal_hash;
  if (!actionMode && coinbase.signal_hash.every(b => /^0x0+$/.test(b))) {
    throw new Error('signal mode with an all-zero signal_hash: the circuit refuses a request that signs nothing');
  }
  const domain = request.publicHashes
    ? fixed(ethers.utils.arrayify(request.publicHashes.domainSeparator), 32, 'domain_separator')
    : bytesToNoirInput(ZERO32);
  const action = request.publicHashes
    ? fixed(ethers.utils.arrayify(request.publicHashes.actionHash), 32, 'action_hash')
    : bytesToNoirInput(ZERO32);

  const nullifier = nullifierForCircuit(COINBASE_APP_ATTEST_POC.id, request.userAddress, new Uint8Array(32), request.scope);
  const {credential, assertion} = witness;

  return {
    signal_hash: signal,
    domain_separator: domain,
    action_hash: action,
    signer_list_merkle_root: coinbase.signer_list_merkle_root,
    scope: fixed(request.scope, 32, 'scope'),
    nullifier: bytesToNoirInput(Array.from(nullifier)),
    app_attest_ca_key_hash: fixed(ethers.utils.arrayify(credential.caKeyHash), 32, 'app_attest_ca_key_hash'),
    attested_at: String(witness.attestedAt),
    app_attest_production: credential.production ? '1' : '0',

    user_address: coinbase.user_address,
    user_signature: coinbase.user_signature,
    user_pubkey_x: coinbase.user_pubkey_x,
    user_pubkey_y: coinbase.user_pubkey_y,
    raw_transaction: coinbase.raw_transaction,
    tx_length: coinbase.tx_length,
    coinbase_attester_pubkey_x: coinbase.coinbase_attester_pubkey_x,
    coinbase_attester_pubkey_y: coinbase.coinbase_attester_pubkey_y,
    coinbase_signer_merkle_proof: coinbase.coinbase_signer_merkle_proof,
    coinbase_signer_leaf_index: coinbase.coinbase_signer_leaf_index,
    merkle_proof_depth: coinbase.merkle_proof_depth,

    client_data: fixed(cd, CLIENT_DATA_LEN, 'client_data'),
    app_attest_ca_key: fixed(credential.caKey, 96, 'app_attest_ca_key'),
    credential_tbs: padded(credential.credentialTbs, CREDENTIAL_TBS_MAX_LEN, 'credential_tbs'),
    credential_tbs_len: String(credential.credentialTbs.length),
    credential_sig: fixed(credential.credentialSig, 96, 'credential_sig'),
    att_auth_data: padded(credential.attAuthData, ATT_AUTH_DATA_MAX_LEN, 'att_auth_data'),
    att_auth_data_len: String(credential.attAuthData.length),
    att_client_data_hash: fixed(credential.attClientDataHash, 32, 'att_client_data_hash'),
    assertion_auth_data: padded(assertion.authenticatorData, ASSERT_AUTH_DATA_MAX_LEN, 'assertion_auth_data'),
    assertion_auth_data_len: String(assertion.authenticatorData.length),
    assertion_sig: fixed(assertion.signature, 64, 'assertion_sig'),
  };
}

/** `fn main`'s order. The first 226 values are the public inputs. */
export function flattenCoinbaseAppAttestInputs(i: CoinbaseAppAttestInputs): string[] {
  return [
    ...i.signal_hash,
    ...i.domain_separator,
    ...i.action_hash,
    ...i.signer_list_merkle_root,
    ...i.scope,
    ...i.nullifier,
    ...i.app_attest_ca_key_hash,
    i.attested_at,
    i.app_attest_production,
    ...i.user_address,
    ...i.user_signature,
    ...i.user_pubkey_x,
    ...i.user_pubkey_y,
    ...i.raw_transaction,
    i.tx_length,
    ...i.coinbase_attester_pubkey_x,
    ...i.coinbase_attester_pubkey_y,
    ...i.coinbase_signer_merkle_proof,
    i.coinbase_signer_leaf_index,
    i.merkle_proof_depth,
    ...i.client_data,
    ...i.app_attest_ca_key,
    ...i.credential_tbs,
    i.credential_tbs_len,
    ...i.credential_sig,
    ...i.att_auth_data,
    i.att_auth_data_len,
    ...i.att_client_data_hash,
    ...i.assertion_auth_data,
    i.assertion_auth_data_len,
    ...i.assertion_sig,
  ];
}
