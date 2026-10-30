/**
 * The Play Integrity verdict a factory-provisioned Android phone adds to its
 * statement (circuits play-integrity, statement-signer
 * verify_statement_android_factory; zkPassport's Android FaceMatch pairs the
 * same two proofs).
 *
 *   1. nonce = SHA256(SHA256(statement) || r || s), the key's signature over
 *      the statement in its LOW-s form (play_integrity_nonce), sent to Play
 *      as base64url without padding
 *   2. the classic token Play returns is encrypted for our app; the relay
 *      (POST /api/v1/play-integrity/decrypt) decrypts it and hands back the
 *      JWS segments. Google's ES256 signature is checked in the circuit
 *      against our pinned verification key, so the relay is trusted for
 *      confidentiality only
 *   3. this file refuses, before proving, what the circuit would refuse:
 *      another header than {"alg":"ES256"}, a payload the circuit cannot
 *      hold, another package, an app Play does not recognize, a device
 *      without device integrity, a nonce that is not this statement's
 *
 * Codes: E2017 the verdict says this app or phone does not pass; E2016 the
 * answer is not what the circuit takes; E3008 the check could not be made
 * now (network, rate limit, the relay not configured).
 */
import {ethers} from 'ethers';
import {ANDROID_ATTEST_ERROR_CODE, refuseWith} from '../appAttest/appAttestError';
import type {DeviceCheckReason} from '../appAttest/deviceCheckReasons';
import {N_P256} from '../appAttest/constants';
import {hexToBytes} from '../appAttest/der';

/**
 * Our app's Play Integrity VERIFICATION key, X || Y (P-256), from Play
 * Console's base64 DER SubjectPublicKeyInfo
 * MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9mG5EsLPQCtC4JQDSgvE5WUjoXYnwmt1Xp1YfEOdQzsjwbDMVpN/QUbDB+vbGlUWMY/Z5Q3x6Z8sTFVQTwpnWw==
 * -- circuits statement-signer play_key.nr PLAY_INTEGRITY_KEY. Public; a prover
 * input the circuit pins by hash.
 */
export const PLAY_INTEGRITY_VERIFICATION_KEY = hexToBytes(
  'f661b912c2cf402b42e094034a0bc4e56523a17627c26b755e9d587c439d433b' +
    '23c1b0cc56937f4146c307ebdb1a5516318fd9e50df1e99f2c4c55504f0a675b',
);

/** base64url('{"alg":"ES256"}'): the only protected header the circuit takes. */
export const JWS_HEADER_B64 = 'eyJhbGciOiJFUzI1NiJ9';
/** The circuit's room for the payload: 1,368 base64url characters, 1,024 JSON bytes. */
export const PAYLOAD_B64_MAX_LEN = 1368;
export const PAYLOAD_MAX_LEN = 1024;
/** The JSON escape of '=' Google uses when it echoes a padded nonce (6 characters). */
const ESCAPED_PAD = String.fromCharCode(92) + 'u003d';

const malformed = (reason: DeviceCheckReason, why: string): never => {
  return refuseWith(ANDROID_ATTEST_ERROR_CODE.malformed, reason, why);
};
const integrityNotMet = (reason: DeviceCheckReason, why: string): never => {
  return refuseWith(ANDROID_ATTEST_ERROR_CODE.integrityNotMet, reason, why);
};
const serviceUnavailable = (reason: DeviceCheckReason, why: string): never => {
  return refuseWith(ANDROID_ATTEST_ERROR_CODE.checkUnavailable, reason, why);
};

/** SHA256(SHA256(statement) || statementSig): the nonce the circuit recomputes. */
export function playIntegrityNonce(statement: Uint8Array, statementSig: Uint8Array): Uint8Array {
  if (statementSig.length !== 64) throw new Error(`statement_sig is ${statementSig.length} bytes, not 64`);
  const h = ethers.utils.arrayify(ethers.utils.sha256(statement));
  return ethers.utils.arrayify(ethers.utils.sha256(Uint8Array.from([...h, ...statementSig])));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return ethers.utils.base64.encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string, what: string): Uint8Array {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    return malformed('integrity_value_not_base64url', `${what} is not unpadded base64url`);
  }
  const std = text.replace(/-/g, '+').replace(/_/g, '/');
  return ethers.utils.base64.decode(std + '='.repeat((4 - (std.length % 4)) % 4));
}

/** The nonce as Play takes it: base64url, no padding, 43 characters for 32 bytes. */
export function playIntegrityNonceText(nonce: Uint8Array): string {
  if (nonce.length !== 32) throw new Error(`nonce is ${nonce.length} bytes, not 32`);
  return base64UrlEncode(nonce);
}

