/**
 * The 225-byte statement the app asks App Attest to sign, right after it has
 * looked the Coinbase attestation up and found it unrevoked.
 *
 * Spec: circuits branch `coinbase-app-attest-poc`,
 * `coinbase-app-attest-poc/README.md` ("clientData format") and
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
 */
import {ethers} from 'ethers';
import {AppAttestError, APP_ATTEST_ERROR_CODE} from './appAttestError';

export const CLIENT_DATA_LEN = 225;
export const CLIENT_DATA_MAGIC = 'ZKProofport/AA/1';
/** The tag is the canonical id of the circuit this prototype becomes. */
export const CLIENT_DATA_CIRCUIT_ID = 'coinbase_attestation';
export const COINBASE_KYC_SCHEMA_UID =
  '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
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
  if (f.revoked !== false) {
    throw new AppAttestError(
      APP_ATTEST_ERROR_CODE.revoked,
      `The Coinbase attestation ${f.attestationUid} is revoked; no App Attest statement is made for it.`,
    );
  }
  if (!ethers.utils.isAddress(f.wallet)) throw new Error(`wallet is not an address: ${f.wallet}`);
  if (f.schemaUid.toLowerCase() !== COINBASE_KYC_SCHEMA_UID) {
    throw new Error(`schema ${f.schemaUid} is not the Coinbase Verified Account schema`);
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
    ...ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(CLIENT_DATA_CIRCUIT_ID))),
    ...ethers.utils.arrayify(ethers.utils.getAddress(f.wallet)),
    ...time,
    ...exactBytes(f.schemaUid, 32, 'schema uid'),
    ...ethers.utils.arrayify(ethers.utils.getAddress(f.attester)),
    ...exactBytes(f.attestationUid, 32, 'attestation uid'),
    0x00,
    ...exactBytes(f.requestDigest, 32, 'request digest'),
    ...exactBytes(f.scope, 32, 'scope'),
  ]);
  if (out.length !== CLIENT_DATA_LEN) throw new Error(`clientData is ${out.length} bytes, not ${CLIENT_DATA_LEN}`);
  return out;
}
