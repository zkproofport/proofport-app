/**
 * Coinbase-specific constants and helpers for the on-chain attestAccount tx
 * and Coinbase circuit input preparation.
 *
 * Circuit-agnostic helpers (Merkle tree, pubkey/sig recovery, scope/nullifier
 * hashing, input flattening, AttesterCircuitInputs) live in `circuitHelpers.ts`.
 */
import {ethers} from 'ethers';
import {getAttestationConfig} from '../config';
// Straight from the module that holds it, not the `src/config` barrel: the
// barrel also pulls in the wallet-connection setup, which jest cannot parse.
import {
  AttesterCircuitInputs,
  SimpleMerkleTree,
  bytesToNoirInput,
  nullifierForCircuit,
  computeScope,
  extractPubkeyCoordinates,
  hexToByteArray,
  padArray,
  recoverTxSignerPubkey,
} from './circuitHelpers';

const attestationConfig = getAttestationConfig();
export const AUTHORIZED_SIGNERS = attestationConfig.authorizedSigners;
export const COINBASE_ATTESTER_CONTRACT = attestationConfig.coinbaseAttester;

export function verifyAttestationTx(
  rawTx: string,
  expectedUserAddress: string,
): {valid: boolean; error?: string; signerAddress?: string} {
  try {
    const tx = ethers.utils.parseTransaction(rawTx);

    if (tx.to?.toLowerCase() !== COINBASE_ATTESTER_CONTRACT.toLowerCase()) {
      return {valid: false, error: 'Transaction not sent to Coinbase Attester Contract'};
    }

    // attestAccount(address) or attestCountry(address, ...)
    const VALID_SELECTORS = ['0x56feed5e', '0x0a225248'];
    const selector = tx.data.slice(0, 10);
    if (!VALID_SELECTORS.includes(selector)) {
      return {valid: false, error: 'Invalid function selector'};
    }

    const calldataAddress = '0x' + tx.data.slice(34, 74);
    if (calldataAddress.toLowerCase() !== expectedUserAddress.toLowerCase()) {
      return {valid: false, error: 'Calldata address does not match user address'};
    }

    const signerPubkey = recoverTxSignerPubkey(rawTx);
    const signerAddress = ethers.utils.computeAddress(signerPubkey);

    const isAuthorized = AUTHORIZED_SIGNERS.some(
      addr => addr.toLowerCase() === signerAddress.toLowerCase(),
    );

    if (!isAuthorized) {
      return {
        valid: false,
        error: `Signer ${signerAddress} is not an authorized Coinbase signer`,
        signerAddress,
      };
    }

    return {valid: true, signerAddress};
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to parse transaction',
    };
  }
}

export function prepareCircuitInputs(
  signalHash: Uint8Array,
  userAddress: string,
  userSignature: string,
  userPubkey: string,
  rawTransaction: string,
  coinbaseSignerIndex: number,
  scopeString: string,
  /**
   * Which circuit this vector is for.
   *
   * Required, and with no default: the nullifier formula differs per circuit,
   * and guessing produces a proof that fails with "Nullifier mismatch" and
   * nothing pointing here.
   */
  circuitId: string,
  /**
   * The two EIP-712 hashes, for the circuits that bind an action.
   *
   * They are PUBLIC INPUTS of that circuit, so a vector built without them is
   * not a shorter one — it is a different circuit's, and the prover says only
   * `MoproError.NoirError`.
   *
   * Taken already-computed rather than derived from the action here, so the
   * hashes in the proof are the SAME values the wallet signed over and the
   * recovery used. Computing them again in a third place is how they drift.
   */
  publicHashes?: {domainSeparator: string; actionHash: string},
): AttesterCircuitInputs {
  const merkleTree = new SimpleMerkleTree(AUTHORIZED_SIGNERS);
  const merkleRoot = merkleTree.getRoot();
  const {proof: merkleProof, leafIndex, depth} = merkleTree.getProof(coinbaseSignerIndex);

  const userPubkeyCoords = extractPubkeyCoordinates(userPubkey);

  const userSig = ethers.utils.splitSignature(userSignature);
  const userSigBytes = [
    ...hexToByteArray(userSig.r),
    ...hexToByteArray(userSig.s),
  ];

  const txBytes = hexToByteArray(rawTransaction);
  const paddedTxBytes = padArray(txBytes, 300);

  const coinbasePubkey = recoverTxSignerPubkey(rawTransaction);
  const coinbasePubkeyCoords = extractPubkeyCoordinates(coinbasePubkey);

  const paddedProof: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (i < merkleProof.length) {
      paddedProof.push(...bytesToNoirInput(hexToByteArray(merkleProof[i])));
    } else {
      paddedProof.push(...bytesToNoirInput(new Array(32).fill(0)));
    }
  }

  const scopeBytes = computeScope(scopeString);
  const nullifierBytes = nullifierForCircuit(circuitId, userAddress, signalHash, scopeBytes);

  // The same two values the verifying contract recomputes from the call it is
  // about to run, and the same two the wallet signed over.
  const arcHashes = publicHashes
    ? {
        domain_separator: bytesToNoirInput(hexToByteArray(publicHashes.domainSeparator)),
        action_hash: bytesToNoirInput(hexToByteArray(publicHashes.actionHash)),
      }
    : {};

  return {
    /*
     * Zero when an action is bound. The action-binding circuits assert that
     * `signal_hash` is empty in that mode, because a proof carrying both
     * leaves each verifier to decide which half to believe.
     */
    signal_hash: bytesToNoirInput(
      publicHashes ? new Array(32).fill(0) : Array.from(signalHash),
    ),
    ...arcHashes,
    signer_list_merkle_root: bytesToNoirInput(hexToByteArray(merkleRoot)),
    scope: bytesToNoirInput(Array.from(scopeBytes)),
    nullifier: bytesToNoirInput(Array.from(nullifierBytes)),
    user_address: bytesToNoirInput(hexToByteArray(userAddress)),
    user_signature: bytesToNoirInput(userSigBytes),
    user_pubkey_x: bytesToNoirInput(hexToByteArray(userPubkeyCoords.x)),
    user_pubkey_y: bytesToNoirInput(hexToByteArray(userPubkeyCoords.y)),
    raw_transaction: bytesToNoirInput(paddedTxBytes),
    tx_length: txBytes.length.toString(),
    coinbase_attester_pubkey_x: bytesToNoirInput(hexToByteArray(coinbasePubkeyCoords.x)),
    coinbase_attester_pubkey_y: bytesToNoirInput(hexToByteArray(coinbasePubkeyCoords.y)),
    coinbase_signer_merkle_proof: paddedProof,
    coinbase_signer_leaf_index: leafIndex.toString(),
    merkle_proof_depth: depth.toString(),
  };
}
