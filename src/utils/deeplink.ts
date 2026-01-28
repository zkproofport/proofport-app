/**
 * Deep Link utilities for ProofPort App
 */

// Linking import removed - now using HTTP POST for callbacks

export type CircuitType = 'age_verifier' | 'coinbase_attestation';

export interface AgeVerifierInputs {
  birthYear: number;
  currentYear: number;
  minAge: number;
}

export interface CoinbaseKycInputs {
  userAddress?: string; // Optional - app will connect wallet if not provided
  rawTransaction?: string;
}

// Empty inputs for circuits that get data from app
export interface EmptyInputs {}

export type CircuitInputs = AgeVerifierInputs | CoinbaseKycInputs | EmptyInputs;

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

  // Original inputs (for verification)
  inputs?: CircuitInputs;

  // Error details
  error?: string;
}

const SCHEME = 'zkproofport';

/**
 * Decode base64url encoded data (with UTF-8 support)
 */
function decodeData<T>(encoded: string): T {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }

  // React Native에서는 base-64 라이브러리 사용
  const {decode} = require('base-64');
  const decoded = decode(base64);

  // UTF-8 디코딩
  let json: string;
  try {
    json = decodeURIComponent(
      decoded
        .split('')
        .map((c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
  } catch {
    // fallback: 이미 ASCII인 경우
    json = decoded;
  }

  return JSON.parse(json) as T;
}

/**
 * Parse proof request from deep link URL
 * Supports two formats:
 * 1. zkproofport://proof-request?data=<base64_encoded_full_request>
 * 2. zkproofport://proof-request?circuit=...&requestId=...&inputs=<base64>&callbackUrl=...
 */
export function parseProofRequestUrl(url: string): ProofRequest | null {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;

    // Format 1: Full request encoded in 'data' parameter
    const dataParam = params.get('data');
    if (dataParam) {
      const request = decodeData<ProofRequest>(dataParam);
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

/**
 * Validate proof request
 */
export function validateProofRequest(
  request: ProofRequest,
): {valid: boolean; error?: string} {
  if (!request.requestId) {
    return {valid: false, error: 'Missing requestId'};
  }

  if (!request.circuit) {
    return {valid: false, error: 'Missing circuit type'};
  }

  if (!['age_verifier', 'coinbase_attestation'].includes(request.circuit)) {
    return {valid: false, error: `Invalid circuit type: ${request.circuit}`};
  }

  if (!request.callbackUrl) {
    return {valid: false, error: 'Missing callbackUrl'};
  }

  // Validate circuit-specific inputs
  if (request.circuit === 'age_verifier') {
    const inputs = request.inputs as AgeVerifierInputs;
    if (
      typeof inputs.birthYear !== 'number' ||
      inputs.birthYear < 1900 ||
      inputs.birthYear > 2100
    ) {
      return {valid: false, error: 'Invalid birthYear'};
    }
    if (
      typeof inputs.currentYear !== 'number' ||
      inputs.currentYear < 2000 ||
      inputs.currentYear > 2100
    ) {
      return {valid: false, error: 'Invalid currentYear'};
    }
    if (
      typeof inputs.minAge !== 'number' ||
      inputs.minAge < 0 ||
      inputs.minAge > 150
    ) {
      return {valid: false, error: 'Invalid minAge'};
    }
  } else if (request.circuit === 'coinbase_attestation') {
    // Coinbase KYC: userAddress is optional - app will connect wallet if not provided
    const inputs = request.inputs as CoinbaseKycInputs;
    if (inputs.userAddress && !/^0x[a-fA-F0-9]{40}$/.test(inputs.userAddress)) {
      return {valid: false, error: 'Invalid userAddress format'};
    }
    // If userAddress is not provided, app will prompt wallet connection
  }

  // Check expiry
  if (request.expiresAt && Date.now() > request.expiresAt) {
    return {valid: false, error: 'Request has expired'};
  }

  return {valid: true};
}

/**
 * Build callback URL with proof response
 */
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
    if (response.completedAt) {
      url.searchParams.set('completedAt', response.completedAt.toString());
    }
  } else if (response.status === 'error' && response.error) {
    url.searchParams.set('error', response.error);
  }

  return url.toString();
}

/**
 * Send proof response back to dapp via HTTP POST (webhook style)
 */
export async function sendProofResponse(response: ProofResponse, callbackUrl: string): Promise<boolean> {
  try {
    console.log('[DeepLink] Sending response via HTTP POST to:', callbackUrl);
    console.log('[DeepLink] Response:', JSON.stringify(response, null, 2));

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
    console.error('[DeepLink] Failed to send response:', error);
    return false;
  }
}

/**
 * Check if URL is a ProofPort proof request deep link
 * Returns false for other zkproofport:// URLs (e.g., wallet callbacks)
 */
export function isProofPortDeepLink(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  // Only match proof-request URLs, not wallet callbacks or other URLs
  return lowerUrl.startsWith(`${SCHEME}://proof-request`);
}
