import type {ProofRequest} from '../utils/deeplink';

export type RootStackParamList = {
  Main: undefined;
  CoinbaseKyc: {proofRequest?: ProofRequest} | undefined;
  PrivyWallet: undefined;
};

// Re-export deep link types for convenience
export type {
  ProofRequest,
  ProofResponse,
  CircuitType,
  VerificationType,
  CoinbaseKycInputs as DeepLinkCoinbaseKycInputs,
} from '../utils/deeplink';

export interface ProofState {
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
}

export type ProofStatus =
  | 'Ready'
  | 'Generating verification key...'
  | 'Loading verification key...'
  | 'Verification key ready'
  | 'Generating proof...'
  | 'Generating TEST proof...'
  | 'Proof ready'
  | 'TEST Proof ready'
  | 'Verifying proof...'
  | 'Verifying proof (off-chain)...'
  | 'Verifying proof on-chain...'
  | 'Proof verified!'
  | 'Proof verified (off-chain)!'
  | 'Proof verified on-chain!'
  | 'Proof invalid'
  | 'Proof invalid (on-chain)'
  | 'Error generating VK'
  | 'Error loading VK'
  | 'Error generating proof'
  | 'Error generating test proof'
  | 'Error verifying proof'
  | 'Error: on-chain verification failed'
  | 'Invalid input';
