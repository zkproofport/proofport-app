
export type CircuitType = 'coinbase_attestation' | 'coinbase_country_attestation';

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

// Empty inputs for circuits that get data from app
export interface EmptyInputs {}

export type CircuitInputs = CoinbaseKycInputs | CoinbaseCountryInputs | EmptyInputs;

export interface ProofRequest {
  requestId: string;
  circuit: CircuitType;
  inputs: CircuitInputs;
  callbackUrl: string;
  message?: string;
  dappName?: string;
  dappIcon?: string;
  createdAt: number;
  expiresAt?: number;
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

export function parseProofRequestUrl(url: string): ProofRequest | null {
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
      // Handle clientId field: relay sends 'clientId' at top level, app expects it in inputs
      if (decoded.clientId && (!request.inputs || !(request.inputs as any).clientId)) {
        if (!request.inputs) request.inputs = {};
        (request.inputs as any).clientId = decoded.clientId;
      }
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

  if (!['coinbase_attestation', 'coinbase_country_attestation'].includes(request.circuit)) {
    return {valid: false, error: `Invalid circuit type: ${request.circuit}`};
  }

  if (!request.callbackUrl) {
    return {valid: false, error: 'Missing callbackUrl'};
  }

  // Validate circuit-specific inputs
  if (request.circuit === 'coinbase_attestation' || request.circuit === 'coinbase_country_attestation') {
    // Coinbase KYC: userAddress is optional - app will connect wallet if not provided
    const inputs = request.inputs as CoinbaseKycInputs;
    if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
      return {valid: false, error: 'Invalid userAddress format'};
    }
    // Scope is required for coinbase_attestation
    if (request.circuit === 'coinbase_attestation' && !inputs.scope) {
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
 * Validates that a requestId exists in a TRUSTED relay server.
 *
 * Trust rules (from config/contracts.ts):
 * - Development: private IPs (localhost, 10.x, 192.168.x, 172.16-31.x) + trustedHosts (stg-relay.zkproofport.app)
 * - Production: trustedHosts only (relay.zkproofport.app)
 *
 * @param requestId - The request ID to validate
 * @param callbackUrl - The callback URL from the deep link (used to derive relay base URL)
 * @returns Promise resolving to { valid: boolean; error?: string }
 */
export async function validateRequestWithRelay(
  requestId: string,
  callbackUrl: string,
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
