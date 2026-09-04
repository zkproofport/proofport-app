import {showReturnNotice, type ReturnNoticeKind} from './returnNoticeBridge';
import {ALL_CIRCUIT_IDS, isCircuitId, type CircuitName} from '../config/circuitIds';

/**
 * The circuit a deep link may name. Alias of the SDK's canonical id union —
 * this file used to re-declare the seven names, which made it the sixth place
 * the list had to be edited when a circuit was added.
 *
 * Deep links carry the CANONICAL id and only the canonical id. This app's
 * legacy hyphenated route ids are accepted at the navigation layer
 * (`canonicalCircuitId`), never here: a link naming `coinbase-kyc` was never
 * valid and is still refused.
 */
export type CircuitType = CircuitName;

export interface CoinbaseKycInputs {
  userAddress?: string; // Optional - app will connect wallet if not provided
  rawTransaction?: string;
  scope: string;
}

export interface CoinbaseCountryInputs {
  userAddress?: string;
  rawTransaction?: string;
  scope?: string;
  countryList?: string[];
  isIncluded?: boolean;
}

export interface OidcDomainInputs {
  domain: string; // Target domain to prove (e.g., 'google.com')
  scope: string;
  provider?: 'google' | 'microsoft'; // OIDC workspace provider for organization membership verification
}

// Empty inputs for circuits that get data from app
export interface EmptyInputs {}

export type CircuitInputs = CoinbaseKycInputs | CoinbaseCountryInputs | OidcDomainInputs | EmptyInputs;

export interface ProofRequest {
  requestId: string;
  circuit: CircuitType;
  inputs: CircuitInputs;
  callbackUrl: string;
  message?: string;
  dappName?: string;
  dappIcon?: string;
  /**
   * Optional: the app to bring back to the foreground once this request is
   * finished. A bare custom scheme (`mydapp://`) — never a URL, and never an
   * https origin, which would open a new browser tab rather than return
   * anyone anywhere. Set by the
   * requester and validated by the relay, but re-validated here before use:
   * the top-level deep-link fields are not covered by the relay's inputsHash,
   * so nothing that arrives in a deep link is trusted on arrival.
   */
  returnScheme?: string;
  /**
   * Where this request came into the app from. NOT parsed from the URL — the
   * entry point that received it sets this, and overwrites whatever a `data`
   * blob may have carried under the same name. See `ProofRequestOrigin`.
   */
  origin?: ProofRequestOrigin;
  createdAt: number;
  expiresAt?: number;
}

/**
 * How a proof request reached this app, which is the only thing that decides
 * whether there is anywhere to hand the user back to when it finishes.
 *
 * - `link` — another app on this device opened our scheme (`Linking`). It is
 *   still in the task stack behind us, so returning to it is meaningful.
 * - `scan` — we read a QR code off someone else's screen. The requester is on
 *   a different machine entirely; nothing on this device is waiting.
 * - `self` — this app issued the request to itself, which is how the OpenStoa
 *   mini-app logs in: it asks the OpenStoa server for a proof request and
 *   feeds the resulting deep link straight back into our own pipeline
 *   (`runSelfRelayLogin`). "Return to the requester" here means backgrounding
 *   the app the user is actively using.
 *
 * Only `link` has an app behind it. The other two must stay put — see
 * `requesterIsAnotherApp`.
 */
export type ProofRequestOrigin = 'link' | 'scan' | 'self';

/**
 * Is there another app on this device to hand the user back to?
 *
 * Absence is deliberately NOT treated as `link`. A request that reached us
 * through a path nobody classified is a request we know nothing about, and the
 * cost of guessing wrong is asymmetric: guessing "stay" leaves the user on a
 * success screen they can leave themselves, while guessing "return" can
 * background the app mid-flow with no way to tell that is what happened.
 */
export function requesterIsAnotherApp(origin?: ProofRequestOrigin): boolean {
  return origin === 'link';
}

export type VerificationType = 'on-chain' | 'off-chain';

export interface ProofResponse {
  requestId: string;
  circuit: CircuitType;
  status: 'completed' | 'error' | 'cancelled';

  // Verification details
  verificationType?: VerificationType;
  verificationResult?: boolean;

  // Timing information
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;

  // Proof data
  proof?: string;
  publicInputs?: string[];
  numPublicInputs?: number;
  nullifier?: string;

  // Verifier contract info (for SDK on-chain verification)
  verifierAddress?: string;
  chainId?: number;

