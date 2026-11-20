/**
 * The `signal_hash` a wallet credential proof carries when no EIP-712 action
 * is bound.
 *
 *   signal_hash = keccak256(abi.encodePacked(string scope, string circuitId, string requestId))
 *
 * MIRROR of `@zkproofport-app/core`'s `computeSignalHash`
 * (proofport-app-sdk packages/core/src/signalHash.ts), with the same
 * accept/refuse rules. The installed core
 * (0.4.0-beta.8) does not ship it yet; once a later core release does,
 * delete this file's bodies and import it from `src/config/circuitIds.ts`.
 * Held to the shared vectors in `__tests__/fixtures/signal-hash-vectors.json`,
 * a byte-identical copy of the SDK's (the parent repository's
 * `scripts/check-signal-hash-vectors.sh` compares the copies).
 *
 * Why no wallet address: signal_hash is a PUBLIC input. With the address in
 * its preimage, anyone could try every address in the public attestation set
 * and recover the prover. The nullifier now comes from the OPRF, so no circuit
 * needs a stable per-wallet value here; the request id makes the hash fresh
 * per request and lets the requester recompute and check it.
 *
 * `requestId` is the relay request's id for a dApp request, or the id this app
 * mints (`newStandaloneRequestId`) for an in-app proof -- the same one stored
 * in History. ASCII letters, digits and '-' only: every circuit id contains
 * '_', so the packed bytes split back into one (scope, requestId) pair.
 */
import {ethers} from 'ethers';
import {ALL_CIRCUIT_IDS, isCircuitId, type CircuitName} from '../config/circuitIds';

export const SIGNAL_HASH_MAX_SCOPE_BYTES = 4096;
export const SIGNAL_HASH_MAX_REQUEST_ID_LENGTH = 128;

const REQUEST_ID = /^[A-Za-z0-9-]+$/;

/** Which circuits carry a signal_hash. `false` = the circuit has none. */
const HAS_SIGNAL_HASH: Readonly<Record<CircuitName, boolean>> = Object.freeze({
  coinbase_attestation: true,
  coinbase_country_attestation: true,
  // An ID token, not a wallet signature; its request binding is the OIDC nonce.
  oidc_domain_attestation: false,
  giwa_attestation: true,
  dojang_playground: true,
  human_passport_score: true,
});

export const SIGNAL_HASH_CIRCUIT_IDS: readonly CircuitName[] = Object.freeze(
  ALL_CIRCUIT_IDS.filter(id => HAS_SIGNAL_HASH[id]),
);

function loneSurrogateAt(value: string): number {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return i;
  }
  return -1;
}

function requireSignalCircuit(circuitId: unknown): void {
  if (!isCircuitId(circuitId)) {
    throw new Error(`Unknown circuit '${String(circuitId)}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}.`);
  }
  if (!HAS_SIGNAL_HASH[circuitId]) {
    throw new Error(`${circuitId} has no signal_hash. Circuits that do: ${SIGNAL_HASH_CIRCUIT_IDS.join(', ')}.`);
  }
}

/** Why this scope cannot be hashed, or null. */
export function signalHashScopeError(scope: unknown): string | null {
  if (typeof scope !== 'string') return `scope must be a string, got ${scope === null ? 'null' : typeof scope}.`;
  if (scope.trim() === '') return 'scope is empty.';
  const at = loneSurrogateAt(scope);
  if (at >= 0) return `scope is not valid Unicode text: unpaired surrogate at index ${at}.`;
  const bytes = ethers.utils.toUtf8Bytes(scope).length;
  if (bytes > SIGNAL_HASH_MAX_SCOPE_BYTES) {
    return `scope is ${bytes} bytes; the limit is ${SIGNAL_HASH_MAX_SCOPE_BYTES}.`;
  }
  return null;
}

/** Why this request id cannot be hashed, or null. */
export function signalHashRequestIdError(requestId: unknown): string | null {
  if (typeof requestId !== 'string') {
    return `requestId must be a string, got ${requestId === null ? 'null' : typeof requestId}.`;
  }
  if (requestId.length === 0) return 'requestId is empty.';
  if (requestId.length > SIGNAL_HASH_MAX_REQUEST_ID_LENGTH) {
    return `requestId is ${requestId.length} characters; the limit is ${SIGNAL_HASH_MAX_REQUEST_ID_LENGTH}.`;
  }
  if (!REQUEST_ID.test(requestId)) {
    return `requestId may hold only ASCII letters, digits and '-', got ${JSON.stringify(requestId)}.`;
  }
  return null;
}

export interface SignalHashRequest {
  scope: string;
  circuitId: string;
  requestId: string;
}

/** signal_hash as 0x-prefixed lowercase hex. Throws naming the problem. */
export function computeSignalHash(request: SignalHashRequest): string {
  requireSignalCircuit(request.circuitId);
  const scopeError = signalHashScopeError(request.scope);
  if (scopeError) throw new Error(scopeError);
  const idError = signalHashRequestIdError(request.requestId);
  if (idError) throw new Error(idError);
  const packed = ethers.utils.concat([
    ethers.utils.toUtf8Bytes(request.scope),
    ethers.utils.toUtf8Bytes(request.circuitId),
    ethers.utils.toUtf8Bytes(request.requestId),
  ]);
  return ethers.utils.keccak256(packed).toLowerCase();
}

/** The same, as 32 bytes. */
export function signalHashBytes(request: SignalHashRequest): Uint8Array {
  return ethers.utils.arrayify(computeSignalHash(request));
}
