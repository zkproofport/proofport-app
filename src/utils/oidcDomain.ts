/**
 * OIDC Domain Attestation v2 — input builder for on-device proof generation.
 *
 * Must produce what the circuits repo's reference builder produces for the
 * same token (`circuits/oidc-domain-attestation/scripts/oidc-inputs.ts`, v2,
 * circuits a874776); `oidcDomainMatchesTheCircuitsBuilder.test.ts` holds the
 * two to identical vectors. All computation happens on the device; the only
 * network call is the provider's JWKS.
 *
 * Public inputs, in order (214 field elements):
 *   0-17     pubkey_modulus_limbs   18 x u128 (120-bit limbs)
 *   18-82    domain                 64 storage bytes + len
 *   83-114   scope                  keccak256(utf8(scope string))
 *   115-146  nullifier              keccak256(keccak256(email) || scope)
 *   147      provider               0 = Google, 1 = Microsoft
 *   148-179  aud_hash               keccak256(utf8(aud))
 *   180      nonce_mode             always 1 from the app (nonce bound)
 *   181-212  nonce_binding          the 32 bytes whose lowercase hex is the token's nonce
 *   213      now                    unix seconds, iat <= now < exp
 *
 * SHA precompute: the signed data is hashed up to the 64-byte block holding
 * the header/payload `.` (cut = floor(dot / 64) * 64); partial_data is the
 * rest, so it carries the whole payload, and base64_decode_offset = dot + 1 -
 * cut (1..64). The circuit refuses any other offset.
 *
 * This builder is the careful one: it refuses, with a message, every token
 * the circuit would refuse for a claim reason (aud, iss, iat/exp, nonce,
 * email verification, lengths), so a person sees why instead of a witness
 * failure after a minute of proving.
 */

import {ethers} from 'ethers';

// ─── Circuit constants (must match main.nr) ─────────────────────────────

export const OIDC_MAX_PARTIAL_DATA_LENGTH = 2048;
export const OIDC_MAX_DOMAIN_LENGTH = 64;
export const OIDC_MAX_EMAIL_LENGTH = 128;
export const OIDC_MAX_AUD_LENGTH = 128;
export const OIDC_PUBLIC_INPUT_COUNT = 214;
/** nonce_mode 1: the token's nonce claim is bound. The app always binds it. */
export const OIDC_NONCE_MODE_BOUND = 1;
/**
 * How far behind the token's `iat` the phone's clock may be and still prove,
 * with `now` = iat. The real time is at least iat (the token exists), so iat
 * is a true lower bound; a clock further behind is reported, not corrected.
 */
export const OIDC_MAX_CLOCK_BEHIND_SECONDS = 300;

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const MICROSOFT_V2_ISSUER =
  /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/;
const NONCE_HEX = /^[0-9a-f]{64}$/;

// ─── Types ──────────────────────────────────────────────────────────────

export interface OidcCircuitInputs {
  // Public inputs
  pubkey_modulus_limbs: string[]; // 18 × u128 decimal strings
  domain: {storage: number[]; len: number};
  scope: number[]; // 32 bytes
  nullifier: number[]; // 32 bytes
  provider: number; // 0 = Google (email_verified), 1 = Microsoft (xms_edov)
  aud_hash: number[]; // 32 bytes, keccak256(utf8(aud))
  nonce_mode: number; // 1 = nonce bound
  nonce_binding: number[]; // 32 bytes; the token nonce is their lowercase hex
  now: string; // u64 unix seconds, decimal

  // Private inputs
  partial_data: {storage: number[]; len: number};
  partial_hash: number[]; // 8 × u32
  full_data_length: number;
  base64_decode_offset: number;
  redc_params_limbs: string[]; // 18 × u128 decimal strings
  signature_limbs: string[]; // 18 × u128 decimal strings
}

export interface PrepareOidcParams {
  /** Raw JWT string (header.payload.signature) */
  jwt: string;
  /** Scope string for nullifier derivation */
  scope: string;
  /** Domain to prove. If omitted, auto-extracted from email claim. */
  domain?: string;
  /** Override JWKS URL instead of using OIDC Discovery */
  jwksUrl?: string;
  /** OIDC provider: 'google' | 'microsoft'. Determines email verification claim check. */
  provider?: 'google' | 'microsoft';
  /**
   * The nonce this request asked the provider for: 64 lowercase hex
   * characters (src/oidc/oidcNonce.ts). Becomes nonce_binding, and the token's
   * nonce claim must equal it.
   */
  nonce: string;
  /** The phone's clock, unix seconds. `now` is chosen from it (proofTimeFor). */
  clockSeconds: number;
}

