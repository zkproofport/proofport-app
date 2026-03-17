import {useState, useCallback} from 'react';
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
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
  downloadCircuitFiles,
  allCircuitFilesExist,
} from '../utils';
import {getEnvironment, getVerifierAddress, getVerifierAbi, getNetworkConfig} from '../config';
import {ethers} from 'ethers';
import {prepareOidcInputs, flattenOidcInputs} from '../utils/oidcDomain';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

/**
 * OIDC Domain Attestation circuit name.
 * Used as the circuit file identifier and in proof history.
 * DO NOT modify without coordinating with the contract and relay teams.
 */
const CIRCUIT_NAME = 'oidc_domain_attestation';

// Module-level proof cache — persists across hook instances (screen navigations)
let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface OidcDomainProofInputs {
  jwtToken: string; // OIDC JWT id_token from provider (e.g., Google)
  scopeString: string; // dApp scope identifier (REQUIRED)
  domain: string; // Target domain to prove (e.g., 'google.com') — REQUIRED
}

export interface ParsedProofData {
  proofHex: string;
  publicInputsHex: string[];
  numPublicInputs: number;
}

export interface UseOidcDomainReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: OidcDomainProofInputs,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<boolean>;
  verifyProofOnChain: (addLog: (msg: string) => void) => Promise<boolean>;
  resetSteps: () => void;
  resetProofCache: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'download', label: 'Download circuit files', status: 'pending'},
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'validate', label: 'Validate JWT token', status: 'pending'},
  {id: 'jwks', label: 'Fetch OIDC provider public key', status: 'pending'},
  {id: 'inputs', label: 'Prepare circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

/**
 * Custom hook for OIDC Domain attestation ZK proof generation.
 *
 * Follows the same on-device proof pattern as useCoinbaseKyc:
 * - JWT parsing and circuit input preparation happens locally
 * - Proof generation via mopro (Rust ZK library) on device
 * - No AI server calls — only JWKS fetch for RSA public key
 */
export const useOidcDomain = (): UseOidcDomainReturn => {
  const [status, setStatus] = useState<ProofStatus>('Ready');
  const [isLoading, setIsLoading] = useState(false);
  const [vk, setVk] = useState<ArrayBuffer | null>(null);
  const [fullProof, setFullProof] = useState<ArrayBuffer | null>(null);
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

  const resetProofCache = useCallback(() => {
    _cachedVk = null;
    _cachedFullProof = null;
    _cachedParsedProof = null;
    setVk(null);
    setFullProof(null);
    setParsedProof(null);
  }, []);

  /**
   * Generate proof with step-by-step progress tracking.
   *
   * Flow:
   * 1. Load VK from downloaded circuit files
   * 2. Validate JWT structure
   * 3. Fetch JWKS from OIDC provider (only network call)
   * 4. Prepare circuit inputs locally (RSA limbs, partial SHA-256, keccak256)
   * 5. Check storage
   * 6. Generate ZK proof via mopro on-device
   * 7. Parse proof
   * 8. Cleanup
   */
  const generateProofWithSteps = useCallback(
    async (
      inputs: OidcDomainProofInputs,
      addLog: (msg: string) => void,
    ) => {
      if (!inputs.jwtToken) {
        addLog('JWT token is required');
        return;
      }

      if (!inputs.scopeString) {
        addLog('Scope is required');
        return;
      }

      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog('=== Starting OIDC Domain Proof Generation ===');
      addLog(`[OIDC] Circuit: ${CIRCUIT_NAME}`);

      let currentVk: ArrayBuffer | null = null;
      let currentProof: ArrayBuffer | null = null;

      try {
        // Step 1: Download circuit files if needed
        updateStep('download', {status: 'in_progress'});
        const filesExist = await allCircuitFilesExist(CIRCUIT_NAME);
        if (!filesExist) {
          addLog('Step 1: Downloading circuit files...');
          const env = getEnvironment();
          await downloadCircuitFiles(CIRCUIT_NAME, env, undefined, addLog);
          addLog('[Download] Circuit files downloaded');
        } else {
          addLog('Step 1: Circuit files already cached');
        }
        updateStep('download', {status: 'completed', detail: filesExist ? 'Cached' : 'Downloaded'});

        // Step 2: Load VK
        updateStep('vk', {status: 'in_progress'});
        addLog('Step 2: Loading verification key...');

        const vkStartTime = Date.now();
        currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        const vkElapsed = Date.now() - vkStartTime;

        addLog(`[VK] VK loaded: ${currentVk.byteLength} bytes (${vkElapsed}ms)`);
        setVk(currentVk);
        _cachedVk = currentVk;
        updateStep('vk', {
          status: 'completed',
          detail: `${currentVk.byteLength} bytes (${vkElapsed}ms)`,
        });

        // Step 2: Validate JWT structure
        updateStep('validate', {status: 'in_progress'});
        addLog('Step 2: Validating JWT token...');

        const parts = inputs.jwtToken.split('.');
        if (parts.length !== 3) {
          throw new Error('Invalid JWT format: expected three dot-separated parts');
        }

        addLog('[JWT] Token structure validated (header.payload.signature)');
        if (inputs.domain) {
          addLog(`[JWT] Target domain: ${inputs.domain}`);
        }
        updateStep('validate', {status: 'completed', detail: 'JWT format valid'});

        // Step 3: Fetch JWKS and prepare circuit inputs
        // prepareOidcInputs handles: JWKS fetch, RSA limb decomposition,
        // partial SHA-256, domain extraction, scope/nullifier computation
        updateStep('jwks', {status: 'in_progress'});
        addLog('Step 3: Fetching OIDC provider public key via JWKS...');

        const inputsStartTime = Date.now();
        const circuitInputs = await prepareOidcInputs({
          jwt: inputs.jwtToken,
          scope: inputs.scopeString,
          domain: inputs.domain,
        });
        const inputsElapsed = Date.now() - inputsStartTime;

        addLog(`[JWKS] Public key fetched and RSA limbs computed (${inputsElapsed}ms)`);
        updateStep('jwks', {
          status: 'completed',
          detail: `RSA key fetched (${inputsElapsed}ms)`,
        });

        // Step 4: Flatten inputs for mopro
        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 4: Preparing circuit inputs...');

        const flatInputs = flattenOidcInputs(circuitInputs);
        addLog(`[Inputs] Domain: ${inputs.domain || '(auto-extracted)'}`);
        addLog(`[Inputs] Scope: ${inputs.scopeString}`);
        addLog(`[Inputs] Partial data length: ${circuitInputs.partial_data.len}`);
        addLog(`[Inputs] Full data length: ${circuitInputs.full_data_length}`);
        addLog(`[Inputs] Flattened to ${flatInputs.length} input values`);
        addLog(`[Inputs] First 5: ${flatInputs.slice(0, 5).join(', ')}`);
        addLog(`[Inputs] Last 5: ${flatInputs.slice(-5).join(', ')}`);
        // Debug: log structured inputs for comparison with AI SDK
        addLog(`[Debug] pubkey_modulus_limbs[0]: ${circuitInputs.pubkey_modulus_limbs[0]}`);
        addLog(`[Debug] domain.len: ${circuitInputs.domain.len}, storage[0..3]: ${circuitInputs.domain.storage.slice(0, 3)}`);
        addLog(`[Debug] scope[0..4]: ${circuitInputs.scope.slice(0, 4)}`);
        addLog(`[Debug] nullifier[0..4]: ${circuitInputs.nullifier.slice(0, 4)}`);
        addLog(`[Debug] partial_hash[0..2]: ${circuitInputs.partial_hash.slice(0, 2)}`);
        addLog(`[Debug] partial_data.len: ${circuitInputs.partial_data.len}`);
        addLog(`[Debug] full_data_length: ${circuitInputs.full_data_length}`);
        addLog(`[Debug] base64_decode_offset: ${circuitInputs.base64_decode_offset}`);
        updateStep('inputs', {
          status: 'completed',
          detail: `${flatInputs.length} input values`,
        });

        // Step 5: Check storage
        updateStep('storage', {status: 'in_progress'});
        addLog('Step 5: Checking storage availability...');

        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }

        updateStep('storage', {
          status: 'completed',
          detail: 'Sufficient storage available',
        });

        // Step 6: Generate proof
        updateStep('proof', {status: 'in_progress'});
        addLog('Step 6: Generating ZK proof...');
        addLog(`[Proof] Loading circuit file: ${CIRCUIT_NAME}.json`);
        addLog(`[Proof] Loading SRS file: ${CIRCUIT_NAME}.srs`);

        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);

        addLog('[Proof] Starting Noir proof generation (low memory mode)...');
        addLog('[Proof] This may take 30-60 seconds...');
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

        addLog(`[Proof] Proof generated! Size: ${currentProof.byteLength} bytes`);
        addLog(`[Proof] Generation time: ${proofElapsed}ms`);
        setFullProof(currentProof);
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof.byteLength} bytes (${proofElapsed}ms)`,
        });

        // Step 7: Parse proof
        updateStep('parse', {status: 'in_progress'});
        addLog('Step 7: Parsing proof...');

        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        addLog(`[Parse] Number of public inputs: ${numPublicInputs}`);
        const parsed: ProofWithPublicInputs = parseProofWithPublicInputs(
          currentProof,
          numPublicInputs,
        );

        const proofHex = arrayBufferToHex(parsed.proof);
        const publicInputsHex: string[] = parsed.publicInputs.map(
          (pi: ArrayBuffer) => '0x' + arrayBufferToHex(pi),
        );

        publicInputsHex.slice(0, 3).forEach((pi, i) => {
          addLog(`[Parse] Public input #${i}: ${pi.slice(0, 20)}...`);
        });

        const parsedData: ParsedProofData = {
          proofHex: '0x' + proofHex,
          publicInputsHex,
          numPublicInputs,
        };
        setParsedProof(parsedData);
        _cachedParsedProof = parsedData;

        updateStep('parse', {
          status: 'completed',
          detail: `${numPublicInputs} public inputs`,
        });

        // Step 8: Cleanup
        updateStep('cleanup', {status: 'in_progress'});
        addLog('Step 8: Cleaning up cache...');

        await clearProofCache(addLog);

        updateStep('cleanup', {
          status: 'completed',
          detail: 'Cache cleared',
        });

        setStatus('Proof ready');
        addLog('=== OIDC Domain Proof Generation Complete ===');
      } catch (error) {
        // Extract detailed error from MoproError.NoirError
        let errorMessage = error instanceof Error ? error.message : String(error);
        const moproErr = error as {tag?: string; inner?: string[]};
        if (moproErr.tag && moproErr.inner) {
          errorMessage = `${moproErr.tag}: ${moproErr.inner.join(', ')}`;
        }
        addLog(`Error: ${errorMessage}`);
        addLog(`[Debug] Error type: ${(error as any)?.constructor?.name || typeof error}`);
        addLog(`[Debug] Full error: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2)}`);
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
    async (addLog: (msg: string) => void): Promise<boolean> => {
      const useVk = vk || _cachedVk;
      const useFullProof = fullProof || _cachedFullProof;

      if (!useVk || !useFullProof) {
        addLog('Please generate proof first');
        return false;
      }

      setIsLoading(true);
      setStatus('Verifying proof...');
      addLog('=== Starting Off-Chain Verification ===');

      try {
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);

        addLog('[OffChain] Calling mopro verifyNoirProof...');
        const startTime = Date.now();
        const isValid = verifyNoirProof(
          circuitPath,
          useFullProof,
          true, // onChain format (Keccak hash)
          useVk,
          true, // lowMemoryMode
        );
        const elapsed = Date.now() - startTime;

        addLog(`[OffChain] Result: ${isValid ? 'VALID' : 'INVALID'} (${elapsed}ms)`);
        setStatus(isValid ? 'Proof verified!' : 'Proof invalid');
        return isValid;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error verifying proof');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vk, fullProof],
  );

  /**
   * Verify proof on-chain using the deployed Verifier contract
   */
  const verifyProofOnChain = useCallback(
    async (addLog: (msg: string) => void): Promise<boolean> => {
      const useParsedProof = parsedProof || _cachedParsedProof;

      if (!useParsedProof) {
        addLog('Please generate proof first');
        return false;
      }

      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      addLog('=== Starting On-Chain Verification ===');

      try {
        const verifierAddress = await getVerifierAddress('oidc_domain_attestation');

        if (!verifierAddress) {
          addLog('[OnChain] ERROR: Verifier address is empty');
          setStatus('Verification unavailable');
          return false;
        }

        const network = getNetworkConfig();
        addLog(`[OnChain] Contract: ${verifierAddress}`);
        addLog(`[OnChain] Chain: ${network.name} (${network.chainId})`);

        const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
        const verifierContract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          provider,
        );

        addLog('[OnChain] Calling verify(bytes, bytes32[])...');
        const startTime = Date.now();

        const isValid = await verifierContract.verify(
          useParsedProof.proofHex,
          useParsedProof.publicInputsHex,
        );

        const elapsed = Date.now() - startTime;
        addLog(`[OnChain] Result: ${isValid ? 'VALID' : 'INVALID'} (${elapsed}ms)`);
        setStatus(isValid ? 'Proof verified on-chain!' : 'Proof invalid (on-chain)');
        return isValid;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
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
    fullProof,
    parsedProof: parsedProof || _cachedParsedProof,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    resetSteps,
    resetProofCache,
  };
};
