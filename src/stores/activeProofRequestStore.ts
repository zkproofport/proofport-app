import type {ProofRequest} from '../utils/deeplink';

let _activeRequest: ProofRequest | null = null;

export function setActiveProofRequest(request: ProofRequest | null): void {
  _activeRequest = request;
}

export function getActiveProofRequest(): ProofRequest | null {
  return _activeRequest;
}

/** Async completion may clear only its own request; app reset may clear all. */
export function clearActiveProofRequest(expectedRequest?: ProofRequest): void {
  if (expectedRequest === undefined || _activeRequest === expectedRequest) {
    _activeRequest = null;
  }
}
