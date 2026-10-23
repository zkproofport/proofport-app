/**
 * Kept apart from coinbaseKyc.ts, which reads the attestation config when it
 * loads; this is pure, so the App Attest path and its tests can use it without
 * pulling the config in.
 */
import {ethers} from 'ethers';

/**
 * Coinbase KYC's deterministic signal hash:
 * keccak256(abi.encodePacked(address, scope, "coinbase_attestation")).
 *
 * The id inside is the canonical circuit id whichever files prove it -- the
 * App Attest statement and the wallet sign the same request, so the statement
 * can be made before the wallet is asked.
 */
export function coinbaseSignalHash(userAddress: string, scopeString: string): Uint8Array {
  const preimage = ethers.utils.solidityPack(
    ['address', 'string', 'string'],
    [userAddress, scopeString, 'coinbase_attestation'],
  );
  return ethers.utils.arrayify(ethers.utils.keccak256(preimage));
}
