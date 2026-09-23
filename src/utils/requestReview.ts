import {isCircuitId} from '../config/circuitIds';
import type {ProofRequest} from './deeplink';

export type ReviewBlockReason = 'unsupported' | 'expired';

export function reviewBlockReason(request: ProofRequest, now = Date.now()): ReviewBlockReason | undefined {
  if (!isCircuitId(request.circuit)) return 'unsupported';
  const expiry = request.expiresAt;
  if (expiry !== undefined && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= now)) {
    return 'expired';
  }
  return undefined;
}

export function requestInputFields(inputs: unknown): Record<string, unknown> {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return {};
  return Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== 'action' && key !== 'rawTransaction'));
}

export function deliveryHost(callbackUrl: string): string {
  try {
    return new URL(callbackUrl).host;
  } catch {
    return callbackUrl;
  }
}