/** The three JWS segments the relay returns. */
export interface DecryptedIntegrityToken {
  protectedHeader: string;
  payload: string;
  signature: string;
}

/** The circuit's IntegrityToken inputs. */
export interface IntegrityTokenInputs {
  integrity_payload_b64: Uint8Array;
  integrity_payload_b64_len: number;
  integrity_signature: Uint8Array;
}

/** Relay refusals, by its stable `reason` strings (proofport-relay playIntegrity.ts / app.ts). */
const RELAY_REASONS_DEVICE = new Set([
  'token_missing',
  'token_not_string',
  'token_malformed',
  'jwe_unsupported',
  'key_unwrap_failed',
  'decrypt_failed',
  'not_a_jws',
  'jws_unsupported',
  'signature_invalid',
  'body_malformed',
  'body_too_large',
]);

type FetchLike = (url: string, init: {method: string; headers: Record<string, string>; body: string; signal?: AbortSignal}) =>
  Promise<{ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string>}>;

export interface RelayDecryptOptions {
  /** The relay's base URL (https://..., no trailing slash). */
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  log?: (m: string) => void;
}

export const PLAY_INTEGRITY_DECRYPT_PATH = '/api/v1/play-integrity/decrypt';

/**
 * Hand the encrypted token to the relay and get the JWS segments back. Every
 * failure is an AppAttestError: the network, a 429, a 5xx or `not_configured`
 * is E3008 (try again later); a refusal of the token or the body is E2016;
 * an answer of another shape is E2016.
 */