  // Original inputs (for verification)
  inputs?: CircuitInputs;

  // Error details
  error?: string;
}

const SCHEME = 'zkproofport';

function decodeData<T>(encoded: string): T {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }

  const {decode} = require('base-64');
  const decoded = decode(base64);

  let json: string;
  try {
    json = decodeURIComponent(
      decoded
        .split('')
        .map((c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
  } catch {
    json = decoded;
  }

  return JSON.parse(json) as T;
}

export function parseProofRequestUrl(
  url: string,
  origin: ProofRequestOrigin,
): ProofRequest | null {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    // Format 1: Full request encoded in 'data' parameter
    const dataParam = params.get('data');
    if (dataParam) {
      const request = decodeData<ProofRequest & { circuitId?: string }>(dataParam);
      // Handle field name mismatch: relay sends 'circuitId', app uses 'circuit'
      if (!request.circuit && (request as any).circuitId) {
        request.circuit = (request as any).circuitId as CircuitType;
        delete (request as any).circuitId;
      }
      // Handle scope field: relay sends 'scope' at top level, app expects it in inputs
      const decoded = request as any;
      if (decoded.scope && (!request.inputs || !(request.inputs as any).scope)) {
        if (!request.inputs) request.inputs = {};
        (request.inputs as any).scope = decoded.scope;
      }
      // requestId and other relay fields stay at top level, do NOT merge into inputs
      //
      // `origin` is assigned LAST and unconditionally. This branch decodes a
      // whole object out of an attacker-suppliable base64 blob, so an `origin`
      // field can arrive from outside; overwriting it is what stops a remote
      // request from claiming it came from an app on this device.
      request.origin = origin;
      console.log('[DeepLink] Parsed request (format 1):', request.requestId);
      return request;
    }

    // Format 2: Individual parameters
    const circuit = params.get('circuit') as CircuitType;
    const requestId = params.get('requestId');
    const callbackUrl = params.get('callbackUrl');
    const inputsEncoded = params.get('inputs');

    if (!circuit || !requestId || !callbackUrl) {
      console.log('[DeepLink] Missing required parameters');
      return null;
    }

    // Parse inputs
    let inputs: CircuitInputs = {};
    if (inputsEncoded) {
      try {
        inputs = decodeData<CircuitInputs>(inputsEncoded);
      } catch (e) {
        console.log('[DeepLink] Failed to decode inputs, using empty object');
      }
    }

    const request: ProofRequest = {
      requestId,
      circuit,
      inputs,
      callbackUrl,
      message: params.get('message') || undefined,
      dappName: params.get('dappName') || undefined,
      dappIcon: params.get('dappIcon') || undefined,
      returnScheme: params.get('returnScheme') || undefined,
      // Not read from the URL — see ProofRequestOrigin.
      origin,
      createdAt: Date.now(),
      expiresAt: params.get('expiresAt')
        ? parseInt(params.get('expiresAt')!, 10)
        : undefined,
    };

    console.log('[DeepLink] Parsed request (format 2):', request.requestId);
    return request;
  } catch (error) {
    console.error('[DeepLink] Failed to parse URL:', error);
    return null;
  }
}

export function validateProofRequest(
  request: ProofRequest,
): {valid: boolean; error?: string} {
  if (!request.requestId) {
    return {valid: false, error: 'Missing requestId'};
  }

  if (!request.circuit) {
    return {valid: false, error: 'Missing circuit type'};
  }

  // The published list, not a copy of it. `ALL_CIRCUIT_IDS` is named in the
  // error so a rejected request says what WOULD have been accepted.
  if (!isCircuitId(request.circuit)) {
    return {
      valid: false,
      error: `Invalid circuit type: ${request.circuit}. Expected one of: ${ALL_CIRCUIT_IDS.join(', ')}`,
    };
  }

  if (!request.callbackUrl) {
    return {valid: false, error: 'Missing callbackUrl'};
  }

  // Validate circuit-specific inputs
  if (
    request.circuit === 'coinbase_attestation' ||
    request.circuit === 'coinbase_country_attestation' ||
    request.circuit === 'giwa_attestation'
  ) {
    // KYC-style circuits: userAddress is optional — app will connect wallet if not provided
    const inputs = request.inputs as CoinbaseKycInputs;
    if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
      return {valid: false, error: 'Invalid userAddress format'};
    }
    // Scope is required for coinbase_attestation / giwa_attestation
    if ((request.circuit === 'coinbase_attestation' || request.circuit === 'giwa_attestation') && !inputs.scope) {
      return {valid: false, error: 'Missing required scope parameter'};
    }
    // countryList and isIncluded are required for coinbase_country_attestation
    if (request.circuit === 'coinbase_country_attestation') {
      const countryInputs = request.inputs as CoinbaseCountryInputs;
      if (!countryInputs.countryList || !Array.isArray(countryInputs.countryList) || countryInputs.countryList.length === 0) {
        return {valid: false, error: 'countryList is required for coinbase_country_attestation'};
      }
      if (typeof countryInputs.isIncluded !== 'boolean') {
        return {valid: false, error: 'isIncluded is required for coinbase_country_attestation'};
      }
    }
    // If userAddress is not provided, app will prompt wallet connection
  }

  // OIDC domain attestation: scope is required
  if (request.circuit === 'oidc_domain_attestation') {
    const inputs = request.inputs as OidcDomainInputs;
    if (!inputs.scope) {
      return {valid: false, error: 'Missing required scope parameter for oidc_domain_attestation'};
    }
  }

  // Check expiry
  if (request.expiresAt && Date.now() > request.expiresAt) {
    return {valid: false, error: 'Request has expired'};
  }

  return {valid: true};
}

