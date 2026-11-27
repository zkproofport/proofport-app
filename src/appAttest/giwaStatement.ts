/**
 * The device statement for GIWA KYC v2 and the Dojang Playground v2: right
 * before proving, read the attestation from GIWA Sepolia's EAS, and only if it
 * is neither revoked nor expired, have this phone's hardware key sign a
 * 233-byte statement saying so. The circuit verifies the statement and its
 * signer, so a modified app that skips the lookup cannot prove a revoked or
 * expired attestation (decided 2026-11-27,
 * `.omc/plans/giwa-dojang-statement-binding.md`).
 *
 * Layout (circuits `giwa-v2-libs/src/statement.nr`, which checks every field):
 *
 *   off  len  field
 *     0   16  "ZKProofport/AA/1"
 *    16   32  keccak256(canonical circuit id)      the statement kind
 *    48   20  wallet                                = the proven wallet
 *    68    8  attested_at, unix seconds, BE         = public attested_at
 *    76   32  EAS schema uid                        = the circuit's schema
 *   108   20  EAS attester                          = the circuit's attester
 *   128   32  attestation uid the app read          carried, not checked
 *   160    1  revoked: 0x00                         must be 0
 *   161   32  the digest the wallet will sign       = the circuit's signed_digest
 *   193   32  scope (the OPRF scope Field, BE)      = public scope
 *   225    8  expirationTime, BE; 0 = never         0 or > attested_at
 *
 * Signers are the Coinbase v2 ones: App Attest on iPhone, Android key
 * attestation (RKP or factory + Play Integrity) on Android.
 */
import {ethers} from 'ethers';
import type {TypedAction} from '../config/circuitIds';
import {getCircuitDisplayName} from '../utils/circuit';
import {currentSignerPlatform, type SignerPlatform} from '../config/signerPlatform';
import {getEnvironment, getNetworkConfigForCircuit} from '../config/environment';
import {STATIC_CONFIGS} from '../config/contracts';
import {oprfScopeBytesOf} from '../oprf/circuitInputs';
import {signedDigestOf, walletSigning} from '../utils/signedAction';
import {requireLiveAttestation, type LiveAttestation} from '../utils/easAttestationStatus';
import {
  ANDROID_CIRCUIT_TRUST,
  relayIntegrityDecrypter,
  signStatementOnAndroid,
  type AndroidSignOptions,
} from '../androidAttest/androidSigner';
import type {AndroidStatementWitness} from '../androidAttest/androidSignerInputs';
import {getAndroidKeyAttestationNative, type AndroidKeyAttestationNative} from '../androidAttest/nativeAndroidKeyAttestation';
import {getAppAttestNative, type AppAttestNative} from './nativeAppAttest';
import {assertClientData, ensureAttestedKey, type AppAttestDeps} from './appAttestKey';
import {requireProductionCredential, type AppAttestWitness} from './revocationStatement';

export type GiwaStatementCircuit = 'giwa_attestation' | 'dojang_playground';

export interface GiwaStatementKind {
  circuit: GiwaStatementCircuit;
  /** The circuit's display name, from the one name table (utils/circuit.ts). */
  readonly label: string;
  /** The EAS schema the circuit pins. */
  schemaUid: string;
  /** The EAS attester the circuit pins (the contract that called EAS.attest). */
  attester: string;
}

/** Read from GIWA Sepolia on 2026-11-27; the circuits pin the same values (giwa-v2-libs). */
export const GIWA_STATEMENT_KINDS: Readonly<Record<GiwaStatementCircuit, GiwaStatementKind>> = Object.freeze({
  giwa_attestation: Object.freeze({
    circuit: 'giwa_attestation',
    get label() { return getCircuitDisplayName('giwa_attestation'); },
    schemaUid: '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d',
    attester: '0x6646d970499BBeD728636823A5A7e551E811b414',
  }),
  dojang_playground: Object.freeze({
    circuit: 'dojang_playground',
    get label() { return getCircuitDisplayName('dojang_playground'); },
    schemaUid: '0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08',
    attester: '0x63CCe2b569A7bC35895ee24306c1512fefc06121',
  }),
});

