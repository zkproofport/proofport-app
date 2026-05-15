/**
 * GIWA-specific helpers for verifying the on-chain attestAccount tx and
 * building circuit inputs against the GIWA Sepolia mock attester.
 *
 * Mirrors coinbaseKyc.ts but uses GIWA constants:
 * - to_address: MockCoinbaseAttester on GIWA Sepolia
 * - authorized signer set: a single mock Upbit attester EOA
 */
import {ethers} from 'ethers';
import {
  extractPubkeyCoordinates,
  hexToByteArray,
  padArray,
  bytesToNoirInput,
  SimpleMerkleTree,
  recoverTxSignerPubkey,
  computeScope,
  computeNullifier,
  type CoinbaseKycCircuitInputs,
} from './coinbaseKyc';

// On-chain attest target — has to match GIWA_ATTESTER_CONTRACT inside the
// giwa_attestation Noir circuit.
export const GIWA_MOCK_ATTESTER_CONTRACT =
  '0x6646d970499BBeD728636823A5A7e551E811b414';

// PoC attester EOA (the wallet that signs attestAccount txs in our PoC).
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
        error: `Transaction not sent to MockCoinbaseAttester on GIWA (got ${tx.to})`,
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

export function prepareGiwaCircuitInputs(
  signalHash: Uint8Array,
  userAddress: string,
  userSignature: string,
  userPubkey: string,
  rawTransaction: string,
  attesterSignerIndex: number,
  scopeString: string,
): CoinbaseKycCircuitInputs {
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
  const nullifierBytes = computeNullifier(userAddress, signalHash, scopeBytes);

  return {
    signal_hash: bytesToNoirInput(Array.from(signalHash)),
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