/**
 * The `now` a proof claims: the phone's clock when iat <= clock < exp; iat
 * when the clock is at most OIDC_MAX_CLOCK_BEHIND_SECONDS behind it. Anything
 * else throws -- an expired token, or a clock too far off to trust.
 */
export function proofTimeFor(clockSeconds: number, iat: number, exp: number): number {
  if (!Number.isSafeInteger(clockSeconds) || clockSeconds < 0) {
    throw new Error(`Device clock is not a unix time in seconds: ${clockSeconds}`);
  }
  if (!(iat < exp)) {
    throw new Error(`ID token iat ${iat} is not before exp ${exp}`);
  }
  if (clockSeconds >= exp) {
    throw new Error(`ID token expired at ${exp}; the device clock reads ${clockSeconds}. Sign in again.`);
  }
  if (clockSeconds >= iat) return clockSeconds;
  if (iat - clockSeconds <= OIDC_MAX_CLOCK_BEHIND_SECONDS) return iat;
  throw new Error(
    `The device clock (${clockSeconds}) is ${iat - clockSeconds}s behind the ID token's issue time (${iat}). ` +
      'Set the clock automatically and try again.',
  );
}

/**
 * An integer claim as the circuit reads it: a bare run of digits in the raw
 * JSON. `1.7e9`, `"1700000000"` and `1700000000.0` all parse in JS and are
 * all refused in-circuit, so they are refused here.
 */
function integerClaim(payloadJson: string, payload: Record<string, unknown>, name: string): number {
  const value = payload[name];
  const raw = new RegExp(`"${name}"\\s*:\\s*(\\d+)\\s*[,}]`).exec(payloadJson);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || !raw || Number(raw[1]) !== value) {
    throw new Error(`ID token ${name} claim is not a whole number of seconds: ${JSON.stringify(value)}`);
  }
  return value;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function hexToBytes32(hex: string): Uint8Array {
  if (!NONCE_HEX.test(hex)) {
    throw new Error(`OIDC nonce must be 64 lowercase hex characters, got ${JSON.stringify(hex)}`);
  }
  return ethers.utils.arrayify(`0x${hex}`);
}

// ─── Base64url helpers ──────────────────────────────────────────────────

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  const padded = b64 + '='.repeat(pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── BigInt helpers ─────────────────────────────────────────────────────

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '0x';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return BigInt(hex);
}

function splitBigIntToChunks(
  value: bigint,
  chunkSize: number,
  numChunks: number,
): bigint[] {
  const mask = (1n << BigInt(chunkSize)) - 1n;
  const chunks: bigint[] = [];
  for (let i = 0; i < numChunks; i++) {
    chunks.push((value >> (BigInt(i) * BigInt(chunkSize))) & mask);
  }
  return chunks;
}

// ─── Partial SHA-256 ────────────────────────────────────────────────────

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Block(H: Uint32Array, block: Uint8Array): void {
  const w = new Uint32Array(64);
  let a = H[0],
    b = H[1],
    c = H[2],
    d = H[3];
  let e = H[4],
    f = H[5],
    g = H[6],
    h = H[7];
  for (let i = 0; i < 16; i++) {
    w[i] =
      (block[i * 4] << 24) |
      (block[i * 4 + 1] << 16) |
      (block[i * 4 + 2] << 8) |
      block[i * 4 + 3];
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
    const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
    const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }
  H[0] = (H[0] + a) >>> 0;
  H[1] = (H[1] + b) >>> 0;
  H[2] = (H[2] + c) >>> 0;
  H[3] = (H[3] + d) >>> 0;
  H[4] = (H[4] + e) >>> 0;
  H[5] = (H[5] + f) >>> 0;
  H[6] = (H[6] + g) >>> 0;
  H[7] = (H[7] + h) >>> 0;
}

function generatePartialSHA256(
  data: Uint8Array,
  hashUntilIndex: number,
): {partialHash: Uint32Array; remainingData: Uint8Array} {
  const blockSize = 64;
  const blockIndex = Math.floor(hashUntilIndex / blockSize);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  for (let i = 0; i < blockIndex; i++) {
    const block = new Uint8Array(blockSize);
    block.set(data.slice(i * blockSize, (i + 1) * blockSize));
    sha256Block(H, block);
  }
  return {partialHash: H, remainingData: data.slice(blockIndex * blockSize)};
}