export function giwaStatementKind(circuit: string): GiwaStatementKind {
  if (!Object.prototype.hasOwnProperty.call(GIWA_STATEMENT_KINDS, circuit)) {
    throw new Error(`No GIWA status statement for '${circuit}'. Known: ${Object.keys(GIWA_STATEMENT_KINDS).join(', ')}.`);
  }
  return GIWA_STATEMENT_KINDS[circuit as GiwaStatementCircuit];
}

export const GIWA_STATEMENT_LEN = 233;
const MAGIC = 'ZKProofport/AA/1';
/** GIWA's EAS predeploy. */
export const GIWA_EAS = '0x4200000000000000000000000000000000000021';
/** 2^63 - 1 would still fit; the app refuses anything past year 9999 as a sign of a bad clock or record. */
const MAX_SECONDS = 253402300799;

function u64be(value: number, what: string): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SECONDS) {
    throw new Error(`${what} must be whole seconds from 0 to ${MAX_SECONDS}, got ${value}`);
  }
  const out = new Array(8).fill(0);
  let t = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  return out;
}

function exact(hex: string, len: number, what: string): number[] {
  const b = ethers.utils.arrayify(hex);
  if (b.length !== len) throw new Error(`${what} is ${b.length} bytes, not ${len}`);
  return Array.from(b);
}

export interface GiwaStatementFields {
  wallet: string;
  attestedAt: number;
  attestationUid: string;
  requestDigest: string;
  scope: Uint8Array;
  /** The record's expirationTime; 0 = never expires. */
  expirationTime: number;
}

/**
 * The 233 bytes. Refuses -- before anything is signed -- a record that had
 * expired at attestedAt (the circuit would refuse it too, after the person
 * waited for a proof).
 */
export function buildGiwaStatement(circuit: string, f: GiwaStatementFields): Uint8Array {
  const kind = giwaStatementKind(circuit);
  if (!ethers.utils.isAddress(f.wallet)) throw new Error(`wallet is not an address: ${f.wallet}`);
  if (f.attestedAt <= 0) throw new Error(`attestedAt must be positive, got ${f.attestedAt}`);
  if (f.expirationTime !== 0 && f.expirationTime <= f.attestedAt) {
    throw new Error(`The ${kind.label} attestation ${f.attestationUid} had expired at ${f.attestedAt}; no statement is made for it.`);
  }
  const out = Uint8Array.from([
    ...ethers.utils.toUtf8Bytes(MAGIC),
    ...ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind.circuit))),
    ...ethers.utils.arrayify(ethers.utils.getAddress(f.wallet)),
    ...u64be(f.attestedAt, 'attestedAt'),
    ...exact(kind.schemaUid, 32, 'schema uid'),
    ...ethers.utils.arrayify(ethers.utils.getAddress(kind.attester)),
    ...exact(f.attestationUid, 32, 'attestation uid'),
    0x00,
    ...exact(f.requestDigest, 32, 'request digest'),
    ...exact(ethers.utils.hexlify(f.scope), 32, 'scope'),
    ...u64be(f.expirationTime, 'expirationTime'),
  ]);
  if (out.length !== GIWA_STATEMENT_LEN) throw new Error(`statement is ${out.length} bytes, not ${GIWA_STATEMENT_LEN}`);
  return out;
}

export interface GiwaStatementRequest {
  walletAddress: string;
  /** The EAS uid of the attestation whose issuing transaction is being proved. */
  attestationUid: string;
  scopeString: string;
  /** The request id the wallet's signal_hash names; the hook must be given the same one. */
  requestId: string;
  action?: TypedAction;
  log: (msg: string) => void;
}

/** The digest the wallet will sign for this request (the statement's offset 161). */
export function giwaRequestDigest(circuit: GiwaStatementCircuit, scopeString: string, requestId: string, action?: TypedAction): string {
  return signedDigestOf(walletSigning({scope: scopeString, circuitId: circuit, requestId}, action).signed);
}

export interface GiwaStatementOverrides {
  platform?: SignerPlatform;
  native?: AppAttestNative;
  keyDeps?: Pick<AppAttestDeps, 'storage' | 'pinnedCaKeyHash'>;
  android?: {native: AndroidKeyAttestationNative; trust: AndroidSignOptions['trust']; integrity?: AndroidSignOptions['integrity']};
  /** Tests only: the on-chain read and the clock. */
  requireLive?: typeof requireLiveAttestation;
  now?: () => number;
}

