/**
 * The input vector for Coinbase KYC v2 (`coinbase_attestation`; circuits
 * `coinbase-attestation-v2/src/main.nr`, package `coinbase_attestation_v2`,
 * pre-release tag v2.0.0-rc.1), in its `fn main` order, as the APP signer kind.
 *
 * bb reads the vector positionally, so the order below IS the contract:
 *
 *   public   signal_hash 32, domain_separator 32, action_hash 32,
 *            signer_list_merkle_root 32, scope 32, nullifier 32, attested_at 1
 *            -> 193 field elements
 *   private  user_address 20, user_signature 64, user_pubkey_x 32, user_pubkey_y 32,
 *            raw_transaction 300, tx_length 1, coinbase_attester_pubkey_x 32,
 *            coinbase_attester_pubkey_y 32, coinbase_signer_merkle_proof 256,
 *            coinbase_signer_leaf_index 1, merkle_proof_depth 1,
 *            client_data 225, signer_kind 1 (app = 1), statement_sig 64 (the
 *            App Attest assertion signature, r || s, low s),
 *            credential_tbs 1000, credential_tbs_len 1, credential_sig 96,
 *            att_auth_data 256, att_auth_data_len 1, att_client_data_hash 32,
 *            assertion_auth_data 128, assertion_auth_data_len 1
 *            -> 2,769 values in all
 *
 * The circuit pins Apple's intermediate ("Apple App Attestation CA 1") and the
 * production AAGUID as constants, so neither the CA key, its hash nor an
 * environment flag is an input any more (the 2026-10-23 build had all three). This
 * builder refuses a credential the circuit would refuse for either reason:
 * an intermediate other than the pinned one, or a development-environment key.
 *
 * `theAppBuildsTheCircuitsOwnVector.test.ts` holds this against a vector the
 * circuit's own fixture generator produced (circuits
 * scripts/coinbase-attestation-v2/export-app-vector.js), and its ABI.
 */
import {ethers} from 'ethers';
import type {AppAttestWitness} from '../appAttest/revocationStatement';
import {appSignerInputs} from '../appAttest/appSignerInputs';
import {CLIENT_DATA_LEN} from '../appAttest/clientData';
import {bytesToNoirInput, nullifierForCircuit, type AttesterCircuitInputs} from './circuitHelpers';

const ZERO32 = new Array(32).fill(0);

export interface CoinbaseAppAttestInputs {
  signal_hash: string[];
  domain_separator: string[];
  action_hash: string[];
  signer_list_merkle_root: string[];
  scope: string[];
  nullifier: string[];
  attested_at: string;

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
  signer_kind: string;
  statement_sig: string[];
  credential_tbs: string[];
  credential_tbs_len: string;
  credential_sig: string[];
  att_auth_data: string[];
  att_auth_data_len: string;
  att_client_data_hash: string[];
  assertion_auth_data: string[];
  assertion_auth_data_len: string;
}

function fixed(bytes: Uint8Array, length: number, what: string): string[] {
  if (bytes.length !== length) throw new Error(`${what} is ${bytes.length} bytes; the circuit takes ${length}`);
  return bytesToNoirInput(Array.from(bytes));
}

const hexOfBytes = (b: Uint8Array): string[] => bytesToNoirInput(Array.from(b));

/**
 * Build the v2 vector from the Coinbase half (as `prepareCircuitInputs`
 * builds it for the shipped circuit) and the App Attest witness.
 *
 * Takes over three things from the Coinbase half rather than trusting them:
 *   - the request pair: personal_sign mode sends `signal_hash` and two zero
 *     hashes; EIP-712 mode sends a zero `signal_hash` and the two hashes. The
 *     circuit refuses a request with both or neither.
 *   - the nullifier, recomputed by v2's own rule (wallet +
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
    /**
     * SHA256(X || Y) of the intermediate the circuit pins: Apple's CA 1
     * (APPLE_APP_ATTEST_CA1_KEY_HASH) in the app, the synthetic one in the
     * vector test. Required -- no default, so a test cannot quietly prove
     * against Apple's while the app uses another.
     */
    pinnedCaKeyHash: string;
  },
  witness: AppAttestWitness,
): CoinbaseAppAttestInputs {
  // The App Attest half, shared with the OIDC circuit: refuses (E2014) a
  // non-pinned intermediate, a development key and a high s.
  const signer = appSignerInputs(witness.credential, witness.assertion, request.pinnedCaKeyHash);
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

  const nullifier = nullifierForCircuit('coinbase_attestation', request.userAddress, new Uint8Array(32), request.scope);

  return {
    signal_hash: signal,
    domain_separator: domain,
    action_hash: action,
    signer_list_merkle_root: coinbase.signer_list_merkle_root,
    scope: fixed(request.scope, 32, 'scope'),
    nullifier: bytesToNoirInput(Array.from(nullifier)),
    attested_at: String(witness.attestedAt),

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
    signer_kind: String(signer.signer_kind),
    statement_sig: hexOfBytes(signer.statement_sig),
    credential_tbs: hexOfBytes(signer.credential_tbs),
    credential_tbs_len: String(signer.credential_tbs_len),
    credential_sig: hexOfBytes(signer.credential_sig),
    att_auth_data: hexOfBytes(signer.att_auth_data),
    att_auth_data_len: String(signer.att_auth_data_len),
    att_client_data_hash: hexOfBytes(signer.att_client_data_hash),
    assertion_auth_data: hexOfBytes(signer.assertion_auth_data),
    assertion_auth_data_len: String(signer.assertion_auth_data_len),
  };
}

/** `fn main`'s order. The first 193 values are the public inputs. */
export function flattenCoinbaseAppAttestInputs(i: CoinbaseAppAttestInputs): string[] {
  return [
    ...i.signal_hash,
    ...i.domain_separator,
    ...i.action_hash,
    ...i.signer_list_merkle_root,
    ...i.scope,
    ...i.nullifier,
    i.attested_at,
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
    i.signer_kind,
    ...i.statement_sig,
    ...i.credential_tbs,
    i.credential_tbs_len,
    ...i.credential_sig,
    ...i.att_auth_data,
    i.att_auth_data_len,
    ...i.att_client_data_hash,
    ...i.assertion_auth_data,
    i.assertion_auth_data_len,
  ];
}
