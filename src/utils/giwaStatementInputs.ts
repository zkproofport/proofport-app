/**
 * The input vector for GIWA KYC v2 and the Dojang Playground v2 (circuits
 * `giwa-attestation-v2*`, `dojang-playground-v2*`), in each `fn main`'s order.
 * bb reads the vector positionally, so the order below IS the contract:
 *
 *   GIWA KYC (as Coinbase KYC v2, whose packages these were made from):
 *     public   signal_hash 32, domain_separator 32, action_hash 32,
 *              signer_list_merkle_root 32, oprf_key_hash, domain, scope,
 *              nullifier, attested_at
 *     private  user_address 20, user_signature 64, user_pubkey_x 32,
 *              user_pubkey_y 32, raw_transaction 300, tx_length,
 *              coinbase_attester_pubkey_x 32, coinbase_attester_pubkey_y 32,
 *              coinbase_signer_merkle_proof 256, coinbase_signer_leaf_index,
 *              merkle_proof_depth, client_data 233, <signer>, oprf private 7
 *   Dojang Playground:
 *     public   signal_hash 32, domain_separator 32, action_hash 32,
 *              oprf_key_hash, domain, scope, nullifier, attested_at
 *     private  user_address 20, user_signature 64, user_pubkey_x 32,
 *              user_pubkey_y 32, raw_transaction <MAX_TX_LEN>, tx_length,
 *              client_data 233, <signer>, oprf private 7
 *
 *   <signer>  iPhone package: signer_kind, statement_sig 64, credential_tbs,
 *             credential_tbs_len, credential_sig 96, att_auth_data,
 *             att_auth_data_len, att_client_data_hash 32, assertion_auth_data,
 *             assertion_auth_data_len (appSignerInputs, shared with Coinbase
 *             v2 and OIDC); Android packages: the RKP or factory signer
 *             (flattenAnyAndroidSigner).
 *
 * The statement's wallet, request digest and scope are compared with what is
 * proved here, so a mismatch is reported before the prover runs.
 */
import {ethers} from 'ethers';
import type {AppAttestWitness} from '../appAttest/revocationStatement';
import {appSignerInputs} from '../appAttest/appSignerInputs';
import {
  flattenAnyAndroidSigner,
  isAndroidFactorySignerInputs,
  isAndroidSignerInputs,
  isAndroidStatementWitness,
  type AndroidStatementWitness,
} from '../androidAttest/androidSignerInputs';
import {GIWA_STATEMENT_LEN, giwaStatementKind, type GiwaStatementCircuit} from '../appAttest/giwaStatement';
import type {StatementSignerVariant} from '../config/signerPlatform';
import {bytesToNoirInput, type AttesterCircuitInputs} from './circuitHelpers';
import type {DojangPlaygroundCircuitInputs} from './dojangPlayground';

export interface GiwaStatementVectorRequest {
  circuit: GiwaStatementCircuit;
  userAddress: string;
  /** The scope Field's 32 bytes big-endian: the statement's offset 193 and the public scope. */
  scope: Uint8Array;
  /** The digest the wallet signed. */
  signedDigest: string;
  /** Required for the iPhone package: SHA256(X || Y) of the intermediate the circuit pins. */
  pinnedCaKeyHash?: string;
}

type Witness = AppAttestWitness | AndroidStatementWitness;

const hexOfBytes = (b: Uint8Array | number[]): string[] => bytesToNoirInput(Array.from(b));

function checkStatement(request: GiwaStatementVectorRequest, witness: Witness): string[] {
  const kind = giwaStatementKind(request.circuit);
  const cd = witness.clientData;
  if (cd.length !== GIWA_STATEMENT_LEN) throw new Error(`statement is ${cd.length} bytes; ${kind.label} v2 takes ${GIWA_STATEMENT_LEN}`);
  const hexOf = (from: number, len: number) => ethers.utils.hexlify(cd.slice(from, from + len)).toLowerCase();
  if (hexOf(16, 32) !== ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind.circuit)).toLowerCase()) {
    throw new Error(`statement is not ${kind.label}'s (tag ${hexOf(16, 32)})`);
  }
  if (hexOf(48, 20) !== request.userAddress.toLowerCase()) {
    throw new Error(`statement names wallet ${hexOf(48, 20)}, the proof is for ${request.userAddress}`);
  }
  if (hexOf(161, 32) !== request.signedDigest.toLowerCase()) {
    throw new Error(`statement binds request ${hexOf(161, 32)}, the wallet signed ${request.signedDigest}`);
  }
  if (hexOf(193, 32) !== ethers.utils.hexlify(request.scope).toLowerCase()) {
    throw new Error('statement binds another scope');
  }
  return hexOfBytes(cd);
}

function sevenOprf(v: string[]): string[] {
  if (!Array.isArray(v) || v.length !== 7) throw new Error(`${Array.isArray(v) ? v.length : 'no'} OPRF private inputs; the circuit takes 7`);
  return v;
}

function fourOprfPublic(v: string[]): string[] {
  if (!Array.isArray(v) || v.length !== 4) throw new Error(`${Array.isArray(v) ? v.length : 'no'} OPRF public inputs; the circuit takes 4`);
  return v;
}

