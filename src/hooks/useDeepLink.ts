/**
 * Deep Link utilities for screens that handle proof requests
 * Note: Main deep link handling is done in App.tsx
 * This hook provides utilities for screens to work with proof requests
 */

import {useCallback} from 'react';
import {
  sendProofResponse,
  type ProofRequest,
  type ProofResponse,
  type VerificationType,
} from '../utils/deeplink';

/** Options for sending proof response */
export interface SendProofOptions {
  proof: string;
  publicInputs: string[];
  numPublicInputs: number;
  verificationType: VerificationType;
  verificationResult: boolean;
  startedAt: number;
  completedAt: number;
}

interface UseDeepLinkUtilsResult {
  /** Send completed proof back to dapp */
  sendProof: (
    request: ProofRequest,
    options: SendProofOptions,
  ) => Promise<boolean>;
  /** Send error response to dapp */
  sendError: (request: ProofRequest, error: string) => Promise<boolean>;
  /** Send cancelled response to dapp */
  sendCancelled: (request: ProofRequest, reason?: string) => Promise<boolean>;
}

export function useDeepLink(): UseDeepLinkUtilsResult {
  const sendProof = useCallback(
    async (
      request: ProofRequest,
      options: SendProofOptions,
    ): Promise<boolean> => {
      console.log('[DeepLink] Sending proof for request:', request.requestId);

      const response: ProofResponse = {
        requestId: request.requestId,
        circuit: request.circuit,
        status: 'completed',

        // Verification details
        verificationType: options.verificationType,
        verificationResult: options.verificationResult,

        // Timing information
        startedAt: options.startedAt,
        completedAt: options.completedAt,
        expiresAt: request.expiresAt,

        // Proof data
        proof: options.proof,
        publicInputs: options.publicInputs,
        numPublicInputs: options.numPublicInputs,

        // Original inputs (for verification)
        inputs: request.inputs,
      };

      return await sendProofResponse(response, request.callbackUrl);
    },
    [],
  );

  const sendError = useCallback(
    async (request: ProofRequest, error: string): Promise<boolean> => {
      console.log('[DeepLink] Sending error for request:', request.requestId);

      return await sendProofResponse(
        {
          requestId: request.requestId,
          circuit: request.circuit,
          status: 'error',
          error,
        },
        request.callbackUrl,
      );
    },
    [],
  );

  const sendCancelled = useCallback(
    async (request: ProofRequest, reason?: string): Promise<boolean> => {
      console.log('[DeepLink] Sending cancelled for request:', request.requestId);

      return await sendProofResponse(
        {
          requestId: request.requestId,
          circuit: request.circuit,
          status: 'cancelled',
          error: reason || 'User cancelled the request',
        },
        request.callbackUrl,
      );
    },
    [],
  );

  return {
    sendProof,
    sendError,
    sendCancelled,
  };
}

export default useDeepLink;