export type GiwaStatementWitness = AppAttestWitness | AndroidStatementWitness;

/**
 * Reads the record fresh (never a cache) and builds the statement. Refuses
 * with AttestationNotLiveError: E2025 revoked, E2026 expired, E3002 the read
 * did not finish, E2007 missing / another wallet / another schema.
 */
export async function giwaStatementBytes(
  circuit: GiwaStatementCircuit,
  req: GiwaStatementRequest,
  overrides: Pick<GiwaStatementOverrides, 'requireLive' | 'now'> = {},
): Promise<{statement: Uint8Array; attestedAt: number; live: LiveAttestation}> {
  const kind = giwaStatementKind(circuit);
  const attestedAt = Math.floor((overrides.now ?? (() => Date.now() / 1000))());
  const live = await (overrides.requireLive ?? requireLiveAttestation)(
    {
      rpcUrl: getNetworkConfigForCircuit(circuit).rpcUrl,
      eas: GIWA_EAS,
      uid: req.attestationUid,
      recipient: req.walletAddress,
      schemaUid: kind.schemaUid,
      // The statement names this attester; the record must be its.
      attester: kind.attester,
      nowSeconds: attestedAt,
    },
    req.log,
  );
  const statement = buildGiwaStatement(circuit, {
    wallet: req.walletAddress,
    attestedAt,
    attestationUid: req.attestationUid,
    requestDigest: giwaRequestDigest(circuit, req.scopeString, req.requestId, req.action),
    scope: oprfScopeBytesOf(req.scopeString),
    expirationTime: live.expirationTime,
  });
  return {statement, attestedAt, live};
}

async function iosStatement(circuit: GiwaStatementCircuit, req: GiwaStatementRequest, o: GiwaStatementOverrides): Promise<GiwaStatementWitness> {
  const native = o.native ?? getAppAttestNative();
  const appAttest: AppAttestDeps = {...o.keyDeps, native, log: req.log};
  // The key first: a phone without App Attest is told so before any lookup.
  const key = await ensureAttestedKey(appAttest);
  const label = giwaStatementKind(circuit).label;
  requireProductionCredential(key.credential, label);
  const {statement, attestedAt} = await giwaStatementBytes(circuit, req, o);
  const signed = await assertClientData(appAttest, statement);
  requireProductionCredential(signed.credential, label);
  req.log(`[AppAttest] ${label} status statement signed with key ${signed.keyId} (counter ${signed.assertion.counter})`);
  return {clientData: statement, attestedAt, credential: signed.credential, assertion: signed.assertion};
}

async function androidStatement(circuit: GiwaStatementCircuit, req: GiwaStatementRequest, o: GiwaStatementOverrides): Promise<GiwaStatementWitness> {
  const native = o.android?.native ?? getAndroidKeyAttestationNative();
  const trust = o.android?.trust ?? ANDROID_CIRCUIT_TRUST;
  const integrity =
    o.android?.integrity ?? relayIntegrityDecrypter(() => STATIC_CONFIGS[getEnvironment()].relay.apiBaseUrl, req.log);
  const {statement, attestedAt} = await giwaStatementBytes(circuit, req, o);
  // The chain must be valid at attested_at, the statement's own time.
  const signer = await signStatementOnAndroid(statement, {now: attestedAt, log: req.log, native, trust, integrity});
  req.log(`[AndroidAttest] ${giwaStatementKind(circuit).label} status statement signed (${signer.variant})`);
  return {variant: signer.variant, clientData: statement, attestedAt, signer};
}

const MAKE: Readonly<Record<SignerPlatform, typeof iosStatement>> = Object.freeze({
  ios: iosStatement,
  android: androidStatement,
});

/** The proof screen's one call: the statement, or an error whose code is the modal to show. */
export async function prepareGiwaStatement(
  circuit: GiwaStatementCircuit,
  req: GiwaStatementRequest,
  overrides: GiwaStatementOverrides = {},
): Promise<GiwaStatementWitness> {
  giwaStatementKind(circuit);
  const platform = overrides.platform ?? currentSignerPlatform();
  if (!Object.prototype.hasOwnProperty.call(MAKE, platform)) {
    throw new Error(`No GIWA statement signer for '${platform}'. Known: ${Object.keys(MAKE).join(', ')}.`);
  }
  return MAKE[platform](circuit, req, overrides);
}
