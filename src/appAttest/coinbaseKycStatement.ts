/**
 * The proof screen's one call for Coinbase KYC v2's device statement: given
 * the wallet, the attestation it found and the request, return the statement
 * the circuit needs -- or throw an AppAttestError whose code is the
 * ErrorModal to show.
 *
 * The statement is signed by this phone's hardware key, which depends on the
 * platform (src/config/signerPlatform.ts): App Attest on iPhone
 * (`coinbase_attestation_v2`), Android key attestation on Android
 * (`coinbase_attestation_v2_android`). The lookup and the 225-byte clientData
 * are the same on both.
 *
 * Runs before the wallet is asked to sign, so a phone that cannot sign or a
 * revoked verification is told so without a signature prompt first. That is
 * possible because the digest the wallet will sign is known in advance: the
 * signal hash is deterministic, and an EIP-712 action's digest is fixed by
 * the action.
 */
import {ethers} from 'ethers';
import type {TypedAction} from '../config/circuitIds';
import {currentSignerVariant, type StatementSignerVariant} from '../config/signerPlatform';
import {computeScope} from '../utils/circuitHelpers';
import {coinbaseSignalHash} from '../utils/coinbaseSignal';
import {signedDigestOf, whatTheWalletSigns} from '../utils/signedAction';
import {ANDROID_CIRCUIT_TRUST, signStatementOnAndroid, type AndroidSignOptions} from '../androidAttest/androidSigner';
import {isAndroidStatementWitness, type AndroidStatementWitness} from '../androidAttest/androidSignerInputs';
import {getAndroidKeyAttestationNative, type AndroidKeyAttestationNative} from '../androidAttest/nativeAndroidKeyAttestation';
import {getAppAttestNative, type AppAttestNative} from './nativeAppAttest';
import type {AppAttestDeps} from './appAttestKey';
import {
  makeRevocationStatement,
  revocationClientData,
  type AppAttestWitness,
  type RevocationDeps,
  type RevocationStatementRequest,
} from './revocationStatement';

/** Either device's witness for the Coinbase KYC v2 statement. */
export type CoinbaseStatementWitness = AppAttestWitness | AndroidStatementWitness;
export {isAndroidStatementWitness, type AndroidStatementWitness};

export interface CoinbaseKycStatementRequest {
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

export interface CoinbaseKycStatementOverrides {
  /** Tests only: which platform's signer, instead of this phone's. */
  variant?: StatementSignerVariant;
  native?: AppAttestNative;
  /** Tests only: a synthetic CA pin and an in-memory key store. */
  keyDeps?: Pick<AppAttestDeps, 'storage' | 'pinnedCaKeyHash'>;
  /** Tests only: a fake Android module and the trust anchors its synthetic chain carries. */
  android?: {native: AndroidKeyAttestationNative; trust: AndroidSignOptions['trust']};
  revocation?: Omit<RevocationDeps, 'appAttest'>;
}

async function appAttestStatement(
  statement: RevocationStatementRequest,
  req: CoinbaseKycStatementRequest,
  overrides: CoinbaseKycStatementOverrides,
): Promise<CoinbaseStatementWitness> {
  // Throws E2009 when the module is missing.
  const native = overrides.native ?? getAppAttestNative();
  return makeRevocationStatement(statement, {...overrides.revocation, appAttest: {...overrides.keyDeps, native, log: req.log}});
}

async function androidStatement(
  statement: RevocationStatementRequest,
  req: CoinbaseKycStatementRequest,
  overrides: CoinbaseKycStatementOverrides,
): Promise<CoinbaseStatementWitness> {
  // The module first, so a build without it is told so before any lookup (E2015).
  const native = overrides.android?.native ?? getAndroidKeyAttestationNative();
  const trust = overrides.android?.trust ?? ANDROID_CIRCUIT_TRUST;
  const {clientData, attestedAt} = await revocationClientData(statement, {
    fetchStatus: overrides.revocation?.fetchStatus,
    now: overrides.revocation?.now,
    log: req.log,
  });
  // The chain must be valid at attested_at, the statement's own time.
  const signer = await signStatementOnAndroid(clientData, {now: attestedAt, log: req.log, native, trust});
  req.log('[AndroidAttest] Revocation statement signed');
  return {variant: 'android', clientData, attestedAt, signer};
}

const MAKE_STATEMENT: Readonly<Record<StatementSignerVariant, typeof appAttestStatement>> = Object.freeze({
  app_attest: appAttestStatement,
  android: androidStatement,
});

export async function prepareCoinbaseKycStatement(
  req: CoinbaseKycStatementRequest,
  overrides: CoinbaseKycStatementOverrides = {},
): Promise<CoinbaseStatementWitness> {
  const variant = overrides.variant ?? currentSignerVariant();
  if (!Object.prototype.hasOwnProperty.call(MAKE_STATEMENT, variant)) {
    throw new Error(`No Coinbase KYC statement signer for '${variant}'. Known: ${Object.keys(MAKE_STATEMENT).join(', ')}.`);
  }
  return MAKE_STATEMENT[variant](
    {
      wallet: req.walletAddress,
      attestationUid: req.attestationUid,
      requestDigest: coinbaseRequestDigest(req.walletAddress, req.scopeString, req.action),
      scope: computeScope(req.scopeString),
    },
    req,
    overrides,
  );
}
