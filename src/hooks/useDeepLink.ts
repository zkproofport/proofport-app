// Main deep link handling is in App.tsx; this hook provides response utilities.
// Every answer goes through src/utils/relayAnswer.ts, which sends at most one
// per requestId.
import {useCallback} from 'react';
import {
  sendProofResponseAndReturn,
  type ProofRequest,
  type ProofResponse,
  type VerificationType,
} from '../utils/deeplink';
import {answerRelayRequest, type CompletedFields, type RelayAnswerOutcome} from '../utils/relayAnswer';
import type {ErrorCode} from '../constants/errorCodes';
import type {DeviceCheckReason} from '../appAttest/deviceCheckReasons';

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
  /** Required: which package of the circuit made the proof (src/config/signerPlatform.ts WIRE_SIGNER_VARIANT). */
  signerVariant: 'standard' | 'android' | 'android_factory';
}

interface UseDeepLinkUtilsResult {
  sendProof: (
    request: ProofRequest,
    options: SendProofOptions,
  ) => Promise<boolean>;
  sendError: (request: ProofRequest, errorCode: ErrorCode, error: string, deviceCheckReason?: DeviceCheckReason) => Promise<RelayAnswerOutcome>;
  sendCancelled: (request: ProofRequest, reason: string) => Promise<RelayAnswerOutcome>;
}

export function useDeepLink(): UseDeepLinkUtilsResult {
  const sendProof = useCallback(
    async (
      request: ProofRequest,
      options: SendProofOptions,
    ): Promise<boolean> => {
      const fields: CompletedFields = {
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
        signerVariant: options.signerVariant,
        inputs: request.inputs,
      };
      const response: ProofResponse = {
        ...fields,
        requestId: request.requestId,
        circuit: request.circuit,
        status: 'completed',
      };

      // Success path: deliver the proof through the once-only responder, then
      // hand the user back to wherever they came from. Never a no-op — when
      // the request carried no returnScheme the app backgrounds itself on
      // Android so the browser resumes, and on iOS raises the "proof
      // delivered, switch back" notice.
      return sendProofResponseAndReturn(response, request, async () => {
        const outcome = await answerRelayRequest(request, {status: 'completed', fields});
        if (outcome === 'duplicate') return 'not-answer';
        return outcome === 'delivered';
      });
    },
    [],
  );

  // NOTE: sendError deliberately does NOT switch back. The failure is shown
  // here as an ErrorModal / inline error and is usually actionable inside this
  // app (connect a wallet, no attestation found). Backgrounding the app the
  // instant the error appears would hide the only explanation the user gets,
  // and would drop them into the requesting app with no idea what broke.
  const sendError = useCallback(
    (request: ProofRequest, errorCode: ErrorCode, error: string, deviceCheckReason?: DeviceCheckReason) =>
      answerRelayRequest(request, {status: 'error', errorCode, error, ...(deviceCheckReason !== undefined && {deviceCheckReason})}),
    [],
  );

  const sendCancelled = useCallback(
    (request: ProofRequest, reason: string) =>
      answerRelayRequest(request, {status: 'cancelled', reason}),
    [],
  );

  return {
    sendProof,
    sendError,
    sendCancelled,
  };
}