export function buildCallbackUrl(
  callbackUrl: string,
  response: ProofResponse,
): string {
  const url = new URL(callbackUrl);
  url.searchParams.set('requestId', response.requestId);
  url.searchParams.set('circuit', response.circuit);
  url.searchParams.set('status', response.status);

  if (response.status === 'completed' && response.proof) {
    url.searchParams.set('proof', response.proof);
    if (response.publicInputs) {
      url.searchParams.set('publicInputs', response.publicInputs.join(','));
    }
    if (response.numPublicInputs !== undefined) {
      url.searchParams.set('numPublicInputs', response.numPublicInputs.toString());
    }
    if (response.nullifier !== undefined) {
      url.searchParams.set('nullifier', response.nullifier);
    }
    if (response.completedAt) {
      url.searchParams.set('completedAt', response.completedAt.toString());
    }
  } else if (response.status === 'error' && response.error) {
    url.searchParams.set('error', response.error);
  }

  return url.toString();
}

export async function sendProofResponse(response: ProofResponse, callbackUrl: string): Promise<boolean> {
  if (!callbackUrl) {
    console.error('[DeepLink] callbackUrl is undefined, cannot send response');
    return false;
  }

  try {
    console.log('[DeepLink] Sending response to:', callbackUrl);

    const fetchResponse = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    });

    if (!fetchResponse.ok) {
      console.error('[DeepLink] HTTP error:', fetchResponse.status, fetchResponse.statusText);
      return false;
    }

    console.log('[DeepLink] Response sent successfully');
    return true;
  } catch (error) {
    console.error(`[DeepLink] Failed to send response to ${callbackUrl}:`, error);
    return false;
  }
}

/**
 * ---------------------------------------------------------------------------
 * Returning to the requesting app
 * ---------------------------------------------------------------------------
 *
 * There is no system API for "go back to whichever app sent me here". The only
 * way to move the user is to open a URL, so the requester has to tell us which
 * app to open, and that answer rides along in the proof request as
 * `returnScheme`. This is the same contract we are already on the other side
 * of: our AppKit metadata carries `redirect: { native: 'zkproofport://' }`
 * (src/config/AppKitConfig.ts) and MetaMask opens that when it is done. It does
 * not know or need our result page, and we do not need the requester's.
 *
 * The value is deliberately not a URL. One form is accepted, nothing else:
 *   bare custom scheme   `mydapp://`
 *
 * An https origin was accepted once and no longer is. Opening `https://host`
 * does not return the user to the page that sent the request — it hands the URL
 * to the browser, which opens a NEW tab on a fresh page, leaving the original
 * tab and all of its state behind. That is not a return, so the form is gone.
 * A web requester has no app to switch to and omits the field entirely.
 *
 * Refusing paths and query strings is the guard that matters. Anyone can obtain
 * a requestId from the relay, so anyone can put a `returnScheme` on a request —
 * the trusted-host check in validateRequestWithRelay() constrains WHICH RELAY
 * issued the request, not WHO asked it to. Restricting the value to "an app,
 * at its front door" means a hostile requester can at most launch an installed
 * app's default entry point, never drive it to an action such as
 * `bankapp://transfer?to=0xattacker`.
 *
 * Kept in sync with proofport-relay `src/returnScheme.ts` (the authority) and
 * proofport-app-sdk `src/deeplink.ts` (fail-fast for integrators).
 */