// ─── JWKS fetching ──────────────────────────────────────────────────────

interface JWK {
  kid: string;
  kty: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

async function fetchJwksUrl(issuer: string): Promise<string> {
  const discoveryUrl = issuer.endsWith('/')
    ? `${issuer}.well-known/openid-configuration`
    : `${issuer}/.well-known/openid-configuration`;
  const resp = await fetch(discoveryUrl);
  if (!resp.ok) {
    throw new Error(
      `OIDC Discovery failed for ${discoveryUrl}: ${resp.status}`,
    );
  }
  const config = (await resp.json()) as {jwks_uri: string};
  if (!config.jwks_uri) {
    throw new Error(
      `No jwks_uri in OIDC Discovery response from ${discoveryUrl}`,
    );
  }
  return config.jwks_uri;
}

async function fetchMatchingKey(jwksUrl: string, kid: string): Promise<JWK> {
  const resp = await fetch(jwksUrl);
  if (!resp.ok) {
    throw new Error(`JWKS fetch failed: ${resp.status}`);
  }
  const jwks = (await resp.json()) as {keys: JWK[]};
  const key = jwks.keys.find(k => k.kid === kid);
  if (!key) {
    throw new Error(
      `No JWKS key matching kid="${kid}". Available: ${jwks.keys.map(k => k.kid).join(', ')}`,
    );
  }
  if (key.kty !== 'RSA') {
    throw new Error(`Expected RSA key, got ${key.kty}`);
  }
  return key;
}

// ─── Keccak-256 helper (ethers v5) ──────────────────────────────────────

function keccak256Bytes(data: Uint8Array): Uint8Array {
  return ethers.utils.arrayify(ethers.utils.keccak256(data));
}

// ─── Main export ────────────────────────────────────────────────────────

/**
 * Prepare all circuit inputs for oidc_domain_attestation from a raw JWT.
 * All computation happens locally on device — no server calls except JWKS fetch.
 */
export async function prepareOidcInputs(
  params: PrepareOidcParams,
): Promise<OidcCircuitInputs> {
  const {jwt, scope} = params;

  // 1. Decode JWT
  const [headerB64, payloadB64, signatureB64url] = jwt.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64url) {
    throw new Error('Invalid JWT format: expected 3 dot-separated parts');
  }

