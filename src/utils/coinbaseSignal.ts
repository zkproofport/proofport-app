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

/**
 * The deterministic signal hash of either Coinbase circuit with a device
 * statement: keccak256(abi.encodePacked(address, scope, circuitId)), the id
 * being the canonical one (Coinbase Country v1 and v2 compute it the same
 * way). Any other id is an error.
 */
export function coinbaseSignalHashFor(circuit: string, userAddress: string, scopeString: string): Uint8Array {
  if (circuit !== 'coinbase_attestation' && circuit !== 'coinbase_country_attestation') {
    throw new Error(`No Coinbase signal hash for circuit '${circuit}'. Known: coinbase_attestation, coinbase_country_attestation.`);
  }
  const preimage = ethers.utils.solidityPack(['address', 'string', 'string'], [userAddress, scopeString, circuit]);
  return ethers.utils.arrayify(ethers.utils.keccak256(preimage));
}
