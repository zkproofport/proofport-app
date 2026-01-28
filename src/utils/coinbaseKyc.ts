import {ethers} from 'ethers';

// Authorized Coinbase signers (from reference implementation)
export const AUTHORIZED_SIGNERS = [
  '0x952f32128AF084422539C4Ff96df5C525322E564',
  '0x8844591D47F17bcA6F5dF8f6B64F4a739F1C0080',
  '0x88fe64ea2e121f49bb77abea6c0a45e93638c3c5',
  '0x44ace9abb148e8412ac4492e9a1ae6bd88226803',
];

// Coinbase Attester Contract address
export const COINBASE_ATTESTER_CONTRACT = '0x357458739F90461b99789350868CD7CF330Dd7EE';

/**
 * Extract x and y coordinates from a public key
 */
export function extractPubkeyCoordinates(pubkey: string): {x: string; y: string} {
  // Remove 0x04 prefix if present (uncompressed pubkey format)
  const pubkeyHex = pubkey.startsWith('0x04') ? pubkey.slice(4) : pubkey.slice(2);
  const x = '0x' + pubkeyHex.slice(0, 64);
  const y = '0x' + pubkeyHex.slice(64, 128);
  return {x, y};
}

/**
 * Convert hex string to byte array for Noir circuit
 */
export function hexToByteArray(hex: string): number[] {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Pad array to target length with zeros
 */
export function padArray(arr: number[], targetLength: number): number[] {
  const result = [...arr];
  while (result.length < targetLength) {
    result.push(0);
  }
  return result;
}

/**
 * Convert byte array to Noir input format (string array)
 */
export function bytesToNoirInput(bytes: number[]): string[] {
  return bytes.map(b => '0x' + b.toString(16).padStart(2, '0'));
}

/**
 * Simple Merkle Tree implementation for signer verification
 */
export class SimpleMerkleTree {
  private leaves: string[];
  private layers: string[][];

  constructor(addresses: string[]) {
    // Create leaf hashes: keccak256(address_bytes)
    this.leaves = addresses.map(addr => {
      const addrBytes = ethers.utils.arrayify(ethers.utils.getAddress(addr));
      return ethers.utils.keccak256(addrBytes);
    });

    // Build layers
    this.layers = [this.leaves];
    let currentLayer = this.leaves;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1] || left; // Duplicate last if odd
        // Hash pair (no sorting to match circuit)
        const combined = ethers.utils.concat([
          ethers.utils.arrayify(left),
          ethers.utils.arrayify(right),
        ]);
        nextLayer.push(ethers.utils.keccak256(combined));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  getRoot(): string {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): {proof: string[]; leafIndex: number; depth: number} {
    const proof: string[] = [];
    let idx = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;

      if (siblingIdx < layer.length) {
        proof.push(layer[siblingIdx]);
      } else {
        proof.push(layer[idx]); // Duplicate if no sibling
      }

      idx = Math.floor(idx / 2);
    }

    return {
      proof,
      leafIndex: index,
      depth: proof.length,
    };
  }

  getLeafHash(index: number): string {
    return this.leaves[index];
  }
}

/**
 * Sign a message with MetaMask and return the signature components
 */
