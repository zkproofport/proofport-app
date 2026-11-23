/**
 * What the wallet signs, in one place, for both circuits.
 *
 * The same decision — "is this the typed-action circuit or the signal-hash
 * one?" — was made three times, in three files, off the same variable:
 *
 *   - the signing call chose `eth_signTypedData_v4` or `personal_sign`
 *   - the recovery chose whether to add the personal_sign prefix
 *   - the circuit input builder chose whether to emit the two hashes
 *
 * They have to agree. When they did not, nothing failed at the point of
 * disagreement: the signature succeeded, the recovery returned a well-formed
 * key for a wallet nobody controls, the input vector was the right length, and
 * the prover ended with `MoproError.NoirError` — a sentence that names none of
 * it. That took hours to find on 2026-09-12, twice, because fixing one place
 * left the others.
 *
 * So the decision is made once, here, and the three callers read the answer.
 */
import {ethers} from 'ethers';
import type {TypedAction} from '../config/circuitIds';
import {signalHashBytes, type SignalHashRequest} from './signalHash';

export interface SignedThing {
  /** What to ask the wallet for. */
  method: 'eth_signTypedData_v4' | 'personal_sign';
  /**
   * The digest the signature is over.
   *
   * For typed data this is keccak256(0x1901 ++ domainSeparator ++ structHash),
   * which is what the action-binding circuit rebuilds from its own public
   * inputs. For personal_sign it is the signal hash, and the prefix is added
   * by the wallet and by whoever recovers.
   */
  digest: string;
  /** True when the digest is signed as-is, with no personal_sign prefix. */
  prefixed: boolean;
  /**
   * The two hashes that are PUBLIC INPUTS of the action-bound circuit, or
   * undefined for the circuit that has no such inputs. Not a convenience:
   * leaving them out builds a vector the prover reads as another circuit's.
   */
  publicHashes?: {domainSeparator: string; actionHash: string};
  /** Exactly what to put in the wallet request, after the address. */
  params: unknown[];
}

/**
 * `EIP712Domain`, which wallets require in the wire payload.
 *
 * ethers adds it for you when hashing and does NOT expect it in `types`, but a
 * wallet rejects the request as malformed without it — so it belongs here, on
 * the wire side, and must never reach the hashing side or the digest changes.
 */
const EIP712_DOMAIN_FIELDS = [
  {name: 'name', type: 'string'},
  {name: 'version', type: 'string'},
  {name: 'chainId', type: 'uint256'},
  {name: 'verifyingContract', type: 'address'},
];

/**
 * What a wallet credential request with no dApp action asks the wallet to
 * sign: the request itself, as readable EIP-712 fields.
 *
 * It used to be personal_sign over the 32-byte signal_hash, which a wallet
 * shows as unreadable bytes -- the kind of prompt a person should refuse
 * (Coinbase Wallet, demo Coinbase KYC request, 2026-11-23). The circuits
 * already take an EIP-712 digest (coinbase-libs signed_message.nr: action
 * mode, signal_hash zero), so this needs no circuit change.
 *
 * The domain has no chainId on purpose: a chainId makes a wallet switch
 * networks first, an extra prompt for a request that names no chain. The
 * fields are exactly the signal_hash preimage (scope, circuit, request id),
 * so a verifier that issued the request can rebuild the struct hash from
 * what it already holds.
 */
export const PROOF_REQUEST_DOMAIN = Object.freeze({name: 'ZKProofport', version: '1'});
export const PROOF_REQUEST_PRIMARY_TYPE = 'ProofRequest';
export const PROOF_REQUEST_TYPES = Object.freeze({
  ProofRequest: [
    {name: 'statement', type: 'string'},
    {name: 'scope', type: 'string'},
    {name: 'proof', type: 'string'},
    {name: 'requestId', type: 'string'},
  ],
});
export const PROOF_REQUEST_STATEMENT = 'Approve this proof request in ZKProofport';

const DOMAIN_FIELD_TYPES: Record<string, string> = {
  name: 'string',
  version: 'string',
  chainId: 'uint256',
  verifyingContract: 'address',
};