function signerPart(variant: StatementSignerVariant, request: GiwaStatementVectorRequest, witness: Witness): string[] {
  const SIGNER: Readonly<Record<StatementSignerVariant, () => string[]>> = {
    app_attest: () => {
      if (isAndroidStatementWitness(witness)) throw new Error('An Android statement cannot prove the iPhone circuit');
      if (!request.pinnedCaKeyHash) throw new Error('The iPhone package needs the pinned App Attest intermediate hash');
      const w = witness as AppAttestWitness;
      const s = appSignerInputs(w.credential, w.assertion, request.pinnedCaKeyHash);
      return [
        String(s.signer_kind),
        ...hexOfBytes(s.statement_sig),
        ...hexOfBytes(s.credential_tbs),
        String(s.credential_tbs_len),
        ...hexOfBytes(s.credential_sig),
        ...hexOfBytes(s.att_auth_data),
        String(s.att_auth_data_len),
        ...hexOfBytes(s.att_client_data_hash),
        ...hexOfBytes(s.assertion_auth_data),
        String(s.assertion_auth_data_len),
      ];
    },
    android: () => androidPart('android', witness),
    android_factory: () => androidPart('android_factory', witness),
  };
  if (!Object.prototype.hasOwnProperty.call(SIGNER, variant)) {
    throw new Error(`No signer inputs for variant '${variant}'. Known: ${Object.keys(SIGNER).join(', ')}.`);
  }
  return SIGNER[variant]();
}

function androidPart(variant: 'android' | 'android_factory', witness: Witness): string[] {
  if (!isAndroidStatementWitness(witness) || witness.variant !== variant) {
    throw new Error(`Only a ${variant} Android statement proves the ${variant} circuit`);
  }
  const signer = witness.signer;
  const matches = variant === 'android' ? isAndroidSignerInputs(signer) : isAndroidFactorySignerInputs(signer);
  if (!matches || signer.variant !== variant) throw new Error(`The Android statement's signer inputs are not ${variant}'s`);
  return flattenAnyAndroidSigner(signer, b => bytesToNoirInput([b])[0], n => String(n), v => v.toString());
}

const ZERO32 = bytesToNoirInput(new Array(32).fill(0));
const isZero = (v: string[]) => v.every(x => /^0x0*$/.test(x) || x === '0');

/**
 * The circuit takes exactly one of the two modes: personal_sign over a
 * non-zero signal_hash with both EIP-712 hashes zero, or an EIP-712 action
 * with a zero signal_hash. v1's input builder leaves the two hashes out in
 * personal_sign mode; they are 32 zero bytes then, by the circuit's rule.
 */
function requestPair(signal: string[], domainSeparator?: string[], actionHash?: string[]): {domain: string[]; action: string[]} {
  if ((domainSeparator === undefined) !== (actionHash === undefined)) {
    throw new Error('Only one of the EIP-712 hashes is present; the request carries both or neither');
  }
  if (domainSeparator === undefined || actionHash === undefined) {
    if (isZero(signal)) throw new Error('personal_sign mode with an all-zero signal_hash: the circuit refuses a request that signs nothing');
    return {domain: ZERO32, action: ZERO32};
  }
  if (!isZero(signal)) throw new Error('An EIP-712 action with a non-zero signal_hash: the circuit refuses a request carrying both');
  return {domain: domainSeparator, action: actionHash};
}

/** GIWA KYC v2: the v1 inputs (prepareGiwaCircuitInputs), the statement, the signer. */
export function flattenGiwaKycV2Inputs(
  variant: StatementSignerVariant,
  base: AttesterCircuitInputs,
  request: GiwaStatementVectorRequest,
  witness: Witness,
): string[] {
  if (request.circuit !== 'giwa_attestation') throw new Error(`flattenGiwaKycV2Inputs is for giwa_attestation, not ${request.circuit}`);
  const statement = checkStatement(request, witness);
  const {domain, action} = requestPair(base.signal_hash, base.domain_separator, base.action_hash);
  return [
    ...base.signal_hash,
    ...domain,
    ...action,
    ...base.signer_list_merkle_root,
    ...fourOprfPublic(base.oprf_public),
    String(witness.attestedAt),
    ...base.user_address,
    ...base.user_signature,
    ...base.user_pubkey_x,
    ...base.user_pubkey_y,
    ...base.raw_transaction,
    base.tx_length,
    ...base.coinbase_attester_pubkey_x,
    ...base.coinbase_attester_pubkey_y,
    ...base.coinbase_signer_merkle_proof,
    base.coinbase_signer_leaf_index,
    base.merkle_proof_depth,
    ...statement,
    ...signerPart(variant, request, witness),
    ...sevenOprf(base.oprf_private),
  ];
}

/** The Dojang Playground v2: the v1 inputs (prepareDojangPlaygroundInputs), the statement, the signer. */
export function flattenDojangV2Inputs(
  variant: StatementSignerVariant,
  base: DojangPlaygroundCircuitInputs,
  request: GiwaStatementVectorRequest,
  witness: Witness,
): string[] {
  if (request.circuit !== 'dojang_playground') throw new Error(`flattenDojangV2Inputs is for dojang_playground, not ${request.circuit}`);
  const statement = checkStatement(request, witness);
  return [
    ...base.signal_hash,
    ...base.domain_separator,
    ...base.action_hash,
    ...fourOprfPublic(base.oprf_public),
    String(witness.attestedAt),
    ...base.user_address,
    ...base.user_signature,
    ...base.user_pubkey_x,
    ...base.user_pubkey_y,
    ...base.raw_transaction,
    base.tx_length,
    ...statement,
    ...signerPart(variant, request, witness),
    ...sevenOprf(base.oprf_private),
  ];
}
