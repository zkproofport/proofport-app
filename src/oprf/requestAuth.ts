/**
 * The proof attached to an OPRF request (`request-auth-v1`,
 * circuits/oprf-request-auth): the wallet signed the EIP-712 OprfRequest,
 * and the blinded query is beta * encode(Poseidon2(DS, that wallet, domain,
 * scope)). Without it the nodes would evaluate any point, so anyone could ask
 * for the value behind every public address's nullifier.
 *
 *   fn main(digest: pub [u8; 32], domain: pub Field, scope: pub Field,
 *           user_pubkey_x: [u8; 32], user_pubkey_y: [u8; 32],
 *           user_signature: [u8; 64], beta: Field) -> pub BabyJubJubPoint
 *
 * Public inputs as the request verifier rebuilds them
 * (proofport-oprf/REQUEST-VERIFIER.md): digest one byte per field (0-31),
 * domain (32), scope (33), blinded query x (34), y (35). The proof the nodes
 * take is the bare proof, 9,152 bytes.
 */
import {ethers} from 'ethers';
import {oprfRequestDigest, reduceOprfName} from '@zkproofport-app/core';

export const REQUEST_AUTH_VERSION = 'request-auth-v1';
export const REQUEST_AUTH_PUBLIC_INPUTS = 36;
export const REQUEST_AUTH_PROOF_BYTES = 9152;
/** The ABI parameter names, in order: a downloaded file set with other names is refused. */
export const REQUEST_AUTH_ABI = Object.freeze(['digest', 'domain', 'scope', 'user_pubkey_x', 'user_pubkey_y', 'user_signature', 'beta']);

const byteStrings = (b: Uint8Array): string[] => Array.from(b, x => '0x' + x.toString(16).padStart(2, '0'));

export interface SignedOprfRequest {
  domainName: string;
  scopeName: string;
  deadline: number;
  /** 65-byte eth_signTypedData_v4 signature. */
  signature: string;
}

/**
 * The secp256k1 key that signed the request, checked to be `address`'s.
 * A signature from any other wallet is an error naming both.
 */
export function requestSignerKey(req: SignedOprfRequest, address: string): {x: Uint8Array; y: Uint8Array; digest: string} {
  const digest = oprfRequestDigest(req.domainName, req.scopeName, req.deadline);
  let pub: string;
  try {
    pub = ethers.utils.recoverPublicKey(digest, req.signature);
  } catch (e) {
    throw new Error(`The wallet's OPRF request signature is malformed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const signer = ethers.utils.computeAddress(pub);
  if (signer.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`The OPRF request was signed by ${signer}, not the proving wallet ${address}.`);
  }
  const bytes = ethers.utils.arrayify(pub);
  return {x: bytes.slice(1, 33), y: bytes.slice(33, 65), digest};
}

/** The circuit's flat input vector, in `fn main`'s order (32+1+1+32+32+64+1 = 163 values). */
export function requestAuthInputs(req: SignedOprfRequest, address: string, beta: string): string[] {
  const {x, y, digest} = requestSignerKey(req, address);
  const sig = ethers.utils.splitSignature(req.signature);
  const out = [
    ...byteStrings(ethers.utils.arrayify(digest)),
    reduceOprfName(req.domainName),
    reduceOprfName(req.scopeName),
    ...byteStrings(x),
    ...byteStrings(y),
    ...byteStrings(ethers.utils.arrayify(sig.r)),
    ...byteStrings(ethers.utils.arrayify(sig.s)),
    beta,
  ];
  if (out.length !== 163) throw new Error(`Built ${out.length} request-auth inputs; the circuit takes 163.`);
  return out;
}

/**
 * The public inputs a valid request proof carries: what the verifier rebuilds
 * from the request. Compared with the proof's own before sending, so a proof
 * the nodes would refuse (4506) is caught here with the index that differs.
 */
export function expectedRequestAuthPublicInputs(req: Omit<SignedOprfRequest, 'signature'>, blindedQuery: {x: string; y: string}): string[] {
  const digest = ethers.utils.arrayify(oprfRequestDigest(req.domainName, req.scopeName, req.deadline));
  const f = (v: string) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  return [
    ...Array.from(digest, b => f('0x' + b.toString(16))),
    f(reduceOprfName(req.domainName)),
    f(reduceOprfName(req.scopeName)),
    f(blindedQuery.x),
    f(blindedQuery.y),
  ];
}

export function checkRequestAuthProof(
  proof: {proof: Uint8Array; publicInputs: readonly string[]},
  expected: readonly string[],
): void {
  if (proof.proof.length !== REQUEST_AUTH_PROOF_BYTES) {
    throw new Error(`The request proof is ${proof.proof.length} bytes; ${REQUEST_AUTH_VERSION} proofs are ${REQUEST_AUTH_PROOF_BYTES}.`);
  }
  if (proof.publicInputs.length !== REQUEST_AUTH_PUBLIC_INPUTS) {
    throw new Error(`The request proof has ${proof.publicInputs.length} public inputs; ${REQUEST_AUTH_VERSION} has ${REQUEST_AUTH_PUBLIC_INPUTS}.`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (BigInt(proof.publicInputs[i]) !== BigInt(expected[i])) {
      throw new Error(`The request proof's public input ${i} is ${proof.publicInputs[i]}, not ${expected[i]}.`);
    }
  }
}
