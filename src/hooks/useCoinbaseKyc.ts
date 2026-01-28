import {useState, useCallback, useRef} from 'react';
import {ethers} from 'ethers';
import {
  generateNoirProof,
  verifyNoirProof,
  getNumPublicInputsFromCircuit,
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
import {
  getAssetPath,
  arrayBufferToHex,
  prepareCircuitInputs,
  flattenCircuitInputs,
  verifyAttestationTx,
  recoverPublicKey,
  AUTHORIZED_SIGNERS,
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
} from '../utils';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

// Circuit file names
const CIRCUIT_NAME = 'coinbase_attestation';

// On-chain Verifier contract on Sepolia Testnet
const VERIFIER_CONTRACT_ADDRESS = '0x121632902482B658e0F2D055126dBe977deb9FC1';

// Minimal ABI for HonkVerifier contract (Noir generated)
const VERIFIER_ABI = [
  'function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)',
];

// Sepolia RPC for read-only calls (using Infura for reliability)
const SEPOLIA_RPC_URL = 'https://sepolia.infura.io/v3/2fe2d28467784ababcae918bb18b4bf6';

export interface CoinbaseKycInputs {
  userAddress: string;
  rawTransaction: string;
  signerIndex: number;
}

export interface EthereumProvider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  getSelectedAddress?: () => Promise<string | undefined>;
  getChainId?: () => Promise<string | undefined>;
}

export interface ParsedProofData {
  proofHex: string;
  publicInputsHex: string[];
  numPublicInputs: number;
}

