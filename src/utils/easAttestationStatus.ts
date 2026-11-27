/**
 * "Is this attestation still good right now?" for an EAS attestation on GIWA,
 * asked of the chain itself right before proving.
 *
 * The GIWA KYC and Dojang Playground circuits prove that the attester signed
 * the issuing transaction. They cannot see what happened after it: the issuer
 * revoking the attestation (`revocationTime`) or its expiry
 * (`expirationTime`). Without this check a revoked or expired attestation
 * still produced a valid proof (found 2026-11-27; the Coinbase circuits had a
 * revocation check since 2026-10-23 and these two did not get it).
 *
 * This is a check in the app, so it stops honest use of a dead attestation.
 * It does not bind a modified app; the binding (the device statement the
 * Coinbase circuits verify) belongs in the circuits and is a TODO for the
 * production release.
 *
 * The answer is never cached: revocation can happen at any moment.
 */
import {ethers} from 'ethers';
import type {ErrorCode} from '../constants/errorCodes';

const EAS_ABI = [
  'function getAttestation(bytes32 uid) view returns (tuple(bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
];
const EAS = new ethers.utils.Interface(EAS_ABI);
const LOOKUP_TIMEOUT_MS = 15_000;
const ZERO_UID = ethers.constants.HashZero;

export type AttestationRefusal = 'missing' | 'revoked' | 'expired' | 'other_wallet' | 'wrong_schema' | 'other_attester' | 'lookup';

/** One table from cause to the modal code; a cause without a row cannot be raised. */
export const ATTESTATION_REFUSAL_CODE: Readonly<Record<AttestationRefusal, ErrorCode>> = Object.freeze({
  missing: 'E2007',
  revoked: 'E2025',
  expired: 'E2026',
  other_wallet: 'E2007',
  wrong_schema: 'E2007',
  other_attester: 'E2007',
  lookup: 'E3002',
});

export class AttestationNotLiveError extends Error {
  readonly kind: AttestationRefusal;
  readonly code: ErrorCode;
  constructor(kind: AttestationRefusal, message: string) {
    super(message);
    this.name = 'AttestationNotLiveError';
    this.kind = kind;
    this.code = ATTESTATION_REFUSAL_CODE[kind];
  }
}

export interface LiveAttestationQuery {
  rpcUrl: string;
  /** The EAS contract (GIWA: the 0x…21 predeploy). */
  eas: string;
  uid: string;
  /** The wallet the proof is for; the record's recipient must be it. */
  recipient: string;
  /** When given, the record's schema must be it. */
  schemaUid?: string;
  /** When given, the record's attester (the address that called EAS.attest) must be it. */
  attester?: string;
  /** Unix seconds; injectable for tests. */
  nowSeconds?: number;
  fetchImpl?: typeof fetch;
}

export interface LiveAttestation {
  uid: string;
  /** 0 = never expires. */
  expirationTime: number;
  time: number;
}

/** Pure decision on one decoded record, so every rule is testable without a network. */
export function judgeAttestation(
  record: {uid: string; schema: string; time: number; expirationTime: number; revocationTime: number; recipient: string; attester?: string},
  query: {uid: string; recipient: string; schemaUid?: string; attester?: string; nowSeconds: number},
): LiveAttestation {
  if (record.uid.toLowerCase() === ZERO_UID || record.time === 0) {
    throw new AttestationNotLiveError('missing', `EAS has no attestation ${query.uid}.`);
  }
  if (record.uid.toLowerCase() !== query.uid.toLowerCase()) {
    throw new AttestationNotLiveError('missing', `EAS answered attestation ${record.uid} for ${query.uid}.`);
  }
  if (ethers.utils.getAddress(record.recipient) !== ethers.utils.getAddress(query.recipient)) {
    throw new AttestationNotLiveError('other_wallet', `Attestation ${query.uid} is for ${record.recipient}, not ${query.recipient}.`);
  }
  if (query.schemaUid !== undefined && record.schema.toLowerCase() !== query.schemaUid.toLowerCase()) {
    throw new AttestationNotLiveError('wrong_schema', `Attestation ${query.uid} is schema ${record.schema}, not ${query.schemaUid}.`);
  }
  if (query.attester !== undefined) {
    if (typeof record.attester !== 'string' || !ethers.utils.isAddress(record.attester)) {
      throw new AttestationNotLiveError('other_attester', `Attestation ${query.uid} names no attester; ${query.attester} is required.`);
    }
    if (ethers.utils.getAddress(record.attester) !== ethers.utils.getAddress(query.attester)) {
      throw new AttestationNotLiveError('other_attester', `Attestation ${query.uid} was made by ${record.attester}, not ${query.attester}.`);
    }
  }
  if (record.revocationTime !== 0) {
    throw new AttestationNotLiveError(
      'revoked',
      `Attestation ${query.uid} was revoked at ${new Date(record.revocationTime * 1000).toISOString()}.`,
    );
  }
  if (record.expirationTime !== 0 && record.expirationTime <= query.nowSeconds) {
    throw new AttestationNotLiveError(
      'expired',
      `Attestation ${query.uid} expired at ${new Date(record.expirationTime * 1000).toISOString()}.`,
    );
  }
  return {uid: record.uid, expirationTime: record.expirationTime, time: record.time};
}