export async function signMessage(
  sdk: any,
  account: string,
  messageHash: string,
): Promise<{signature: string; r: string; s: string; v: number}> {
  // Use personal_sign for Ethereum signed message
  const signature = await sdk.request({
    method: 'personal_sign',
    params: [messageHash, account],
  });

  // Parse signature into r, s, v
  const sig = ethers.utils.splitSignature(signature);
  return {
    signature,
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
}

/**
 * Recover public key from signature
 */
export function recoverPublicKey(messageHash: string, signature: string): string {
  // Create the Ethereum signed message hash
  const ethSignedHash = ethers.utils.hashMessage(ethers.utils.arrayify(messageHash));
  const recoveredPubKey = ethers.utils.recoverPublicKey(ethSignedHash, signature);
  return recoveredPubKey;
}

/**
 * Create unsigned transaction hash for EIP-1559 transaction
 * This is used to verify the Coinbase attester's signature
 */
export function createUnsignedTxHash(rawTx: string): string {
  // Parse the transaction
  const tx = ethers.utils.parseTransaction(rawTx);

  // Reconstruct the unsigned transaction for EIP-1559
  const unsignedTx: ethers.utils.UnsignedTransaction = {
    to: tx.to,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    data: tx.data,
    value: tx.value,
    chainId: tx.chainId,
    type: 2, // EIP-1559
  };

  // Serialize and hash
  const serialized = ethers.utils.serializeTransaction(unsignedTx);
  return ethers.utils.keccak256(serialized);
}

/**
 * Extract signature from parsed transaction
 */
export function extractTxSignature(rawTx: string): {r: string; s: string; v: number} {
  const tx = ethers.utils.parseTransaction(rawTx);
  return {
    r: tx.r || '0x',
    s: tx.s || '0x',
    v: tx.v || 0,
  };
}

/**
 * Recover signer's public key from transaction
 */
export function recoverTxSignerPubkey(rawTx: string): string {
  const tx = ethers.utils.parseTransaction(rawTx);
  const unsignedTxHash = createUnsignedTxHash(rawTx);

  // Create signature from transaction components
  const signature = ethers.utils.joinSignature({
    r: tx.r!,
    s: tx.s!,
    v: tx.v!,
  });

  return ethers.utils.recoverPublicKey(unsignedTxHash, signature);
}

/**
 * Verify that a transaction is a valid Coinbase attestation
 */
export function verifyAttestationTx(
  rawTx: string,
  expectedUserAddress: string,
): {valid: boolean; error?: string; signerAddress?: string} {
  try {
    const tx = ethers.utils.parseTransaction(rawTx);

    // Check destination is Coinbase Attester Contract
    if (tx.to?.toLowerCase() !== COINBASE_ATTESTER_CONTRACT.toLowerCase()) {
      return {valid: false, error: 'Transaction not sent to Coinbase Attester Contract'};
    }

    // Check function selector (attestAccount)
    const selector = tx.data.slice(0, 10);
    if (selector !== '0x56feed5e') {
      return {valid: false, error: 'Invalid function selector'};
    }

    // Extract address from calldata
    const calldataAddress = '0x' + tx.data.slice(34, 74);
    if (calldataAddress.toLowerCase() !== expectedUserAddress.toLowerCase()) {
      return {valid: false, error: 'Calldata address does not match user address'};
    }

    // Recover signer address
    const signerPubkey = recoverTxSignerPubkey(rawTx);
    const signerAddress = ethers.utils.computeAddress(signerPubkey);

    // Check if signer is authorized
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

/**
 * Prepare all inputs for the Coinbase KYC circuit
 */
export interface CoinbaseKycCircuitInputs {
  // Public inputs
  signal_hash: string[];
  signer_list_merkle_root: string[];

  // Private inputs
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
}

export function prepareCircuitInputs(
  signalHash: Uint8Array,
  userAddress: string,
  userSignature: string,
  userPubkey: string,
  rawTransaction: string,
  coinbaseSignerIndex: number,
): CoinbaseKycCircuitInputs {
  // Build Merkle tree from authorized signers
  const merkleTree = new SimpleMerkleTree(AUTHORIZED_SIGNERS);
  const merkleRoot = merkleTree.getRoot();
  const {proof: merkleProof, leafIndex, depth} = merkleTree.getProof(coinbaseSignerIndex);

  // Extract user pubkey coordinates
  const userPubkeyCoords = extractPubkeyCoordinates(userPubkey);

  // Parse user signature (remove v, keep r + s)
  const userSig = ethers.utils.splitSignature(userSignature);
  const userSigBytes = [
    ...hexToByteArray(userSig.r),
    ...hexToByteArray(userSig.s),
  ];

  // Get raw transaction bytes and pad to 300
  const txBytes = hexToByteArray(rawTransaction);
  const paddedTxBytes = padArray(txBytes, 300);

  // Recover Coinbase signer pubkey from transaction
  const coinbasePubkey = recoverTxSignerPubkey(rawTransaction);
  const coinbasePubkeyCoords = extractPubkeyCoordinates(coinbasePubkey);

  // Pad merkle proof to depth 8 (max 256 signers)
  const paddedProof: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (i < merkleProof.length) {
      paddedProof.push(...bytesToNoirInput(hexToByteArray(merkleProof[i])));
    } else {
      // Pad with zeros
      paddedProof.push(...bytesToNoirInput(new Array(32).fill(0)));
    }
  }

  return {
    // Public inputs
    signal_hash: bytesToNoirInput(Array.from(signalHash)),
    signer_list_merkle_root: bytesToNoirInput(hexToByteArray(merkleRoot)),

    // Private inputs
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

/**
 * Flatten circuit inputs to a single array for mopro
 */
export function flattenCircuitInputs(inputs: CoinbaseKycCircuitInputs): string[] {
  return [
    // Public inputs first
    ...inputs.signal_hash,
    ...inputs.signer_list_merkle_root,

    // Private inputs
    ...inputs.user_address,
    ...inputs.user_signature,
    ...inputs.user_pubkey_x,
    ...inputs.user_pubkey_y,
    ...inputs.raw_transaction,
    inputs.tx_length,
    ...inputs.coinbase_attester_pubkey_x,
    ...inputs.coinbase_attester_pubkey_y,
    ...inputs.coinbase_signer_merkle_proof,
    inputs.coinbase_signer_leaf_index,
    inputs.merkle_proof_depth,
  ];
}

