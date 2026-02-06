import type {ProofRequest} from '../utils/deeplink';

let _activeRequest: ProofRequest | null = null;

export function setActiveProofRequest(request: ProofRequest | null): void {
  _activeRequest = request;
}

export function getActiveProofRequest(): ProofRequest | null {
  return _activeRequest;
}

export function clearActiveProofRequest(): void {
  _activeRequest = null;
}
