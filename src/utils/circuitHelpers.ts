/**
 * Circuit-agnostic helpers for building Noir proof inputs.
 *
 * Generic utilities (pubkey coordinate extraction, byte/hex conversion,
 * Merkle tree, signature recovery, scope/nullifier hashing, input flattening)
 * shared by every attestation circuit (Coinbase, GIWA, future issuers).
 *
 * Circuit-specific constants (attester contract address, authorized signer
 * set) live next to their circuit in coinbaseKyc.ts / giwaKyc.ts / etc.
 *
 * NOTE: The field names inside `AttesterCircuitInputs` (e.g.
 * `coinbase_signer_merkle_proof`) are the Noir circuit ABI for circuits
 * forked from coinbase_attestation. They must match `main.nr` exactly and
 * are not renamed here — circuit-side renaming is a separate task.
 */
import {ethers} from 'ethers';

export function extractPubkeyCoordinates(pubkey: string): {x: string; y: string} {
  // Remove 0x04 prefix if present (uncompressed pubkey format)
  const pubkeyHex = pubkey.startsWith('0x04') ? pubkey.slice(4) : pubkey.slice(2);
  const x = '0x' + pubkeyHex.slice(0, 64);
  const y = '0x' + pubkeyHex.slice(64, 128);
  return {x, y};
}

export function hexToByteArray(hex: string): number[] {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }
  return bytes;
}

export function padArray(arr: number[], targetLength: number): number[] {
  const result = [...arr];
  while (result.length < targetLength) {
    result.push(0);
  }
  return result;
}

export function bytesToNoirInput(bytes: number[]): string[] {
  return bytes.map(b => '0x' + b.toString(16).padStart(2, '0'));
}

export class SimpleMerkleTree {
  private leaves: string[];
  private layers: string[][];

  constructor(addresses: string[]) {
    this.leaves = addresses.map(addr => {
      const addrBytes = ethers.utils.arrayify(ethers.utils.getAddress(addr));
      return ethers.utils.keccak256(addrBytes);
    });

    this.layers = [this.leaves];
    let currentLayer = this.leaves;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1] || left;
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
        proof.push(layer[idx]);
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

export async function signMessage(
  sdk: any,
  account: string,
  messageHash: string,
): Promise<{signature: string; r: string; s: string; v: number}> {
  const signature = await sdk.request({
    method: 'personal_sign',
    params: [messageHash, account],
  });

  const sig = ethers.utils.splitSignature(signature);
  return {
    signature,
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
}

export function recoverPublicKey(messageHash: string, signature: string): string {
  const ethSignedHash = ethers.utils.hashMessage(ethers.utils.arrayify(messageHash));
  const recoveredPubKey = ethers.utils.recoverPublicKey(ethSignedHash, signature);
  return recoveredPubKey;
}

export function createUnsignedTxHash(rawTx: string): string {
  const tx = ethers.utils.parseTransaction(rawTx);

  const unsignedTx: ethers.utils.UnsignedTransaction = {
    to: tx.to,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    data: tx.data,
    value: tx.value,
    chainId: tx.chainId,
    type: 2,
  };

  const serialized = ethers.utils.serializeTransaction(unsignedTx);
  return ethers.utils.keccak256(serialized);
}

export function extractTxSignature(rawTx: string): {r: string; s: string; v: number} {
  const tx = ethers.utils.parseTransaction(rawTx);
  return {
    r: tx.r || '0x',
    s: tx.s || '0x',
    v: tx.v || 0,
  };
}

export function recoverTxSignerPubkey(rawTx: string): string {
  const tx = ethers.utils.parseTransaction(rawTx);
  const unsignedTxHash = createUnsignedTxHash(rawTx);

  const signature = ethers.utils.joinSignature({
    r: tx.r!,
    s: tx.s!,
    v: tx.v!,
  });

  return ethers.utils.recoverPublicKey(unsignedTxHash, signature);
}

export function computeScope(scopeString: string): Uint8Array {
  const scopeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(scopeString));
  return ethers.utils.arrayify(scopeHash);
}

function computeUserSecret(userAddressBytes: Uint8Array, signalHashBytes: Uint8Array): Uint8Array {
  const preimage = ethers.utils.concat([userAddressBytes, signalHashBytes]);
  return ethers.utils.arrayify(ethers.utils.keccak256(preimage));
}

export function computeNullifier(
  userAddress: string,
  signalHash: Uint8Array,
  scopeBytes: Uint8Array,
): Uint8Array {
  const userAddressBytes = ethers.utils.arrayify(userAddress);
  const userSecret = computeUserSecret(userAddressBytes, signalHash);
  const preimage = ethers.utils.concat([userSecret, scopeBytes]);
  return ethers.utils.arrayify(ethers.utils.keccak256(preimage));
}

/**
 * Circuit-agnostic input shape for attester circuits (Coinbase, GIWA, …).
 *
 * Field names (`coinbase_signer_merkle_proof`, `coinbase_attester_pubkey_x`,
 * etc.) are the Noir circuit ABI inherited from the original
 * `coinbase_attestation` circuit. Forks (GIWA) reuse the same field names
 * because the underlying circuit was forked. Renaming the fields requires
 * regenerating the circuit and is tracked as a separate task.
 */
export interface AttesterCircuitInputs {
  // Public inputs
  signal_hash: string[];
  signer_list_merkle_root: string[];
  scope: string[];
  nullifier: string[];

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

export function flattenCircuitInputs(inputs: AttesterCircuitInputs): string[] {
  return [
    ...inputs.signal_hash,
    ...inputs.signer_list_merkle_root,
    ...inputs.scope,
    ...inputs.nullifier,
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
