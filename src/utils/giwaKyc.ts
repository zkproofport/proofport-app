/**
 * GIWA-specific constants and helpers for the on-chain attestAccount tx and
 * GIWA circuit input preparation against MockGiwaAttester on GIWA Sepolia.
 *
 * Circuit-agnostic helpers (Merkle tree, pubkey/sig recovery, scope/nullifier
 * hashing, input flattening, AttesterCircuitInputs) live in `circuitHelpers.ts`.
 */
import {ethers} from 'ethers';
import {
  AttesterCircuitInputs,
  SimpleMerkleTree,
  bytesToNoirInput,
  computeScope,
  computeWalletNullifier,
  extractPubkeyCoordinates,
  hexToByteArray,
  padArray,
  recoverTxSignerPubkey,
} from './circuitHelpers';

// On-chain attest target — must match GIWA_ATTESTER_CONTRACT inside the
// giwa_attestation Noir circuit (circuits/giwa-attestation/src/main.nr).
export const GIWA_MOCK_ATTESTER_CONTRACT =
  '0x6646d970499BBeD728636823A5A7e551E811b414';

// PoC attester EOA (the wallet that signs attestAccount txs in the GIWA PoC).
// Replace with real Upbit-authorized addresses once the issuer onboards.
export const GIWA_AUTHORIZED_SIGNERS = [
  '0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b',
];

const SELECTOR_ATTEST_ACCOUNT = '0x56feed5e';

export function verifyGiwaAttestationTx(
  rawTx: string,
  expectedUserAddress: string,
): {valid: boolean; error?: string; signerAddress?: string} {
  try {
    const tx = ethers.utils.parseTransaction(rawTx);

    if (tx.to?.toLowerCase() !== GIWA_MOCK_ATTESTER_CONTRACT.toLowerCase()) {
      return {
        valid: false,
        error: `Transaction not sent to MockGiwaAttester on GIWA (got ${tx.to})`,
      };
    }

    const selector = tx.data.slice(0, 10);
    if (selector !== SELECTOR_ATTEST_ACCOUNT) {
      return {
        valid: false,
        error: `Invalid function selector ${selector}, expected ${SELECTOR_ATTEST_ACCOUNT}`,
      };
    }

    const calldataAddress = '0x' + tx.data.slice(34, 74);
    if (calldataAddress.toLowerCase() !== expectedUserAddress.toLowerCase()) {
      return {
        valid: false,
        error: `Calldata address ${calldataAddress} does not match expected ${expectedUserAddress}`,
      };
    }

    const signerPubkey = recoverTxSignerPubkey(rawTx);
    const signerAddress = ethers.utils.computeAddress(signerPubkey);
    const isAuthorized = GIWA_AUTHORIZED_SIGNERS.some(
      (a) => a.toLowerCase() === signerAddress.toLowerCase(),
    );
    if (!isAuthorized) {
      return {
        valid: false,
        error: `Signer ${signerAddress} is not in GIWA_AUTHORIZED_SIGNERS`,
        signerAddress,
      };
    }
    return {valid: true, signerAddress};
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Failed to parse GIWA tx',
    };
  }
}

/** The EIP-712 hashes a GIWA request carries, when it binds an action. */
export interface GiwaActionHashes {
  domainSeparator: string;
  actionHash: string;
}

const ZERO_32 = new Array(32).fill(0);

/**
 * The circuit's own name, hashed into the nullifier's secret preimage.
 *
 * It is a literal inside `giwa-attestation/src/main.nr` as well. The two must
 * agree or the proof fails with "Nullifier mismatch" and nothing points here.
 */
const CIRCUIT_ID = 'giwa_attestation';

export function prepareGiwaCircuitInputs(
  signalHash: Uint8Array,
  userAddress: string,
  userSignature: string,
  userPubkey: string,
  rawTransaction: string,
  attesterSignerIndex: number,
  scopeString: string,
  action?: GiwaActionHashes,
): AttesterCircuitInputs {
  const merkleTree = new SimpleMerkleTree(GIWA_AUTHORIZED_SIGNERS);
  const merkleRoot = merkleTree.getRoot();
  const {
    proof: merkleProof,
    leafIndex,
    depth,
  } = merkleTree.getProof(attesterSignerIndex);

  const userPubkeyCoords = extractPubkeyCoordinates(userPubkey);

  const userSig = ethers.utils.splitSignature(userSignature);
  const userSigBytes = [
    ...hexToByteArray(userSig.r),
    ...hexToByteArray(userSig.s),
  ];

  const txBytes = hexToByteArray(rawTransaction);
  const paddedTxBytes = padArray(txBytes, 300);

  const attesterPubkey = recoverTxSignerPubkey(rawTransaction);
  const attesterPubkeyCoords = extractPubkeyCoordinates(attesterPubkey);

  const paddedProof: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (i < merkleProof.length) {
      paddedProof.push(...bytesToNoirInput(hexToByteArray(merkleProof[i])));
    } else {
      paddedProof.push(...bytesToNoirInput(new Array(32).fill(0)));
    }
  }

  const scopeBytes = computeScope(scopeString);
  /*
   * The wallet and a constant, never `signal_hash`.
   *
   * The circuit stopped deriving its nullifier from `signal_hash` on
   * 2026-09-22: that value is a public input nothing constrains, so one wallet
   * could produce as many nullifiers as it liked for one scope. Both sides now
   * hash the address with keccak256("giwa_attestation").
   */
  const nullifierBytes = computeWalletNullifier(userAddress, CIRCUIT_ID, scopeBytes);

  /*
   * The two modes, as the circuit sees them. There is no null in a circuit, so
   * "absent" is 32 zero bytes, and the circuit refuses a request that fills
   * both sides: with an action, `signal_hash` MUST be empty.
   *
   * Both hashes are always emitted -- zeros when no action -- because the
   * vector is positional and 192 entries long either way. Leaving them out
   * would build the 128-entry vector of a different circuit, which the prover
   * rejects with a message naming none of this.
   */
  const boundToAction = action !== undefined;

  return {
    signal_hash: bytesToNoirInput(boundToAction ? ZERO_32 : Array.from(signalHash)),
    domain_separator: bytesToNoirInput(
      action ? hexToByteArray(action.domainSeparator) : ZERO_32,
    ),
    action_hash: bytesToNoirInput(action ? hexToByteArray(action.actionHash) : ZERO_32),
    signer_list_merkle_root: bytesToNoirInput(hexToByteArray(merkleRoot)),
    scope: bytesToNoirInput(Array.from(scopeBytes)),
    nullifier: bytesToNoirInput(Array.from(nullifierBytes)),
    user_address: bytesToNoirInput(hexToByteArray(userAddress)),
    user_signature: bytesToNoirInput(userSigBytes),
    user_pubkey_x: bytesToNoirInput(hexToByteArray(userPubkeyCoords.x)),
    user_pubkey_y: bytesToNoirInput(hexToByteArray(userPubkeyCoords.y)),
    raw_transaction: bytesToNoirInput(paddedTxBytes),
    tx_length: txBytes.length.toString(),
    coinbase_attester_pubkey_x: bytesToNoirInput(
      hexToByteArray(attesterPubkeyCoords.x),
    ),
    coinbase_attester_pubkey_y: bytesToNoirInput(
      hexToByteArray(attesterPubkeyCoords.y),
    ),
    coinbase_signer_merkle_proof: paddedProof,
    coinbase_signer_leaf_index: leafIndex.toString(),
    merkle_proof_depth: depth.toString(),
  };
}
