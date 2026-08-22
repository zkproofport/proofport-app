// Main deep link handling is in App.tsx; this hook provides response utilities
import {useCallback} from 'react';
import {
  sendProofResponse,
  sendProofResponseAndReturn,
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

      // Success path: deliver the proof, then hand the user back to wherever
      // they came from. Never a no-op — when the request carried no
      // returnScheme the app backgrounds itself on Android so the browser
      // resumes, and on iOS raises the "proof delivered, switch back" notice.
      return sendProofResponseAndReturn(response, request);
    },
    [],
  );

  // NOTE: sendError deliberately does NOT switch back. The failure is shown
  // here as an ErrorModal / inline error and is usually actionable inside this
  // app (retry, connect a wallet, no attestation found). Backgrounding the app
  // the instant the error appears would hide the only explanation the user
  // gets, and would drop them into the requesting app with no idea what broke.
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