  const header = JSON.parse(
    new TextDecoder().decode(base64urlToBytes(headerB64)),
  );
  const payloadJson = new TextDecoder().decode(base64urlToBytes(payloadB64));
  const payload = JSON.parse(payloadJson);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('JWT payload is not a JSON object');
  }

  if (header.alg !== 'RS256') {
    throw new Error(
      `Unsupported JWT algorithm: ${header.alg}. Only RS256 is supported.`,
    );
  }
  if (!header.kid) {
    throw new Error('JWT header missing kid');
  }
  if (!payload.email) {
    throw new Error('JWT payload missing email claim');
  }
  // Provider-specific email verification check
  if (params.provider === 'microsoft') {
    // The circuit reads the literal `true`; a string "true" or 1 is refused there.
    if (payload.xms_edov !== true) {
      throw new Error('Microsoft JWT xms_edov is not true. Email domain is not verified.');
    }
  } else if (params.provider === 'google' || !params.provider) {
    if (payload.email_verified !== true) {
      throw new Error('JWT email_verified is not true');
    }
  } else {
    throw new Error(`Unsupported OIDC provider: ${params.provider}`);
  }

  // iss -- checked before it is used to find the provider's keys.
  const iss = payload.iss;
  if (params.provider === 'microsoft') {
    if (typeof iss !== 'string' || !MICROSOFT_V2_ISSUER.test(iss)) {
      throw new Error(
        `ID token iss ${JSON.stringify(iss)} is not a Microsoft v2.0 tenant issuer (https://login.microsoftonline.com/<tenant>/v2.0).`,
      );
    }
  } else if (typeof iss !== 'string' || !GOOGLE_ISSUERS.has(iss)) {
    throw new Error(`ID token iss ${JSON.stringify(iss)} is not Google.`);
  }

  // aud -- one string; the circuit binds its keccak256.
  const aud = payload.aud;
  if (typeof aud !== 'string' || aud.length === 0) {
    throw new Error(`ID token aud must be one non-empty string, got ${JSON.stringify(aud)}`);
  }
  if (utf8Length(aud) > OIDC_MAX_AUD_LENGTH) {
    throw new Error(`ID token aud is ${utf8Length(aud)} bytes; the circuit holds ${OIDC_MAX_AUD_LENGTH}.`);
  }

  // iat / exp -> now.
  const iat = integerClaim(payloadJson, payload, 'iat');
  const exp = integerClaim(payloadJson, payload, 'exp');
  const now = proofTimeFor(params.clockSeconds, iat, exp);

  // nonce -- the one this request asked for.
  const nonceBinding = hexToBytes32(params.nonce);
  if (payload.nonce !== params.nonce) {
    throw new Error(
      `ID token nonce ${JSON.stringify(payload.nonce)} is not this request's nonce ${params.nonce}.`,
    );
  }

  if (typeof payload.email !== 'string') {
    throw new Error('JWT payload email claim is not a string');
  }
  const email = payload.email;
  if (utf8Length(email) > OIDC_MAX_EMAIL_LENGTH) {
    throw new Error(`Email is ${utf8Length(email)} bytes; the circuit holds ${OIDC_MAX_EMAIL_LENGTH}.`);
  }
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) {
    throw new Error(`Invalid email format: ${email}`);
  }
  // Domain is optional — auto-extract from JWT email if not provided. The
  // circuit requires the email to END in exactly this domain after its '@'.
  const emailDomain = email.substring(atIndex + 1);
  const domain = params.domain || emailDomain;
  if (domain !== emailDomain) {
    throw new Error(`Email domain "${emailDomain}" is not the requested domain "${domain}"`);
  }

  // 2. Fetch JWKS and find matching key
  const jwksUrl = params.jwksUrl || (await fetchJwksUrl(iss));
  const jwk = await fetchMatchingKey(jwksUrl, header.kid);

  // 3. Compute RSA limbs
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64urlToBytes(signatureB64url);
  const signatureBigInt = bytesToBigInt(signatureBytes);
  const modulusBytes = base64urlToBytes(jwk.n);
  const modulusBigInt = bytesToBigInt(modulusBytes);
  const redcParam = (1n << (2n * 2048n + 4n)) / modulusBigInt;

  const pubkeyLimbs = splitBigIntToChunks(modulusBigInt, 120, 18).map(v =>
    v.toString(),
  );
  const redcLimbs = splitBigIntToChunks(redcParam, 120, 18).map(v =>
    v.toString(),
  );
  const sigLimbs = splitBigIntToChunks(signatureBigInt, 120, 18).map(v =>
    v.toString(),
  );

  // 4. Partial SHA-256: precompute the blocks before the one holding the
  // header/payload '.', so partial_data carries the whole payload (the circuit
  // reads iss and aud, which come before email).
  const dot = headerB64.length;
  const cut = Math.floor(dot / 64) * 64;
  const {partialHash, remainingData} = generatePartialSHA256(signedData, cut);

  if (remainingData.length > OIDC_MAX_PARTIAL_DATA_LENGTH) {
    throw new Error(
      `ID token too large: ${remainingData.length} bytes after the SHA precompute; ` +
        `the circuit holds ${OIDC_MAX_PARTIAL_DATA_LENGTH}.`,
    );
  }

  const partialDataPadded = new Uint8Array(OIDC_MAX_PARTIAL_DATA_LENGTH);
  partialDataPadded.set(remainingData);

  // Index of the first payload byte within partial_data: 1..64.
  const base64DecodeOffset = dot + 1 - cut;

  // 5. Domain BoundedVec
  const domainBytes = new TextEncoder().encode(domain);
  if (domainBytes.length > OIDC_MAX_DOMAIN_LENGTH) {
    throw new Error(
      `Domain "${domain}" exceeds max length ${OIDC_MAX_DOMAIN_LENGTH}`,
    );
  }
  const domainStorage = new Uint8Array(OIDC_MAX_DOMAIN_LENGTH);
  domainStorage.set(domainBytes);

  // 6. Scope = keccak256(scope_string)
  const scopeBytes = keccak256Bytes(
    new TextEncoder().encode(scope),
  );

  // 7. Nullifier = keccak256(keccak256(email) ++ scope)
  const emailBytes = new TextEncoder().encode(email);
  const emailHash = keccak256Bytes(emailBytes);
  const preimage = new Uint8Array(64);
  preimage.set(emailHash, 0);
  preimage.set(scopeBytes, 32);
  const nullifierBytes = keccak256Bytes(preimage);

  // 8. aud_hash = keccak256(aud)
  const audHash = keccak256Bytes(new TextEncoder().encode(aud));

  return {
    pubkey_modulus_limbs: pubkeyLimbs,
    domain: {storage: Array.from(domainStorage), len: domainBytes.length},
    scope: Array.from(scopeBytes),
    nullifier: Array.from(nullifierBytes),
    provider: params.provider === 'microsoft' ? 1 : 0,
    aud_hash: Array.from(audHash),
    nonce_mode: OIDC_NONCE_MODE_BOUND,
    nonce_binding: Array.from(nonceBinding),
    now: String(now),
    partial_data: {
      storage: Array.from(partialDataPadded),
      len: remainingData.length,
    },
    partial_hash: Array.from(partialHash),
    full_data_length: signedData.length,
    base64_decode_offset: base64DecodeOffset,
    redc_params_limbs: redcLimbs,
    signature_limbs: sigLimbs,
  };
}