/**
 * Reads the record from the chain and refuses anything but a live attestation
 * for this wallet. A lookup that does not finish is `lookup` (E3002), never
 * read as "revoked" or "fine".
 */
export async function requireLiveAttestation(q: LiveAttestationQuery, log: (m: string) => void): Promise<LiveAttestation> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(q.uid)) {
    throw new AttestationNotLiveError('missing', `Attestation uid is not 32 bytes of hex: ${q.uid}`);
  }
  if (!ethers.utils.isAddress(q.eas) || !ethers.utils.isAddress(q.recipient)) {
    throw new Error(`requireLiveAttestation needs addresses; got eas=${q.eas} recipient=${q.recipient}`);
  }
  const doFetch = q.fetchImpl ?? fetch;
  log(`[Attestation] Checking ${q.uid} on chain (revocation and expiry)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let result: string;
  try {
    const res = await doFetch(q.rpcUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{to: q.eas, data: EAS.encodeFunctionData('getAttestation', [q.uid])}, 'latest'],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {result?: unknown; error?: {message?: string}};
    if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
    if (typeof body.result !== 'string' || !body.result.startsWith('0x')) throw new Error(`no result: ${JSON.stringify(body)}`);
    result = body.result;
  } catch (e) {
    throw new AttestationNotLiveError('lookup', `The attestation check for ${q.uid} did not complete: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  let decoded: ethers.utils.Result;
  try {
    decoded = EAS.decodeFunctionResult('getAttestation', result)[0];
  } catch (e) {
    throw new AttestationNotLiveError('lookup', `EAS answered an unreadable record for ${q.uid}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const live = judgeAttestation(
    {
      uid: decoded.uid,
      schema: decoded.schema,
      time: Number(decoded.time),
      expirationTime: Number(decoded.expirationTime),
      revocationTime: Number(decoded.revocationTime),
      recipient: decoded.recipient,
      attester: decoded.attester,
    },
    {uid: q.uid, recipient: q.recipient, schemaUid: q.schemaUid, attester: q.attester, nowSeconds: q.nowSeconds ?? Math.floor(Date.now() / 1000)},
  );
  log(`[Attestation] ${q.uid} is live (not revoked; ${live.expirationTime === 0 ? 'no expiry' : `expires ${new Date(live.expirationTime * 1000).toISOString()}`})`);
  return live;
}

/** The `Attested` event's uid for this wallet in a receipt's logs, from the EAS contract. */
export const ATTESTED_TOPIC = '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35';

export function attestedUidInReceipt(
  logs: ReadonlyArray<{address?: string; topics?: string[]; data?: string}>,
  eas: string,
  recipient: string,
): string | null {
  const wantRecipient = ethers.utils.hexZeroPad(ethers.utils.getAddress(recipient), 32).toLowerCase();
  for (const l of logs) {
    if (!l.address || l.address.toLowerCase() !== eas.toLowerCase()) continue;
    if (!l.topics || l.topics[0]?.toLowerCase() !== ATTESTED_TOPIC || l.topics[1]?.toLowerCase() !== wantRecipient) continue;
    if (typeof l.data === 'string' && /^0x[0-9a-fA-F]{64}$/.test(l.data)) return l.data.toLowerCase();
  }
  return null;
}