export async function decryptIntegrityTokenViaRelay(token: string, opts: RelayDecryptOptions): Promise<DecryptedIntegrityToken> {
  if (typeof token !== 'string' || token.length === 0) return malformed('integrity_token_empty', 'Play Integrity returned an empty token');
  if (!/^https:\/\/[^/]+$/.test(opts.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.baseUrl)) {
    throw new Error(`Relay base URL must be https://host (no path): '${opts.baseUrl}'`);
  }
  const url = `${opts.baseUrl}${PLAY_INTEGRITY_DECRYPT_PATH}`;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  let res: Awaited<ReturnType<FetchLike>>;
  let body: unknown;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token}),
      signal: controller.signal,
    });
    body = await res.json().catch(() => undefined);
  } catch (e) {
    return serviceUnavailable('integrity_service_unreachable', `The device check service at ${url} could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  const reason = typeof (body as {reason?: unknown})?.reason === 'string' ? (body as {reason: string}).reason : undefined;
  opts.log?.(`[PlayIntegrity] Relay answered HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  if (!res.ok) {
    // 404 with no reason: the relay does not have the endpoint (a relay
    // deployed without it -- staging on 2026-10-28). That is the service's
    // fault, not the phone's, so it is "try again later", not E2016.
    if (res.status === 429 || res.status >= 500 || reason === 'not_configured' || (res.status === 404 && !reason)) {
      return serviceUnavailable('integrity_service_unavailable', `The device check service answered HTTP ${res.status}${reason ? ` (${reason})` : ''}; try again later`);
    }
    if (reason && RELAY_REASONS_DEVICE.has(reason)) {
      return malformed('integrity_token_refused', `The device check service refused the integrity token: ${reason} (HTTP ${res.status})`);
    }
    return malformed('integrity_service_unknown_answer', `The device check service answered HTTP ${res.status} with an unknown reason ${JSON.stringify(reason ?? null)}`);
  }
  const b = body as Partial<DecryptedIntegrityToken> | undefined;
  if (!b || typeof b.protectedHeader !== 'string' || typeof b.payload !== 'string' || typeof b.signature !== 'string') {
    return malformed('integrity_service_bad_answer', 'The device check service answered 200 without {protectedHeader, payload, signature}');
  }
  return {protectedHeader: b.protectedHeader, payload: b.payload, signature: b.signature};
}

/**
 * The circuit's IntegrityToken inputs from the relay's answer, after the
 * checks the circuit makes (play-integrity verify_integrity_token), except
 * Google's signature, which only the circuit verifies.
 */
export function integrityTokenInputs(
  jws: DecryptedIntegrityToken,
  expect: {nonce: Uint8Array; packageName: string},
): IntegrityTokenInputs {
  if (jws.protectedHeader !== JWS_HEADER_B64) {
    malformed('integrity_verdict_wrong_header', `The integrity verdict's header is ${JSON.stringify(jws.protectedHeader)}; the circuit takes exactly ${JWS_HEADER_B64} ({"alg":"ES256"})`);
  }
  const payloadText = jws.payload;
  if (payloadText.length === 0 || payloadText.length > PAYLOAD_B64_MAX_LEN) {
    malformed('integrity_verdict_payload_length', `The integrity verdict payload is ${payloadText.length} base64url characters; the circuit takes 1..${PAYLOAD_B64_MAX_LEN}`);
  }
  const json = base64UrlDecode(payloadText, 'The integrity verdict payload');
  if (json.length > PAYLOAD_MAX_LEN) {
    malformed('integrity_verdict_too_long', `The integrity verdict is ${json.length} bytes; the circuit reads at most ${PAYLOAD_MAX_LEN}`);
  }
  let verdict: any;
  let text: string;
  try {
    text = ethers.utils.toUtf8String(json);
    verdict = JSON.parse(text);
  } catch (e) {
    return malformed('integrity_verdict_not_json', `The integrity verdict is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  checkVerdict(verdict, expect, text);

  const sig = base64UrlDecode(jws.signature, 'The integrity verdict signature');
  if (sig.length !== 64) malformed('integrity_verdict_signature_length', `The integrity verdict signature is ${sig.length} bytes; ES256 is 64 (r || s)`);
  const r = BigInt(ethers.utils.hexlify(sig.slice(0, 32)));
  let s = BigInt(ethers.utils.hexlify(sig.slice(32)));
  if (r === 0n || r >= N_P256 || s === 0n || s >= N_P256) malformed('integrity_verdict_signature_range', 'The integrity verdict signature is out of range');
  if (s > N_P256 / 2n) s = N_P256 - s;
  const lowS = ethers.utils.arrayify(ethers.utils.hexZeroPad('0x' + s.toString(16), 32));

  const padded = new Uint8Array(PAYLOAD_B64_MAX_LEN);
  for (let i = 0; i < payloadText.length; i++) padded[i] = payloadText.charCodeAt(i);
  return {
    integrity_payload_b64: padded,
    integrity_payload_b64_len: payloadText.length,
    integrity_signature: Uint8Array.from([...sig.slice(0, 32), ...lowS]),
  };
}

/** The verdict fields the circuit reads, refused with the reason. */
export function checkVerdict(verdict: any, expect: {nonce: Uint8Array; packageName: string}, rawJson: string): void {
  const request = verdict?.requestDetails;
  const app = verdict?.appIntegrity;
  const device = verdict?.deviceIntegrity;
  if (!request || typeof request !== 'object' || !app || typeof app !== 'object' || !device || typeof device !== 'object') {
    malformed('integrity_verdict_fields_missing', 'The integrity verdict lacks requestDetails, appIntegrity or deviceIntegrity');
  }
  if (request.requestPackageName !== expect.packageName) {
    malformed('integrity_verdict_other_requester', `The integrity verdict was requested by ${JSON.stringify(request.requestPackageName)}, not ${expect.packageName}`);
  }
  if (app.packageName !== expect.packageName) {
    integrityNotMet('integrity_verdict_other_app', `The integrity verdict is for ${JSON.stringify(app.packageName)}, not ${expect.packageName}`);
  }
  if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    integrityNotMet('integrity_app_not_recognized', `This app is not recognized as the store's build (appRecognitionVerdict ${JSON.stringify(app.appRecognitionVerdict)})`);
  }
  const verdicts = device.deviceRecognitionVerdict;
  if (!Array.isArray(verdicts) || verdicts.some(v => typeof v !== 'string') || verdicts.length > 4) {
    malformed('integrity_device_verdict_malformed', `deviceRecognitionVerdict is not a list of at most four strings: ${JSON.stringify(verdicts)}`);
  }
  if (!verdicts.includes('MEETS_DEVICE_INTEGRITY') && !verdicts.includes('MEETS_STRONG_INTEGRITY')) {
    integrityNotMet('integrity_device_not_met', `This phone does not meet device integrity (deviceRecognitionVerdict ${JSON.stringify(verdicts)})`);
  }
  const want = playIntegrityNonceText(expect.nonce);
  // Google may echo the nonce with one padding character, escaped in the JSON
  // as backslash-u-003d; the circuit compares the raw string, so it takes
  // exactly `want` or `want` + that escape -- a literal '=' is refused, as there.
  const exact = request.nonce === want;
  const escapedPad = request.nonce === `${want}=` && rawJson.includes(`"${want}${ESCAPED_PAD}"`);
  if (!exact && !escapedPad) {
    malformed('integrity_verdict_nonce_mismatch', `The integrity verdict's nonce ${JSON.stringify(request.nonce)} is not this statement's (${want}, or ${want} with an escaped pad)`);
  }
}