function typedSigned(
  domain: Record<string, unknown>,
  types: Record<string, Array<{name: string; type: string}>>,
  primaryType: string,
  message: Record<string, unknown>,
): SignedThing {
  // The wire EIP712Domain must list exactly the fields the domain has, in
  // the standard order, or the wallet hashes a different domain.
  const domainFields = Object.keys(DOMAIN_FIELD_TYPES)
    .filter(k => domain[k] !== undefined)
    .map(k => ({name: k, type: DOMAIN_FIELD_TYPES[k]}));
  const unknown = Object.keys(domain).filter(k => !(k in DOMAIN_FIELD_TYPES));
  if (unknown.length > 0) {
    throw new Error(`Unsupported EIP-712 domain field(s): ${unknown.join(', ')}. Supported: ${Object.keys(DOMAIN_FIELD_TYPES).join(', ')}.`);
  }
  const mutableTypes = Object.fromEntries(Object.entries(types).map(([k, v]) => [k, v.map(f => ({...f}))]));
  return {
    method: 'eth_signTypedData_v4',
    params: [
      JSON.stringify({
        domain,
        types: {EIP712Domain: domainFields, ...mutableTypes},
        primaryType,
        message,
      }),
    ],
    digest: ethers.utils._TypedDataEncoder.hash(domain, mutableTypes, message),
    prefixed: false,
    publicHashes: {
      domainSeparator: ethers.utils._TypedDataEncoder.hashDomain(domain),
      actionHash: ethers.utils._TypedDataEncoder.hashStruct(primaryType, mutableTypes, message),
    },
  };
}

/** The readable request a wallet signs when the dApp bound no action. Throws on a scope or request id outside the signal_hash rules. */
export function proofRequestMessage(request: SignalHashRequest): Record<string, string> {
  // Same rules as signal_hash (core's computeSignalHash): a request a
  // verifier could not recompute is refused here, before any prompt.
  signalHashBytes(request);
  return {
    statement: PROOF_REQUEST_STATEMENT,
    scope: request.scope,
    proof: request.circuitId,
    requestId: request.requestId,
  };
}

/**
 * Everything a wallet credential hook needs about the signature, for both
 * kinds of request: the signal_hash the circuit gets (always zero now -- the
 * circuit refuses a proof that carries both) and what the wallet signs.
 */
export function walletSigning(
  request: SignalHashRequest,
  action?: TypedAction,
): {signalHash: Uint8Array; signed: SignedThing} {
  const signalHash = new Uint8Array(32);
  if (action) {
    return {signalHash, signed: whatTheWalletSigns(ethers.utils.hexlify(signalHash), action)};
  }
  const message = proofRequestMessage(request);
  return {
    signalHash,
    signed: typedSigned({...PROOF_REQUEST_DOMAIN}, PROOF_REQUEST_TYPES as any, PROOF_REQUEST_PRIMARY_TYPE, message),
  };
}

/**
 * Resolve, from the action alone, everything the three callers need.
 *
 * The circuit id is NOT consulted here on purpose: the hook has already
 * refused the mismatched combinations — an action-bound circuit with no
 * action, and an action on a circuit that cannot carry one — so by this point
 * the presence of an action IS the answer, and asking twice would let the two
 * answers differ.
 */
export function whatTheWalletSigns(signalHashHex: string, action?: TypedAction): SignedThing {
  if (!action) {
    return {
      method: 'personal_sign',
      digest: signalHashHex,
      prefixed: true,
      params: [signalHashHex],
    };
  }
  return {
    method: 'eth_signTypedData_v4',
    params: [
      JSON.stringify({
        domain: action.domain,
        types: {EIP712Domain: EIP712_DOMAIN_FIELDS, ...action.types},
        primaryType: action.primaryType,
        message: action.message,
      }),
    ],
    digest: ethers.utils._TypedDataEncoder.hash(action.domain, action.types, action.message),
    prefixed: false,
    publicHashes: {
      domainSeparator: ethers.utils._TypedDataEncoder.hashDomain(action.domain),
      actionHash: ethers.utils._TypedDataEncoder.hashStruct(
        action.primaryType,
        action.types,
        action.message,
      ),
    },
  };
}

/** The signer's public key, recovered the way this signature was made. */
export function recoverSignerPubkey(signed: SignedThing, signature: string): string {
  const hash = signed.prefixed
    ? ethers.utils.hashMessage(ethers.utils.arrayify(signed.digest))
    : ethers.utils.arrayify(signed.digest);
  return ethers.utils.recoverPublicKey(hash, signature);
}

/**
 * The exact 32 bytes the wallet's signature is over: the EIP-191 hash of the
 * signal for personal_sign, the EIP-712 digest for typed data. It is what the
 * circuits' `signed_digest` rebuilds, and what the App Attest clientData
 * carries as its request digest (offset 161).
 */
export function signedDigestOf(signed: SignedThing): string {
  return signed.prefixed
    ? ethers.utils.hashMessage(ethers.utils.arrayify(signed.digest))
    : ethers.utils.hexlify(ethers.utils.arrayify(signed.digest));
}
