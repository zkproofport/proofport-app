/**
 * The OIDC provider-key statement: "at `now`, this RSA modulus was in
 * `provider`'s published key list", which the OIDC circuit requires a signer
 * it trusts to have signed (circuits `oidc-domain-attestation/src/provider_key.nr`,
 * fix list item 12 in circuits-dev.md).
 *
 * WHY. The modulus is a public input and the RSA check only says the token
 * was signed by THAT key. Without this statement a self-made key and token
 * would verify on chain. The app is the signer (App Attest), so before it
 * signs it must itself have seen the modulus in the provider's live key list
 * -- this module is where that is made structural:
 *
 *   - `fetchLiveProviderKeys` is the only producer of a `LiveProviderKeys`
 *     (a module-private registry, not a type a caller can fill in), fetches
 *     with the HTTP cache bypassed, and fails closed (E3002) on anything but
 *     a well-formed list. There is no stale copy to fall back to.
 *   - `requireLiveModulus` refuses (E2008) a modulus that is not exactly one
 *     of that list's RSA `n` values, a list for another provider, or a list
 *     older than LIVE_KEYS_MAX_AGE_SECONDS.
 *
 * The 313 statement bytes (provider_key.nr, README "Provider-key statement"):
 *   0..16   "ZKProofport/PK/1"
 *   16..48  keccak256("oidc_domain_attestation")
 *   48      provider (0 Google, 1 Microsoft) = public `provider`
 *   49..57  now, u64 big-endian = public `now`
 *   57..313 the RSA modulus, 256 bytes big-endian (the JWKS `n`)
 */
import {ethers} from 'ethers';
import type {ErrorCode} from '../constants/errorCodes';

export const PROVIDER_KEY_STATEMENT_LEN = 313;
export const PROVIDER_KEY_STATEMENT_MAGIC = 'ZKProofport/PK/1';
/** keccak256(utf8("oidc_domain_attestation")), provider_key.nr CIRCUIT_TAG. */
export const OIDC_CIRCUIT_TAG = '0x90bb379df4b0dde794c16917c2df39a398dc7e3481b2f50d031dfe490a8e062b';
export const RSA_MODULUS_BYTES = 256;
/** How old a fetched key list may be when the statement is signed. */
export const LIVE_KEYS_MAX_AGE_SECONDS = 120;
const FETCH_TIMEOUT_MS = 10000;

export const OIDC_PROVIDER_ID = Object.freeze({google: 0, microsoft: 1} as const);
export type OidcProviderId = (typeof OIDC_PROVIDER_ID)[keyof typeof OIDC_PROVIDER_ID];

/** A failure on the provider-key path, carrying the ErrorModal code. */
export class OidcProviderKeyError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'OidcProviderKeyError';
    this.code = code;
  }
}

/** Codes by cause. One table, no default. */
export const PROVIDER_KEY_ERROR_CODE = Object.freeze({
  /** The provider's key list could not be fetched or was not a key list. */
  lookupFailed: 'E3002',
  /** The token's key is not one the provider publishes (or not usable). */
  notPublished: 'E2008',
} satisfies Record<string, ErrorCode>);

function base64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error('not base64url');
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return ethers.utils.base64.decode(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/**
 * The JWKS `n` as exactly 256 big-endian bytes, as the circuits' reference
 * builder (`modulusBytes`) reads it: leading zero bytes dropped, then a
 * 2048-bit modulus (256 bytes, top bit set) or a refusal.
 */
export function modulusBytes(nB64url: unknown): Uint8Array {
  if (typeof nB64url !== 'string' || nB64url.length === 0) {
    throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.notPublished, `The provider key's modulus is not a string: ${JSON.stringify(nB64url)}`);
  }
  let n: Uint8Array;
  try {
    n = base64urlToBytes(nB64url);
  } catch {
    throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.notPublished, `The provider key's modulus is not base64url: ${nB64url}`);
  }
  let start = 0;
  while (n.length - start > RSA_MODULUS_BYTES && n[start] === 0) start++;
  const out = n.slice(start);
  if (out.length !== RSA_MODULUS_BYTES || (out[0] & 0x80) === 0) {
    throw new OidcProviderKeyError(
      PROVIDER_KEY_ERROR_CODE.notPublished,
      `The provider key is not a 2048-bit RSA modulus (${out.length} bytes); the circuit takes exactly 2048 bits.`,
    );
  }
  return out;
}

/** The 313 bytes the signer signs for `provider`, `now` and `modulus`. */
export function providerKeyStatement(provider: OidcProviderId, now: number | bigint, modulus: Uint8Array): Uint8Array {
  if (provider !== OIDC_PROVIDER_ID.google && provider !== OIDC_PROVIDER_ID.microsoft) {
    throw new Error(`Unknown OIDC provider id ${provider}. Known: ${Object.values(OIDC_PROVIDER_ID).join(', ')}.`);
  }
  const t = BigInt(now);
  if (t < 0n || t >= 1n << 64n) throw new Error(`now ${t} is not a u64`);
  if (modulus.length !== RSA_MODULUS_BYTES) {
    throw new Error(`modulus is ${modulus.length} bytes; the statement takes ${RSA_MODULUS_BYTES}`);
  }
  const s = new Uint8Array(PROVIDER_KEY_STATEMENT_LEN);
  s.set(ethers.utils.toUtf8Bytes(PROVIDER_KEY_STATEMENT_MAGIC), 0);
  s.set(ethers.utils.arrayify(OIDC_CIRCUIT_TAG), 16);
  s[48] = provider;
  for (let i = 0; i < 8; i++) s[49 + i] = Number((t >> BigInt(8 * (7 - i))) & 0xffn);
  s.set(modulus, 57);
  return s;
}