/** Longest accepted `returnScheme` value. */
export const MAX_RETURN_SCHEME_LENGTH = 128;

/** RFC 3986 scheme (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`) followed by exactly `://`. */
const BARE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\/$/;

const DENIED_RETURN_SCHEMES = new Set([
  'about',
  'blob',
  'content',
  'data',
  'facetime',
  'facetime-audio',
  'file',
  'ftp',
  'http',
  'https',
  'intent',
  'javascript',
  'jar',
  'mailto',
  'sms',
  'tel',
  'vbscript',
]);

/**
 * Normalises a `returnScheme` that arrived in a deep link.
 *
 * Returns the lowercased value when it is safe to open, or `null` for anything
 * else — including absent, empty and malformed values. A bad value is NOT an
 * error: the proof still runs, the user simply stays in this app afterwards.
 * Failing the whole request over a cosmetic field would turn a typo into a
 * broken proof flow, and would hand a hostile requester a denial-of-service.
 */
export function normalizeReturnScheme(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  // Length first: a huge string must never reach the regexes.
  if (value.length > MAX_RETURN_SCHEME_LENGTH) return null;
  if (/\s/.test(value)) return null;

  const normalized = value.toLowerCase();

  if (!BARE_SCHEME_RE.test(normalized)) return null;

  const schemeName = normalized.slice(0, normalized.indexOf(':'));
  if (DENIED_RETURN_SCHEMES.has(schemeName)) return null;

  return normalized;
}

/**
 * What happened to the user after the proof was delivered.
 *
 * Exactly three ways this can end, and the caller has to be able to tell them
 * apart — the third is the only one where the user needs to be told anything.
 */
export type ReturnOutcome =
  /** A scheme was opened and the OS accepted it: the requesting app is coming forward. */
  | 'switched'
  /** Android only: we sent ourselves to the back, so whatever was behind us resumed. */
  | 'backgrounded'
  /** Nothing automatic was possible. The user has been told to switch back themselves. */
  | 'stay';

/**
 * Hands the user back to wherever they came from.
 *
 * Best effort by design. The proof is already generated and already delivered
 * by the time this runs, so nothing here may throw, reject, or otherwise reach
 * the caller as a proof failure.
 *
 * Three strategies, in order:
 *
 * 1. A `returnScheme` was supplied -> open it. That is a native integrator
 *    naming its own app, or the SDK naming `googlechrome://` / `firefox://`
 *    because the requesting page was running in Chrome or Firefox for iOS.
 *
 *    Note the deliberate absence of a `canOpenURL()` pre-check: on iOS
 *    `canOpenURL` returns false for any scheme not listed in
 *    `LSApplicationQueriesSchemes` (see ios/ProofportApp/Info.plist), and we
 *    obviously cannot enumerate every integrator's scheme there. Gating on it
 *    would make this feature fail for everyone. `openURL` itself carries no
 *    such restriction, so we call it and swallow the rejection when no
 *    installed app claims the scheme.
 *
 * 2. Android, with no scheme or after a failed one -> `moveTaskToBack(true)`.
 *    Public API since API 1, and strictly better than opening a URL: the task
 *    behind us comes forward exactly as the user left it — same browser, same
 *    tab, same scroll position, same JavaScript state, no reload. It needs no
 *    detection and no `returnScheme` at all, which is why a web page on Android
 *    sends nothing. This is what MetaMask, Rainbow and Kraken all ship.
 *
 * 3. Everything else -> tell the user. iOS has no equivalent of
 *    `moveTaskToBack`: Apple provides no public API for an app to background
 *    itself (QA1561), and the private `_systemNavigationAction` trick wallets
 *    once shipped has been dead since iOS 17 as well as being an App Review
 *    2.5.1 violation. So when the requester named nothing and we are not on
 *    Android, the honest move is a notice — the system "< Back to X" breadcrumb
 *    is still at the top left, which is exactly what Apple DTS recommends.
 *
 * The "every outbound URL opens in the in-app WebView" rule does not apply
 * here: the only accepted value is a custom scheme, which is an app handoff
 * rather than a link, and a WebView cannot load one. Routing it through
 * InAppBrowser would keep the user inside ZKProofport, the exact opposite of
 * what this function exists to do.
 *
 * @param returnScheme - the app to open, from the proof request. Absent for
 *   every web requester except Chrome for iOS.
 * @param noticeKind - what to say if we end up having to tell the user to
 *   switch back themselves. `declined` on the reject path, so the notice cannot
 *   claim a proof was delivered when the user refused to make one.
 * @returns which of the three things happened
 */
