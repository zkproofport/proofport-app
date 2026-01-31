import {useState, useCallback} from 'react';
import {ethers} from 'ethers';
import {
  generateNoirProof,
  verifyNoirProof,
  getNumPublicInputsFromCircuit,
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
import {getAssetPath, arrayBufferToHex, validateInputs, loadVkFromAssets} from '../utils';
import type {ProofStatus, AgeVerifierInputs} from '../types';
import type {Step} from '../components';
import {getVerifierAddress, getVerifierAbi, getNetworkConfig} from '../config';

// Circuit name for assets
const CIRCUIT_NAME = 'age_verifier';

export interface ParsedProofData {
  proofHex: string;
  publicInputsHex: string[];
  numPublicInputs: number;
}

export interface UseAgeVerifierReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: AgeVerifierInputs,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<void>;
  verifyProofOnChain: (addLog: (msg: string) => void) => Promise<boolean>;
  resetSteps: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'inputs', label: 'Prepare proof inputs', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
];

/**
 * Custom hook for managing ZK proof generation and verification
 */
export const useAgeVerifier = (): UseAgeVerifierReturn => {
  const [status, setStatus] = useState<ProofStatus>('Ready');
  const [isLoading, setIsLoading] = useState(false);
  const [vk, setVk] = useState<ArrayBuffer | null>(null);
  const [proof, setProof] = useState<ArrayBuffer | null>(null);
  const [parsedProof, setParsedProof] = useState<ParsedProofData | null>(null);
  const [proofSteps, setProofSteps] = useState<Step[]>(INITIAL_PROOF_STEPS);

  const updateStep = useCallback((stepId: string, updates: Partial<Step>) => {
    setProofSteps(prev =>
      prev.map(step => (step.id === stepId ? {...step, ...updates} : step)),
    );
  }, []);

  const resetSteps = useCallback(() => {
    setProofSteps(INITIAL_PROOF_STEPS);
    setParsedProof(null);
  }, []);

  /**
   * Generate proof with step-by-step progress tracking
   */
  const generateProofWithSteps = useCallback(
    async (inputs: AgeVerifierInputs, addLog: (msg: string) => void) => {
      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog('=== Starting Proof Generation ===');

      let currentVk: ArrayBuffer | null = null;
      let currentProof: ArrayBuffer | null = null;

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

        // Step 2: Prepare inputs
        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 2: Preparing proof inputs...');

        const validation = validateInputs(
          inputs.birthYear,
          inputs.currentYear,
          inputs.minAge,
        );

        if (!validation.isValid) {
          throw new Error(validation.error);
        }

        const inputArray = [inputs.birthYear, inputs.currentYear, inputs.minAge];
        updateStep('inputs', {
          status: 'completed',
          detail: `birth=${inputs.birthYear}, year=${inputs.currentYear}, min=${inputs.minAge}`,
        });
        addLog(`Inputs: birth_year=${inputs.birthYear}, current_year=${inputs.currentYear}, min_age=${inputs.minAge}`);

        // Step 3: Generate proof
        updateStep('proof', {status: 'in_progress'});
        addLog('Step 3: Generating ZK proof...');

        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);

        const proofStartTime = Date.now();
        currentProof = generateNoirProof(
          circuitPath,
          srsPath,
          inputArray,
          true, // onChain: true = Keccak hash (for Solidity verification)
          currentVk,
          true, // lowMemoryMode
        );
        const proofElapsed = Date.now() - proofStartTime;

        setProof(currentProof);
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });
        addLog(`Proof generated: ${currentProof!.byteLength} bytes (${proofElapsed}ms)`);

        // Step 4: Parse proof
        updateStep('parse', {status: 'in_progress'});
        addLog('Step 4: Parsing proof...');

        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        const parsed: ProofWithPublicInputs = parseProofWithPublicInputs(
          currentProof,
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

        updateStep('parse', {
          status: 'completed',
          detail: `proof.hex: ${proofHex.substring(0, 16)}... | ${numPublicInputs} public inputs`,
        });

        addLog(`Parsed proof size: ${parsed.proof.byteLength} bytes`);
        addLog(`Number of public inputs: ${numPublicInputs}`);
        publicInputsHex.forEach((pi, i) => {
          addLog(`  [${i}]: ${pi}`);
        });

        setStatus('Proof ready');
        addLog('=== Proof Generation Complete ===');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error generating proof');

        // Mark current step as error
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
      if (!vk || !proof) {
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
          proof,
          true, // onChain: true = Keccak hash
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
    [vk, proof],
  );

  /**
   * Verify proof on-chain using the deployed Verifier contract
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

      const verifierAddress = await getVerifierAddress('age_verifier');
      const network = getNetworkConfig();

      addLog(`Verifier contract: ${verifierAddress}`);
      addLog(`Chain: ${network.name} (${network.chainId})`);

      try {
        // Create provider
        const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
        addLog(`Connected to ${network.name} RPC`);

        // Create contract instance
        const verifierContract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          provider,
        );

        addLog(`Proof hex (first 40 chars): ${parsedProof.proofHex.substring(0, 42)}...`);
        addLog('Public inputs (bytes32[]):');
        parsedProof.publicInputsHex.forEach((pi, i) => {
          addLog(`  [${i}]: ${pi}`);
        });

        // Call verify function (view function, no gas needed)
        addLog('Calling verifier contract...');
        const startTime = Date.now();

        const isValid = await verifierContract.verify(
          parsedProof.proofHex,
          parsedProof.publicInputsHex,
        );

        const elapsed = Date.now() - startTime;
        addLog(`On-chain verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);

        // Log transaction info (for view function, we can show the call info)
        addLog('--- Transaction Info ---');
        addLog(`Contract: ${verifierAddress}`);
        addLog(`Method: verify(bytes, bytes32[])`);
        addLog(`Note: This is a view function call (no gas spent)`);

        if (isValid) {
          addLog(`Proof verified on ${network.name} blockchain!`);
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
    parsedProof,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    resetSteps,
  };
};