// ─── Flatten for mopro ─────────────────────────────────────────────────

/**
 * Convert OidcCircuitInputs to a flat string[] for mopro's generateNoirProof().
 *
 * Order MUST match the circuit's main() parameter order:
 *   pubkey_modulus_limbs, domain, scope, nullifier, provider,
 *   aud_hash, nonce_mode, nonce_binding, now,
 *   partial_data, partial_hash, full_data_length, base64_decode_offset,
 *   redc_params_limbs, signature_limbs
 * The first OIDC_PUBLIC_INPUT_COUNT values are the public inputs.
 *
 * Noir noir_js format:
 * - u128 limbs: decimal strings (no conversion needed)
 * - BoundedVec<u8, N>: len as hex, then N storage items as hex
 * - [u8; 32]: 32 hex strings
 * - [u32; 8]: 8 hex strings
 * - u32: single hex string
 */
export function flattenOidcInputs(inputs: OidcCircuitInputs): string[] {
  const flat: string[] = [];

  // pubkey_modulus_limbs: [u128; 18] — decimal strings as-is
  for (const limb of inputs.pubkey_modulus_limbs) {
    flat.push(limb);
  }

  // domain: BoundedVec<u8, 64> — ABI order: storage[64] then len
  for (const b of inputs.domain.storage) {
    flat.push(b.toString());
  }
  flat.push(inputs.domain.len.toString());

  // scope: [u8; 32] — decimal strings (matching Coinbase pattern)
  for (const b of inputs.scope) {
    flat.push(b.toString());
  }

  // nullifier: [u8; 32]
  for (const b of inputs.nullifier) {
    flat.push(b.toString());
  }

  // provider: u8 (0 = Google, 1 = Microsoft)
  flat.push(inputs.provider.toString());

  // aud_hash: [u8; 32]
  for (const b of inputs.aud_hash) {
    flat.push(b.toString());
  }

  // nonce_mode: u8
  flat.push(inputs.nonce_mode.toString());

  // nonce_binding: [u8; 32]
  for (const b of inputs.nonce_binding) {
    flat.push(b.toString());
  }

  // now: u64, decimal
  flat.push(inputs.now);

  // partial_data: BoundedVec<u8, 2048> — ABI order: storage[2048] then len
  for (const b of inputs.partial_data.storage) {
    flat.push(b.toString());
  }
  flat.push(inputs.partial_data.len.toString());

  // partial_hash: [u32; 8] — decimal strings
  for (const val of inputs.partial_hash) {
    flat.push((val >>> 0).toString());
  }

  // full_data_length: u32
  flat.push(inputs.full_data_length.toString());

  // base64_decode_offset: u32
  flat.push(inputs.base64_decode_offset.toString());

  // redc_params_limbs: [u128; 18] — decimal strings
  for (const limb of inputs.redc_params_limbs) {
    flat.push(limb);
  }

  // signature_limbs: [u128; 18] — decimal strings
  for (const limb of inputs.signature_limbs) {
    flat.push(limb);
  }

  return flat;
}