export async function returnToRequester(
  returnScheme?: string,
  noticeKind: ReturnNoticeKind = 'delivered',
): Promise<ReturnOutcome> {
  const target = normalizeReturnScheme(returnScheme);

  if (target) {
    try {
      const {Linking} = require('react-native');
      await Linking.openURL(target);
      console.log('[DeepLink] Returned to requester:', target);
      return 'switched';
    } catch (error: any) {
      // No installed app claims the scheme, or the OS refused. Fall through to
      // the platform fallback rather than stranding the user here.
      console.log(
        `[DeepLink] Could not return to ${target}:`,
        error?.message ?? error,
      );
    }
  } else if (returnScheme !== undefined && returnScheme !== null) {
    console.log('[DeepLink] Ignoring unusable returnScheme:', returnScheme);
  }

  if (await moveSelfToBack()) {
    return 'backgrounded';
  }

  // Nothing automatic is possible. Say so rather than silently doing nothing,
  // or the user sits there waiting for a switch that is never coming.
  showReturnNotice(noticeKind);
  return 'stay';
}

/**
 * Android: send this app to the back so the previous task resumes.
 *
 * Returns false everywhere else, and false on Android when the native module is
 * missing (an older build, or a JS bundle running against a native binary that
 * predates it). Handing the user back must never become a crash on the success
 * path.
 */
async function moveSelfToBack(): Promise<boolean> {
  try {
    const {Platform, NativeModules} = require('react-native');
    if (Platform?.OS !== 'android') {
      return false;
    }
    const appSwitcher = NativeModules?.AppSwitcher;
    if (!appSwitcher?.moveTaskToBack) {
      console.log('[DeepLink] AppSwitcher native module unavailable');
      return false;
    }
    const moved = await appSwitcher.moveTaskToBack();
    console.log('[DeepLink] moveTaskToBack ->', moved);
    return moved === true;
  } catch (error: any) {
    console.log('[DeepLink] moveTaskToBack failed:', error?.message ?? error);
    return false;
  }
}

/**
 * Delivers a proof result to the relay and then hands the user back to the
 * requesting app.
 *
 * Order matters: the callback POST is awaited first, because opening another
 * app — or backgrounding this one — suspends us, and an in-flight fetch can be
 * cut off.
 *
 * @returns whether the callback POST succeeded. How the user was handed back is
 *   best effort and never changes this value.
 */
export async function sendProofResponseAndReturn(
  response: ProofResponse,
  request: Pick<ProofRequest, 'callbackUrl' | 'returnScheme' | 'origin'>,
): Promise<boolean> {
  const delivered = await sendProofResponse(response, request.callbackUrl);
  if (requesterIsAnotherApp(request.origin)) {
    await returnToRequester(request.returnScheme);
  } else {
    // Nobody is waiting outside. Leaving the user on the completion screen is
    // the whole behaviour here, so say so rather than returning silently.
    console.log(
      '[DeepLink] Request originated in-app (%s) — staying put',
      request.origin ?? 'unclassified',
    );
  }
  return delivered;
}

export function isProofportDeepLink(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  // Only match proof-request URLs, not wallet callbacks or other URLs
  return lowerUrl.startsWith(`${SCHEME}://proof-request`);
}

/**
 * Check if a hostname is a private/local IP address.
 * Matches: localhost, 127.x.x.x, 10.x.x.x, 192.168.x.x, 172.16-31.x.x
 */
function isPrivateHost(hostname: string): boolean {
  return /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
    hostname,
  );
}

/**
 * Computes a SHA-256 hex digest of the given string.
 * Uses ethers.js which is always available in React Native.
 */
