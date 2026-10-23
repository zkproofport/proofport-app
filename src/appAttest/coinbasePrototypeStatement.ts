/**
 * The proof screen's one call for the App Attest prototype: given the wallet,
 * the attestation it found and the request, return the statement the circuit
 * needs -- or throw an AppAttestError whose code is the ErrorModal to show.
 *
 * Runs before the wallet is asked to sign, so a phone without App Attest, an
 * Android phone or a revoked verification is told so without a signature
 * prompt first. That is possible because the digest the wallet will sign is
 * known in advance: the signal hash is deterministic, and an EIP-712 action's
 * digest is fixed by the action.
 */
import {ethers} from 'ethers';
import type {TypedAction} from '../config/circuitIds';
import {computeScope} from '../utils/circuitHelpers';
import {coinbaseSignalHash} from '../utils/coinbaseSignal';
import {signedDigestOf, whatTheWalletSigns} from '../utils/signedAction';
import {getAppAttestNative, type AppAttestNative} from './nativeAppAttest';
import type {AppAttestDeps} from './appAttestKey';
import {makeRevocationStatement, type AppAttestWitness, type RevocationDeps} from './revocationStatement';

export interface CoinbasePrototypeRequest {
  walletAddress: string;
  attestationUid: string;
  scopeString: string;
  action?: TypedAction;
  log: (msg: string) => void;
}

/** The digest the wallet will sign for this request -- the clientData's offset 161. */
export function coinbaseRequestDigest(walletAddress: string, scopeString: string, action?: TypedAction): string {
  const signal = action ? new Uint8Array(32) : coinbaseSignalHash(walletAddress, scopeString);
  return signedDigestOf(whatTheWalletSigns(ethers.utils.hexlify(signal), action));
}

export async function prepareCoinbasePrototypeStatement(
  req: CoinbasePrototypeRequest,
  overrides: {
    native?: AppAttestNative;
    /** Tests only: a synthetic CA pin and an in-memory key store. */
    keyDeps?: Pick<AppAttestDeps, 'storage' | 'pinnedCaKeyHash'>;
    revocation?: Omit<RevocationDeps, 'appAttest'>;
  } = {},
): Promise<AppAttestWitness> {
  // Throws E2010 on Android and E2009 when the module is missing.
  const native = overrides.native ?? getAppAttestNative();
  return makeRevocationStatement(
    {
      wallet: req.walletAddress,
      attestationUid: req.attestationUid,
      requestDigest: coinbaseRequestDigest(req.walletAddress, req.scopeString, req.action),
      scope: computeScope(req.scopeString),
    },
    {...overrides.revocation, appAttest: {...overrides.keyDeps, native, log: req.log}},
  );
}
