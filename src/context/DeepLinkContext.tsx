/**
 * Deep Link Context for sharing proof request state across the app
 */

import React, {createContext, useContext, useState, useCallback} from 'react';
import type {ProofRequest} from '../utils/deeplink';

interface DeepLinkContextValue {
  /** Current pending proof request */
  pendingRequest: ProofRequest | null;
  /** Set the pending request */
  setPendingRequest: (request: ProofRequest | null) => void;
  /** Callback URL for the current request */
  callbackUrl: string | null;
  /** Complete the request and prepare to send response */
  completeRequest: (
    proof: string,
    publicInputs: string[],
    numPublicInputs: number,
  ) => void;
  /** Clear the pending request */
  clearRequest: () => void;
  /** Completed proof data ready to be sent */
  completedProof: {
    proof: string;
    publicInputs: string[];
    numPublicInputs: number;
  } | null;
}

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);

export const DeepLinkProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [pendingRequest, setPendingRequest] = useState<ProofRequest | null>(null);
  const [completedProof, setCompletedProof] = useState<{
    proof: string;
    publicInputs: string[];
    numPublicInputs: number;
  } | null>(null);

  const completeRequest = useCallback(
    (proof: string, publicInputs: string[], numPublicInputs: number) => {
      setCompletedProof({proof, publicInputs, numPublicInputs});
    },
    [],
  );

  const clearRequest = useCallback(() => {
    setPendingRequest(null);
    setCompletedProof(null);
  }, []);

  return (
    <DeepLinkContext.Provider
      value={{
        pendingRequest,
        setPendingRequest,
        callbackUrl: pendingRequest?.callbackUrl || null,
        completeRequest,
        clearRequest,
        completedProof,
      }}>
      {children}
    </DeepLinkContext.Provider>
  );
};

export const useDeepLinkContext = () => {
  const context = useContext(DeepLinkContext);
  if (!context) {
    throw new Error('useDeepLinkContext must be used within DeepLinkProvider');
  }
  return context;
};

export default DeepLinkContext;
