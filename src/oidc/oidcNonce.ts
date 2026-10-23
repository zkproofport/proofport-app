import {ethers} from 'ethers';

/**
 * The nonce every OIDC ID token for a proof must carry, and the check that it
 * came back.
 *
 * Without a nonce our code chose, any Google or Microsoft ID token issued to
 * any site carries the same email, so whoever holds one can produce the same
 * OIDC proof (circuits-dev.md, "OIDC review, 2026-10-23"). The circuit will
 * bind the token's `nonce` claim to a public `nonce_binding`; this module is
 * the app half: request it, then refuse a token that does not carry it.
 *
 * Byte layout (87 bytes, hashed with keccak256):
 *
 *   utf8("zkproofport-oidc-v1")   19 bytes  domain tag
 *   keccak256(utf8(scope))        32 bytes  the same scope hash the proof
 *                                           commits to (computeScope)
 *   utf8(requestId)               36 bytes  canonical lowercase UUID
 *
 * nonce = lowercase hex of the digest, 64 characters, no `0x`. A verifier
 * recomputes it from the scope and requestId it issued; the circuit only has
 * to compare the claim with hex(nonce_binding), so keccak never runs in-circuit.
 *
 * requestId is a canonical lowercase UUID and nothing else: the relay mints
 * uuidv4 (proofport-relay/src/app.ts) and a standalone proof mints one here.
 * Accepting any other spelling would let two strings name one request and
 * produce two nonces.
 */

export const OIDC_NONCE_DOMAIN = 'zkproofport-oidc-v1';

/** Scope cap, in UTF-8 bytes. The SDK sets none; this bounds what a deep link can make us hash. */
export const OIDC_MAX_SCOPE_BYTES = 4096;

/** Real Google / Microsoft ID tokens are 1-3 KB; the circuit accepts far less. */
export const OIDC_MAX_ID_TOKEN_LENGTH = 16384;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function isCanonicalRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isOidcNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE.test(value);
}

function scopeBytes(scope: unknown): Uint8Array {
  if (typeof scope !== 'string') {
    throw new Error(`OIDC scope must be a string, got ${scope === null ? 'null' : typeof scope}.`);
  }
  if (scope.trim() === '') {
    throw new Error('OIDC scope is empty.');
  }
  let bytes: Uint8Array;
  try {
    bytes = ethers.utils.toUtf8Bytes(scope);
  } catch (e) {
    throw new Error(`OIDC scope is not valid Unicode text: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (bytes.length > OIDC_MAX_SCOPE_BYTES) {
    throw new Error(`OIDC scope is ${bytes.length} bytes; the limit is ${OIDC_MAX_SCOPE_BYTES}.`);
  }
  return bytes;
}

/** keccak256(tag || keccak256(scope) || requestId), as 64 lowercase hex characters. */
export function deriveOidcNonce(scope: string, requestId: string): string {
  const scopeHash = ethers.utils.keccak256(scopeBytes(scope));
  if (!isCanonicalRequestId(requestId)) {
    throw new Error(
      `OIDC requestId must be a lowercase UUID (8-4-4-4-12 hex), got ${JSON.stringify(requestId)}.`,
    );
  }
  const digest = ethers.utils.keccak256(
    ethers.utils.concat([
      ethers.utils.toUtf8Bytes(OIDC_NONCE_DOMAIN),
      scopeHash,
      ethers.utils.toUtf8Bytes(requestId),
    ]),
  );
  return digest.slice(2).toLowerCase();
}

/**
 * A fresh v4 UUID for a proof no dApp asked for. It names the in-app request
 * the same way the relay names a dApp's, and is stored in History so the proof
 * can be checked against it later.
 */
export function newStandaloneRequestId(
  random: (bytes: Uint8Array) => void = defaultRandom,
): string {
  const b = new Uint8Array(16);
  random(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = ethers.utils.hexlify(b).slice(2);
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  if (!isCanonicalRequestId(id)) throw new Error(`Minted request id is malformed: ${id}`);
  return id;
}

function defaultRandom(bytes: Uint8Array): void {
  const c = (globalThis as {crypto?: {getRandomValues?: (a: Uint8Array) => void}}).crypto;
  if (!c?.getRandomValues) {
    throw new Error('No secure random source (crypto.getRandomValues) to mint a request id.');
  }
  c.getRandomValues(bytes);
}

export type IdTokenNonceCheck =
  | {ok: true}
  | {ok: false; reason: 'malformed' | 'missing' | 'duplicated' | 'mismatch'; detail: string};

/**
 * How many object keys in already-valid JSON decode to `name`, at any depth,
 * escapes included. Walks strings in order so a quote inside a string never
 * starts one.
 */
function countKeys(json: string, name: string): number {
  let count = 0;
  let i = 0;
  while (i < json.length) {
    if (json[i] !== '"') {
      i++;
      continue;
    }
    let j = i + 1;
    while (json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
    const literal = json.slice(i, j + 1);
    let k = j + 1;
    while (k < json.length && /\s/.test(json[k])) k++;
    if (json[k] === ':' && JSON.parse(literal) === name) count++;
    i = j + 1;
  }
  return count;
}

function base64UrlToUtf8(part: string): string {
  if (!BASE64URL.test(part) || part.length % 4 === 1) {
    throw new Error('payload is not base64url');
  }
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  return ethers.utils.toUtf8String(ethers.utils.base64.decode(b64));
}

/**
 * Does this ID token carry exactly `expected` as its nonce?
 *
 * Reads the payload only; the signature is the proof's job and the provider
 * key check is core's (fix list item 1). A token carrying the key twice is
 * refused rather than resolved, because JSON.parse keeps the last and an
 * in-circuit parser may keep the first.
 */
export function checkIdTokenNonce(token: unknown, expected: string): IdTokenNonceCheck {
  if (!isOidcNonce(expected)) {
    throw new Error(`Expected nonce is not 64 lowercase hex characters: ${JSON.stringify(expected)}`);
  }
  if (typeof token !== 'string' || token.length === 0) {
    return {ok: false, reason: 'malformed', detail: 'no token'};
  }
  if (token.length > OIDC_MAX_ID_TOKEN_LENGTH) {
    return {ok: false, reason: 'malformed', detail: `token is ${token.length} characters; the limit is ${OIDC_MAX_ID_TOKEN_LENGTH}`};
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => p.length === 0)) {
    return {ok: false, reason: 'malformed', detail: 'not three non-empty dot-separated parts'};
  }
  let json: string;
  let payload: unknown;
  try {
    json = base64UrlToUtf8(parts[1]);
    payload = JSON.parse(json);
  } catch (e) {
    return {ok: false, reason: 'malformed', detail: `payload unreadable: ${e instanceof Error ? e.message : String(e)}`};
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {ok: false, reason: 'malformed', detail: 'payload is not a JSON object'};
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'nonce')) {
    return {ok: false, reason: 'missing', detail: 'token has no nonce claim'};
  }
  const nonceKeys = countKeys(json, 'nonce');
  if (nonceKeys !== 1) {
    return {ok: false, reason: 'duplicated', detail: `nonce claim appears ${nonceKeys} times`};
  }
  const actual = (payload as {nonce: unknown}).nonce;
  if (typeof actual !== 'string') {
    return {ok: false, reason: 'mismatch', detail: `nonce claim is a ${actual === null ? 'null' : typeof actual}, not a string`};
  }
  if (actual !== expected) {
    return {ok: false, reason: 'mismatch', detail: `token nonce ${JSON.stringify(actual)} is not the requested ${expected}`};
  }
  return {ok: true};
}
