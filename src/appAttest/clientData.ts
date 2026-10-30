/**
 * The statement the phone's hardware key signs, right after it has looked the
 * Coinbase attestation up and found it unrevoked: 225 bytes for Coinbase KYC
 * v2, 227 for Coinbase Country v2 (src/appAttest/coinbaseStatementKinds.ts).
 *
 * Spec: circuits `coinbase-attestation-v2/README.md` (tag v2.0.0-rc.1,
 * "clientData format") and
 * `src/client_data.nr`, which checks every field at these offsets.
 *
 *   off  len  field
 *     0   16  "ZKProofport/AA/1"
 *    16   32  keccak256("coinbase_attestation")    the statement kind
 *    48   20  wallet                                = the proven wallet
 *    68    8  unix seconds, big-endian              = public attested_at
 *    76   32  EAS schema uid                        Coinbase Verified Account
 *   108   20  EAS attester                          Coinbase's attester
 *   128   32  attestation uid the app found         carried, not checked
 *   160    1  revoked: 0x00 = found unrevoked       must be 0
 *   161   32  the exact digest the wallet signed    = the circuit's signed_digest
 *   193   32  scope                                 = public scope
 *   225    2  Country v2 only: the attestation's country, two ASCII
 *             letters                               = the attestCountry tx's
 *
 * Country v2: circuits `coinbase-country-v2-libs/src/client_data.nr`, with
 * the tag keccak256("coinbase_country_attestation") and the Coinbase Verified
 * Country schema.
 */
import {ethers} from 'ethers';
import {AppAttestError} from './appAttestError';
import {COUNTRY_CODE, coinbaseStatementKind} from './coinbaseStatementKinds';

export {COINBASE_KYC_SCHEMA_UID, COINBASE_COUNTRY_SCHEMA_UID} from './coinbaseStatementKinds';

/** Coinbase KYC v2's statement length. Country v2's is 227 (coinbaseStatementKinds.ts). */
export const CLIENT_DATA_LEN = 225;
export const CLIENT_DATA_MAGIC = 'ZKProofport/AA/1';
/** The tag is the canonical id of the circuit: v2 keeps coinbase_attestation. */
export const CLIENT_DATA_CIRCUIT_ID = 'coinbase_attestation';
export const COINBASE_ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';

/** Largest timestamp the 8-byte field and a JS number both hold exactly. */
const MAX_SAFE_SECONDS = Number.MAX_SAFE_INTEGER;

export interface ClientDataFields {
  wallet: string;
  /** Unix seconds; becomes the public `attested_at`. */
  attestedAt: number;
  schemaUid: string;
  attester: string;
  attestationUid: string;
  /** What the lookup found. Only `false` produces a statement. */
  revoked: boolean;
  /** The 32 bytes the wallet signed (EIP-191 over signal_hash, or the EIP-712 digest). */
  requestDigest: string;
  /** keccak256(scope string), 32 bytes. */
  scope: Uint8Array | string;
  /**
   * Country v2 only, and required there: the two uppercase ASCII letters of
   * the attestation's country. Refused for Coinbase KYC v2.
   */
  country?: string;
}

function exactBytes(value: Uint8Array | string, length: number, what: string): Uint8Array {
  let b: Uint8Array;
  try {
    b = typeof value === 'string' ? ethers.utils.arrayify(value) : value;
  } catch {
    throw new Error(`${what} is not hex: ${String(value)}`);
  }
  if (b.length !== length) throw new Error(`${what} is ${b.length} bytes; the clientData field is ${length}`);
  return b;
}

/**
 * Build the statement. Refuses -- before anything is signed -- a revoked
 * attestation, a schema or attester other than Coinbase's, and any field of
 * the wrong width; the circuit would refuse each of these too, but only after
 * the person had waited for a proof.
 */
export function buildClientData(f: ClientDataFields): Uint8Array {
  return buildCoinbaseClientData('coinbase_attestation', f);
}

/**
 * The statement of `circuit` (coinbase_attestation or
 * coinbase_country_attestation; any other id throws). Refuses the same things
 * buildClientData does, with the circuit's own reasons and schema, and for
 * Country v2 a country that is not two uppercase ASCII letters.
 */
export function buildCoinbaseClientData(circuit: string, f: ClientDataFields): Uint8Array {
  const kind = coinbaseStatementKind(circuit);
  if (f.revoked !== false) {
    throw new AppAttestError(
      kind.reasons.revoked,
      `The ${kind.schemaName} attestation ${f.attestationUid} is revoked; no device statement is made for it.`,
    );
  }
  if (!ethers.utils.isAddress(f.wallet)) throw new Error(`wallet is not an address: ${f.wallet}`);
  if (f.schemaUid.toLowerCase() !== kind.schemaUid) {
    throw new Error(`schema ${f.schemaUid} is not the ${kind.schemaName} schema`);
  }
  let countryBytes: number[] = [];
  if (kind.carriesCountry) {
    if (typeof f.country !== 'string' || !COUNTRY_CODE.test(f.country)) {
      throw new AppAttestError(
        'country_record_unreadable',
        `The ${kind.schemaName} attestation ${f.attestationUid} names country ${JSON.stringify(f.country ?? null)}; two uppercase letters are required.`,
      );
    }
    countryBytes = [f.country.charCodeAt(0), f.country.charCodeAt(1)];
  } else if (f.country !== undefined) {
    throw new Error(`${kind.label}'s statement carries no country; got ${JSON.stringify(f.country)}`);
  }
  if (!ethers.utils.isAddress(f.attester) || ethers.utils.getAddress(f.attester) !== ethers.utils.getAddress(COINBASE_ATTESTER)) {
    throw new Error(`attester ${f.attester} is not Coinbase's attester`);
  }
  if (!Number.isInteger(f.attestedAt) || f.attestedAt <= 0 || f.attestedAt > MAX_SAFE_SECONDS) {
    throw new Error(`attestedAt must be positive whole seconds, got ${f.attestedAt}`);
  }
  const time = new Uint8Array(8);
  let t = BigInt(f.attestedAt);
  for (let i = 7; i >= 0; i--) {
    time[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  const out = Uint8Array.from([
    ...ethers.utils.toUtf8Bytes(CLIENT_DATA_MAGIC),
    ...ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind.circuit))),
    ...ethers.utils.arrayify(ethers.utils.getAddress(f.wallet)),
    ...time,
    ...exactBytes(f.schemaUid, 32, 'schema uid'),
    ...ethers.utils.arrayify(ethers.utils.getAddress(f.attester)),
    ...exactBytes(f.attestationUid, 32, 'attestation uid'),
    0x00,
    ...exactBytes(f.requestDigest, 32, 'request digest'),
    ...exactBytes(f.scope, 32, 'scope'),
    ...countryBytes,
  ]);
  if (out.length !== kind.clientDataLength) {
    throw new Error(`clientData is ${out.length} bytes, not ${kind.clientDataLength}`);
  }
  return out;
}