export interface LiveJwk {
  kid: string;
  kty: string;
  n?: unknown;
  [key: string]: unknown;
}

/** A key list as the provider served it, moments ago. Only fetchLiveProviderKeys makes one. */
export interface LiveProviderKeys {
  readonly provider: OidcProviderId;
  readonly jwksUrl: string;
  /** Unix seconds. */
  readonly fetchedAt: number;
  readonly keys: readonly LiveJwk[];
}

const fetchedLists = new WeakSet<object>();

type FetchLike = (url: string, init: {method: string; cache: 'no-store'; headers: Record<string, string>; signal?: AbortSignal}) =>
  Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;

async function getJson(url: string, what: string, fetchImpl: FetchLike): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // `no-store` makes the RN fetch polyfill (whatwg-fetch) add a cache-busting
    // query parameter; the header asks every cache on the way to revalidate.
    const res = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {'Cache-Control': 'no-cache', Pragma: 'no-cache'},
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new OidcProviderKeyError(
      PROVIDER_KEY_ERROR_CODE.lookupFailed,
      `${what} from ${url} did not complete: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The provider's key list, fetched now: OIDC discovery on the (already
 * checked) issuer, then its `jwks_uri` -- or `jwksUrl` when given (tests).
 * Anything other than a list of keys is E3002; nothing is cached.
 */
export async function fetchLiveProviderKeys(
  provider: OidcProviderId,
  issuer: string,
  opts: {jwksUrl?: string; fetchImpl?: FetchLike; nowSeconds?: () => number} = {},
): Promise<LiveProviderKeys> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  let jwksUrl = opts.jwksUrl;
  if (!jwksUrl) {
    const discoveryUrl = issuer.endsWith('/')
      ? `${issuer}.well-known/openid-configuration`
      : `${issuer}/.well-known/openid-configuration`;
    const config = (await getJson(discoveryUrl, 'OIDC discovery', fetchImpl)) as {jwks_uri?: unknown} | null;
    if (!config || typeof config.jwks_uri !== 'string' || !/^https:\/\//.test(config.jwks_uri)) {
      throw new OidcProviderKeyError(
        PROVIDER_KEY_ERROR_CODE.lookupFailed,
        `OIDC discovery at ${discoveryUrl} named no https jwks_uri: ${JSON.stringify(config?.jwks_uri ?? null)}`,
      );
    }
    jwksUrl = config.jwks_uri;
  }
  const body = (await getJson(jwksUrl, 'The provider key list', fetchImpl)) as {keys?: unknown} | null;
  const keys = body?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.lookupFailed, `${jwksUrl} did not answer with a key list: ${JSON.stringify(body)}`);
  }
  for (const k of keys) {
    if (!k || typeof k !== 'object' || typeof (k as LiveJwk).kid !== 'string' || typeof (k as LiveJwk).kty !== 'string') {
      throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.lookupFailed, `${jwksUrl} listed a key without kid/kty: ${JSON.stringify(k)}`);
    }
  }
  const list: LiveProviderKeys = Object.freeze({
    provider,
    jwksUrl,
    fetchedAt: Math.floor((opts.nowSeconds ?? (() => Date.now() / 1000))()),
    keys: Object.freeze(keys.map(k => Object.freeze({...(k as LiveJwk)}))),
  });
  fetchedLists.add(list);
  return list;
}

/** The token's key in `live`, by kid; E2008 when the provider does not list it. */
export function liveKeyForKid(live: LiveProviderKeys, kid: string): LiveJwk {
  const matches = live.keys.filter(k => k.kid === kid);
  if (matches.length !== 1) {
    throw new OidcProviderKeyError(
      PROVIDER_KEY_ERROR_CODE.notPublished,
      matches.length === 0
        ? `The ID token was signed with key "${kid}", which ${live.jwksUrl} does not list. Listed: ${live.keys.map(k => k.kid).join(', ')}.`
        : `${live.jwksUrl} lists key "${kid}" ${matches.length} times.`,
    );
  }
  if (matches[0].kty !== 'RSA') {
    throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.notPublished, `Key "${kid}" is ${matches[0].kty}, not RSA.`);
  }
  return matches[0];
}

/**
 * Refuses unless `modulus` is exactly the `n` of an RSA key in a list this
 * module fetched for `provider` within LIVE_KEYS_MAX_AGE_SECONDS. The signer
 * calls this immediately before signing.
 */
export function requireLiveModulus(
  live: LiveProviderKeys,
  provider: OidcProviderId,
  modulus: Uint8Array,
  nowSeconds: number,
): void {
  const refuse = (why: string): never => {
    throw new OidcProviderKeyError(PROVIDER_KEY_ERROR_CODE.notPublished, why);
  };
  if (!fetchedLists.has(live)) refuse('The key list was not fetched from the provider by this app; nothing is signed.');
  if (live.provider !== provider) refuse(`The key list is provider ${live.provider}'s; the statement is for provider ${provider}.`);
  const age = nowSeconds - live.fetchedAt;
  if (!(age >= 0 && age <= LIVE_KEYS_MAX_AGE_SECONDS)) {
    refuse(`The key list was fetched ${age}s ago; it must be at most ${LIVE_KEYS_MAX_AGE_SECONDS}s old when the statement is signed.`);
  }
  const want = ethers.utils.hexlify(modulus);
  const listed = live.keys.some(k => {
    if (k.kty !== 'RSA') return false;
    try {
      return ethers.utils.hexlify(modulusBytes(k.n)) === want;
    } catch {
      return false;
    }
  });
  if (!listed) refuse(`The modulus to be signed is not in ${live.jwksUrl}; nothing is signed.`);
}
