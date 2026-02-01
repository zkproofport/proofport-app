// Main deep link handling is in App.tsx; this hook provides response utilities
import {useCallback} from 'react';
import {
  sendProofResponse,
  type ProofRequest,
  type ProofResponse,
  type VerificationType,
} from '../utils/deeplink';

export interface SendProofOptions {
  proof: string;
  publicInputs: string[];
  numPublicInputs: number;
  verificationType: VerificationType;
  verificationResult: boolean;
  startedAt: number;
  completedAt: number;
  verifierAddress?: string;
  chainId?: number;
  nullifier?: string;
}

interface UseDeepLinkUtilsResult {
  sendProof: (
    request: ProofRequest,
    options: SendProofOptions,
  ) => Promise<boolean>;
  sendError: (request: ProofRequest, error: string) => Promise<boolean>;
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
        verificationType: options.verificationType,
        verificationResult: options.verificationResult,
        startedAt: options.startedAt,
        completedAt: options.completedAt,
        expiresAt: request.expiresAt,
        proof: options.proof,
        publicInputs: options.publicInputs,
        numPublicInputs: options.numPublicInputs,
        nullifier: options.nullifier,
        verifierAddress: options.verifierAddress,
        chainId: options.chainId,
        inputs: request.inputs,
      };

      return sendProofResponse(response, request.callbackUrl);
    },
    [],
  );

  const sendError = useCallback(
    async (request: ProofRequest, error: string): Promise<boolean> => {
      console.log('[DeepLink] Sending error for request:', request.requestId);

      return sendProofResponse(
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

      return sendProofResponse(
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