async function computeSha256(data: string): Promise<string> {
  // @noble/hashes v2 subpaths require the `.js` suffix and moved sha256 to
  // `sha2`. The tree is on v2 (pulled by ts-mls's @noble/curves). See
  // docs/research/phase0-findings.md — revert with the Phase 0 PoC if v2 is dropped.
  const { sha256 } = require('@noble/hashes/sha2.js');
  const { bytesToHex } = require('@noble/hashes/utils.js');
  const encoder = new TextEncoder();
  return bytesToHex(sha256(encoder.encode(data)));
}

/**
 * Validates that a requestId exists in a TRUSTED relay server.
 *
 * Trust rules (from config/contracts.ts):
 * - Development: private IPs (localhost, 10.x, 192.168.x, 172.16-31.x) + trustedHosts (stg-relay.zkproofport.app)
 * - Production: trustedHosts only (relay.zkproofport.app)
 *
 * @param requestId - The request ID to validate
 * @param callbackUrl - The callback URL from the deep link (used to derive relay base URL)
 * @param parsedInputs - Optional parsed inputs from the deep link; when provided and relay returns
 *   an inputsHash, the local hash is compared to detect tampering
 * @returns Promise resolving to { valid: boolean; error?: string }
 */
export async function validateRequestWithRelay(
  requestId: string,
  callbackUrl: string,
  parsedInputs?: Record<string, unknown>,
): Promise<{valid: boolean; error?: string}> {
  try {
    // Derive relay base URL from callbackUrl
    // callbackUrl format: {relayBase}/api/v1/proof/callback
    const callbackPath = '/api/v1/proof/callback';
    const callbackIndex = callbackUrl.indexOf(callbackPath);
    if (callbackIndex === -1) {
      console.log('[DeepLink] callbackUrl does not match relay format:', callbackUrl);
      return {valid: false, error: 'Invalid callback URL format — not a registered relay endpoint'};
    }

    const relayBaseUrl = callbackUrl.substring(0, callbackIndex);

    // Extract hostname from relay URL and check against trusted hosts
    const {getRelayConfig} = require('../config/environment');
    const relayConfig = getRelayConfig();
    let relayHostname: string;
    try {
      const urlObj = new URL(relayBaseUrl);
      relayHostname = urlObj.hostname;
    } catch {
      console.log('[DeepLink] Failed to parse relay URL:', relayBaseUrl);
      return {valid: false, error: 'Invalid relay URL format'};
    }

    const isTrustedHost = relayConfig.trustedHosts.includes(relayHostname);
    const isAllowedPrivateIp = relayConfig.allowPrivateIps && isPrivateHost(relayHostname);

    if (!isTrustedHost && !isAllowedPrivateIp) {
      console.log('[DeepLink] Untrusted relay host:', relayHostname, '| trustedHosts:', relayConfig.trustedHosts, '| allowPrivateIps:', relayConfig.allowPrivateIps);
      return {
        valid: false,
        error: `Untrusted relay server: ${relayHostname}. Only authorized relay servers are accepted.`,
      };
    }

    console.log('[DeepLink] Trusted relay host:', relayHostname);

    // Validate requestId exists in relay
    const validateUrl = `${relayBaseUrl}/api/v1/proof/${requestId}`;
    console.log('[DeepLink] Validating requestId with relay:', validateUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(validateUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      console.log('[DeepLink] Relay validation failed: requestId not found');
      return {
        valid: false,
        error: `Request ${requestId} is not registered with the relay server`,
      };
    }

    if (!response.ok) {
      console.log('[DeepLink] Relay validation error: HTTP', response.status);
      return {
        valid: false,
        error: `Relay returned HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    console.log('[DeepLink] Relay validation success: status=', data.status);

    // Verify inputs hash integrity (if relay provides inputsHash and we have local inputs)
    if (data.inputsHash && parsedInputs) {
      const canonical = JSON.stringify(parsedInputs, Object.keys(parsedInputs).sort());
      const localHash = await computeSha256(canonical);

      if (localHash !== data.inputsHash) {
        console.log('[DeepLink] Inputs hash mismatch! Local:', localHash, 'Relay:', data.inputsHash);
        return {
          valid: false,
          error: 'Deep link integrity check failed — inputs have been tampered with',
        };
      }
      console.log('[DeepLink] Inputs hash verified successfully');
    }

    return {valid: true};
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('[DeepLink] Relay validation timed out');
      return {valid: false, error: 'Relay validation timed out'};
    }
    console.log('[DeepLink] Relay validation network error:', error.message);
    return {valid: false, error: `Cannot reach relay server: ${error.message}`};
  }
}
