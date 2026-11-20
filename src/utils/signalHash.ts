/**
 * The `signal_hash` a wallet credential proof carries when no EIP-712 action
 * is bound.
 *
 *   signal_hash = keccak256(abi.encodePacked(string scope, string circuitId, string requestId))
 *
 * The rules and the hash are `@zkproofport-app/core`'s (`computeSignalHash`,
 * `signalHashScopeError`, `signalHashRequestIdError`, `SIGNAL_HASH_*`), the
 * same functions a verifier recomputes the value with. This module re-exports
 * them for the app and adds {@link signalHashBytes}, which core does not have.
 * Held to the shared vectors in `__tests__/fixtures/signal-hash-vectors.json`,
 * a byte-identical copy of the SDK's (the parent repository's
 * `scripts/check-signal-hash-vectors.sh` compares the copies).
 *
 * Why no wallet address: signal_hash is a PUBLIC input. With the address in
 * its preimage, anyone could try every address in the public attestation set
 * and recover the prover. The nullifier comes from the OPRF, so no circuit
 * needs a stable per-wallet value here; the request id makes the hash fresh
 * per request and lets the requester recompute and check it.
 *
 * `requestId` is the relay request's id for a dApp request, or the id this app
 * mints (`newStandaloneRequestId`) for an in-app proof -- the same one stored
 * in History. ASCII letters, digits and '-' only: every circuit id contains
 * '_', so the packed bytes split back into one (scope, requestId) pair.
 */
import {ethers} from 'ethers';
import {computeSignalHash} from '@zkproofport-app/core';

export {
  SIGNAL_HASH_CIRCUIT_IDS,
  SIGNAL_HASH_MAX_REQUEST_ID_LENGTH,
  SIGNAL_HASH_MAX_SCOPE_BYTES,
  computeSignalHash,
  signalHashRequestIdError,
  signalHashScopeError,
} from '@zkproofport-app/core';

/** What one proof's signal_hash is computed from. */
export interface SignalHashRequest {
  scope: string;
  circuitId: string;
  requestId: string;
}

/** signal_hash as 32 bytes (core's {@link computeSignalHash}, arrayified). Throws naming the problem. */
export function signalHashBytes(request: SignalHashRequest): Uint8Array {
  return ethers.utils.arrayify(computeSignalHash(request));
}