export interface UseCoinbaseKycReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  signalHash: Uint8Array | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: CoinbaseKycInputs,
    ethereum: EthereumProvider | null,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<void>;
  verifyProofOnChain: (addLog: (msg: string) => void) => Promise<boolean>;
  validateTransaction: (
    rawTx: string,
    userAddress: string,
    addLog: (msg: string) => void,
  ) => boolean;
  resetSteps: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'validate', label: 'Validate attestation transaction', status: 'pending'},
  {id: 'signal', label: 'Generate signal hash', status: 'pending'},
  {id: 'sign', label: 'Sign with wallet', status: 'pending'},
  {id: 'pubkey', label: 'Recover public key', status: 'pending'},
  {id: 'inputs', label: 'Prepare circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

/**
 * Custom hook for managing Coinbase KYC ZK proof generation and verification
 */
export const useCoinbaseKyc = (): UseCoinbaseKycReturn => {
  const [status, setStatus] = useState<ProofStatus>('Ready');
  const [isLoading, setIsLoading] = useState(false);
  const [vk, setVk] = useState<ArrayBuffer | null>(null);
  const [proof, setProof] = useState<ArrayBuffer | null>(null);
  const [fullProof, setFullProof] = useState<ArrayBuffer | null>(null);
  const [parsedProof, setParsedProof] = useState<ParsedProofData | null>(null);
  const [signalHash, setSignalHash] = useState<Uint8Array | null>(null);
  const [proofSteps, setProofSteps] = useState<Step[]>(INITIAL_PROOF_STEPS);

  const isSigningRef = useRef(false);

  const updateStep = useCallback((stepId: string, updates: Partial<Step>) => {
    setProofSteps(prev =>
      prev.map(step => (step.id === stepId ? {...step, ...updates} : step)),
    );
  }, []);

  const resetSteps = useCallback(() => {
    setProofSteps(INITIAL_PROOF_STEPS);
    setParsedProof(null);
  }, []);

  const validateTransaction = useCallback(
    (rawTx: string, userAddress: string, addLog: (msg: string) => void): boolean => {
      addLog('Validating attestation transaction...');

      const result = verifyAttestationTx(rawTx, userAddress);

      if (!result.valid) {
        addLog(`Validation failed: ${result.error}`);
        return false;
      }

      addLog(`Transaction is valid!`);
      addLog(`Coinbase signer: ${result.signerAddress}`);

      const signerIndex = AUTHORIZED_SIGNERS.findIndex(
        addr => addr.toLowerCase() === result.signerAddress?.toLowerCase(),
      );
      addLog(`Signer index in authorized list: ${signerIndex}`);

      return true;
    },
    [],
  );

  /**
   * Generate proof with step-by-step progress tracking
   */
  const generateProofWithSteps = useCallback(
    async (
      inputs: CoinbaseKycInputs,
      ethereum: EthereumProvider | null,
      addLog: (msg: string) => void,
    ) => {
      if (!inputs.userAddress) {
        addLog('Please connect wallet first');
        return;
      }

      if (!inputs.rawTransaction) {
        addLog('Please provide attestation transaction');
        return;
      }

      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog('=== Starting Proof Generation ===');

      let currentVk: ArrayBuffer | null = null;
      let currentProof: ArrayBuffer | null = null;
      let currentSignalHash: Uint8Array | null = null;
      let userSignature: string | undefined;
      let userPubkey: string | undefined;
      let signerIndex = 0;

      try {
        // Step 1: Load VK
        updateStep('vk', {status: 'in_progress'});
        addLog('Step 1: Loading verification key...');

        const vkStartTime = Date.now();
        currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        const vkElapsed = Date.now() - vkStartTime;

        setVk(currentVk);
        updateStep('vk', {
          status: 'completed',
          detail: `${currentVk.byteLength} bytes (${vkElapsed}ms)`,
        });
        addLog(`VK loaded: ${currentVk.byteLength} bytes (${vkElapsed}ms)`);

        // Step 2: Validate transaction
        updateStep('validate', {status: 'in_progress'});
        addLog('Step 2: Validating attestation transaction...');

        const validation = verifyAttestationTx(inputs.rawTransaction, inputs.userAddress);
        if (!validation.valid) {
          throw new Error(validation.error || 'Invalid transaction');
        }

        signerIndex = AUTHORIZED_SIGNERS.findIndex(
          addr => addr.toLowerCase() === validation.signerAddress?.toLowerCase(),
        );
        if (signerIndex === -1) {
          throw new Error('Signer not found in authorized list');
        }

        updateStep('validate', {
          status: 'completed',
          detail: `Signer: ${validation.signerAddress?.slice(0, 10)}... (index: ${signerIndex})`,
        });
        addLog(`Coinbase signer verified: ${validation.signerAddress}`);

        // Step 3: Generate signal hash
        updateStep('signal', {status: 'in_progress'});
        addLog('Step 3: Generating signal hash...');

        currentSignalHash = ethers.utils.randomBytes(32);
        setSignalHash(currentSignalHash);
        const signalHashHex = Buffer.from(currentSignalHash).toString('hex');

        updateStep('signal', {
          status: 'completed',
          detail: `0x${signalHashHex.slice(0, 16)}...`,
        });
        addLog(`Signal hash: 0x${signalHashHex.slice(0, 16)}...`);

        // Step 4: Sign with wallet
        updateStep('sign', {status: 'in_progress'});
        addLog('Step 4: Requesting signature from wallet...');

        if (!ethereum) {
          throw new Error('Wallet provider not available');
        }

        const messageHex = ethers.utils.hexlify(currentSignalHash);
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;

        if (isSigningRef.current) {
          throw new Error('Signing already in progress');
        }

        try {
          isSigningRef.current = true;
          const result = await ethereum.request({
            method: 'personal_sign',
            params: [messageHex, from],
          });

          userSignature = result as string;
          if (!userSignature) {
            throw new Error('Empty signature returned');
          }
        } catch (signError) {
          const signErrorMsg = signError instanceof Error ? signError.message : String(signError);
          const errorCode = (signError as {code?: number})?.code;

          if (errorCode === -32002 || signErrorMsg.includes('already pending')) {
            throw new Error('Signing request already pending. Please try again.');
          }
          throw new Error(`Signature failed: ${signErrorMsg}`);
        } finally {
          isSigningRef.current = false;
        }

        updateStep('sign', {
          status: 'completed',
          detail: `${userSignature.slice(0, 20)}...`,
        });
        addLog(`Signature received: ${userSignature.slice(0, 20)}...`);

        // Step 5: Recover public key
        updateStep('pubkey', {status: 'in_progress'});
        addLog('Step 5: Recovering public key from signature...');

        userPubkey = recoverPublicKey(messageHex, userSignature);

        updateStep('pubkey', {
          status: 'completed',
          detail: `${userPubkey.slice(0, 20)}...`,
        });
        addLog(`Public key recovered: ${userPubkey.slice(0, 20)}...`);

        // Step 6: Prepare circuit inputs
        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 6: Preparing circuit inputs...');

        const circuitInputs = prepareCircuitInputs(
          currentSignalHash,
          inputs.userAddress,
          userSignature,
          userPubkey,
          inputs.rawTransaction,
          signerIndex,
        );
        const flatInputs = flattenCircuitInputs(circuitInputs);

        updateStep('inputs', {
          status: 'completed',
          detail: `${flatInputs.length} input values`,
        });
        addLog(`Total circuit inputs: ${flatInputs.length}`);

        // Step 7: Check storage
        updateStep('storage', {status: 'in_progress'});
        addLog('Step 7: Checking storage availability...');

        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }

        updateStep('storage', {
          status: 'completed',
          detail: 'Sufficient storage available',
        });

        // Step 8: Generate proof
        updateStep('proof', {status: 'in_progress'});
        addLog('Step 8: Generating ZK proof...');

        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);

        const proofStartTime = Date.now();
        currentProof = generateNoirProof(
          circuitPath,
          srsPath,
          flatInputs,
          true, // onChain
          currentVk,
          true, // lowMemoryMode
        );
        const proofElapsed = Date.now() - proofStartTime;

        setFullProof(currentProof);
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });
        addLog(`Proof generated: ${currentProof!.byteLength} bytes (${proofElapsed}ms)`);

        // Step 9: Parse proof
        updateStep('parse', {status: 'in_progress'});
        addLog('Step 9: Parsing proof...');

        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        const parsed: ProofWithPublicInputs = parseProofWithPublicInputs(
          currentProof!,
          numPublicInputs,
        );

        const proofHex = arrayBufferToHex(parsed.proof);
        const publicInputsHex: string[] = parsed.publicInputs.map(
          (pi: ArrayBuffer) => '0x' + arrayBufferToHex(pi),
        );

        const parsedData: ParsedProofData = {
          proofHex: '0x' + proofHex,
          publicInputsHex,
          numPublicInputs,
        };
        setParsedProof(parsedData);
        setProof(parsed.proof);

        updateStep('parse', {
          status: 'completed',
          detail: `proof.hex: ${proofHex.substring(0, 16)}... | ${numPublicInputs} public inputs`,
        });

        addLog(`Parsed proof size: ${parsed.proof.byteLength} bytes`);
        addLog(`Number of public inputs: ${numPublicInputs}`);

        // Step 10: Cleanup
        updateStep('cleanup', {status: 'in_progress'});
        addLog('Step 10: Cleaning up cache...');

        await clearProofCache(addLog);

        updateStep('cleanup', {
          status: 'completed',
          detail: 'Cache cleared',
        });

        setStatus('Proof ready');
        addLog('=== Proof Generation Complete ===');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error generating proof');

        setProofSteps(prev =>
          prev.map(step =>
            step.status === 'in_progress' ? {...step, status: 'error', detail: errorMessage} : step,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [updateStep, resetSteps],
  );

  /**
   * Verify proof off-chain using mopro
   */
  const verifyProofOffChain = useCallback(
    async (addLog: (msg: string) => void) => {
      if (!vk || !fullProof) {
        addLog('Please generate proof first');
        return;
      }

      setIsLoading(true);
      setStatus('Verifying proof...');
      addLog('=== Starting Off-Chain Verification ===');

      try {
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);

        const startTime = Date.now();
        const isValid = verifyNoirProof(
          circuitPath,
          fullProof,
          true, // onChain format (Keccak hash)
          vk,
          true, // lowMemoryMode
        );
        const elapsed = Date.now() - startTime;

        addLog(`Verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
        setStatus(isValid ? 'Proof verified!' : 'Proof invalid');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error verifying proof');
      } finally {
        setIsLoading(false);
      }
    },
    [vk, fullProof],
  );

  /**
   * Verify proof on-chain using the deployed Verifier contract on Sepolia
   */
  const verifyProofOnChain = useCallback(
    async (addLog: (msg: string) => void): Promise<boolean> => {
      if (!parsedProof) {
        addLog('Please generate proof first');
        return false;
      }

      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      addLog('=== Starting On-Chain Verification ===');
      addLog(`Verifier contract: ${VERIFIER_CONTRACT_ADDRESS}`);
      addLog(`Chain: Sepolia Testnet (11155111)`);

      try {
        const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC_URL);
        addLog('Connected to Sepolia RPC');

        const verifierContract = new ethers.Contract(
          VERIFIER_CONTRACT_ADDRESS,
          VERIFIER_ABI,
          provider,
        );

        addLog(`Proof hex (first 40 chars): ${parsedProof.proofHex.substring(0, 42)}...`);
        addLog(`Public inputs count: ${parsedProof.numPublicInputs}`);

        addLog('Calling verifier contract...');
        const startTime = Date.now();

        const isValid = await verifierContract.verify(
          parsedProof.proofHex,
          parsedProof.publicInputsHex,
        );

        const elapsed = Date.now() - startTime;
        addLog(`On-chain verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);

        // Log transaction info
        addLog('--- Transaction Info ---');
        addLog(`Contract: ${VERIFIER_CONTRACT_ADDRESS}`);
        addLog(`Method: verify(bytes, bytes32[])`);
        addLog(`Note: This is a view function call (no gas spent)`);

        if (isValid) {
          addLog('Proof verified on Sepolia blockchain!');
          setStatus('Proof verified on-chain!');
        } else {
          addLog('Proof rejected by on-chain verifier');
          setStatus('Proof invalid (on-chain)');
        }

        return isValid;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`On-chain verification error: ${errorMessage}`);

        if (errorMessage.includes('call revert')) {
          addLog('Contract call reverted - proof may be invalid or wrong format');
        } else if (errorMessage.includes('network')) {
          addLog('Network error - check internet connection');
        }

        setStatus('Error: on-chain verification failed');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [parsedProof],
  );

  return {
    status,
    isLoading,
    vk,
    proof,
    fullProof,
    parsedProof,
    signalHash,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    validateTransaction,
    resetSteps,
  };
};
