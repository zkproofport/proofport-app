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

export interface SignedThing {
  /** What to ask the wallet for. */
  method: 'eth_signTypedData_v4' | 'personal_sign';
  /**
   * The digest the signature is over.
   *
   * For typed data this is keccak256(0x1901 ++ domainSeparator ++ structHash),
   * which is what the Arc circuit rebuilds from its own public inputs. For
   * personal_sign it is the signal hash, and the prefix is added by the wallet
   * and by whoever recovers.
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
