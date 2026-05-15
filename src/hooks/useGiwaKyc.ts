/**
 * useGiwaKyc — GIWA Sepolia variant of useCoinbaseKyc.
 *
 * Identical step pipeline (load VK → validate raw tx → sign → recover pubkey →
 * prepare inputs → generate proof → parse → verify) but every Coinbase-specific
 * constant is swapped for the GIWA PoC equivalent:
 *
 * - Circuit name: giwa_attestation (loads target/giwa_attestation.{json,srs} + vk)
 * - Attester contract: MockCoinbaseAttester on GIWA Sepolia
 * - Authorized signers: a single mock Upbit attester EOA
 * - On-chain verifier: GIWA Sepolia HonkVerifier (chain 91342)
 */
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
  recoverPublicKey,
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
  downloadCircuitFiles,
  allCircuitFilesExist,
} from '../utils';
import {
  verifyGiwaAttestationTx,
  prepareGiwaCircuitInputs,
  GIWA_AUTHORIZED_SIGNERS,
} from '../utils/giwaKyc';
import {flattenCircuitInputs} from '../utils/coinbaseKyc';
import {
  getVerifierAddress,
  getVerifierAbi,
  getNetworkConfigForCircuit,
  getEnvironment,
} from '../config';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

const CIRCUIT_NAME = 'giwa_attestation';

let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface GiwaKycProofInputs {
  userAddress: string;
  rawTransaction: string;
  signerIndex: number;
  scopeString: string;
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

export interface UseGiwaKycReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  signalHash: Uint8Array | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: GiwaKycProofInputs,
    ethereum: EthereumProvider | null,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<boolean>;
  verifyProofOnChain: (addLog: (msg: string) => void) => Promise<boolean>;
  validateTransaction: (
    rawTx: string,
    userAddress: string,
    addLog: (msg: string) => void,
  ) => boolean;
  resetSteps: () => void;
  resetProofCache: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'validate', label: 'Validate GIWA attestation transaction', status: 'pending'},
  {id: 'signal', label: 'Compute deterministic signal hash', status: 'pending'},
  {id: 'sign', label: 'Sign with wallet', status: 'pending'},
  {id: 'pubkey', label: 'Recover public key', status: 'pending'},
  {id: 'scope', label: 'Compute scope and nullifier', status: 'pending'},
  {id: 'inputs', label: 'Prepare circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

export const useGiwaKyc = (): UseGiwaKycReturn => {
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
      addLog('Validating GIWA attestation transaction...');
      const result = verifyGiwaAttestationTx(rawTx, userAddress);
      if (!result.valid) {
        addLog(`Validation failed: ${result.error}`);
        return false;
      }
      addLog(`Transaction is valid! Attester: ${result.signerAddress}`);
      return true;
    },
    [],
  );

  const generateProofWithSteps = useCallback(
    async (
      inputs: GiwaKycProofInputs,
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
      addLog('=== Starting GIWA Proof Generation ===');

      let currentVk: ArrayBuffer | null = null;
      let currentProof: ArrayBuffer | null = null;
      let currentSignalHash: Uint8Array | null = null;
      let userSignature: string | undefined;
      let userPubkey: string | undefined;
      let signerIndex = 0;

      try {
        const filesExist = await allCircuitFilesExist(CIRCUIT_NAME);
        if (!filesExist) {
          addLog(`Circuit files for ${CIRCUIT_NAME} not found, downloading...`);
          const env = getEnvironment();
          await downloadCircuitFiles(CIRCUIT_NAME, env, undefined, addLog);
          addLog('Circuit files downloaded');
        }

        // Step 1: VK
        updateStep('vk', {status: 'in_progress'});
        addLog('Step 1: Loading verification key...');
        const vkStartTime = Date.now();
        currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        const vkElapsed = Date.now() - vkStartTime;
        setVk(currentVk);
        _cachedVk = currentVk;
        updateStep('vk', {
          status: 'completed',
          detail: `${currentVk.byteLength} bytes (${vkElapsed}ms)`,
        });

        // Step 2: Validate tx
        updateStep('validate', {status: 'in_progress'});
        addLog('Step 2: Validating GIWA attestation transaction...');
        const validation = verifyGiwaAttestationTx(inputs.rawTransaction, inputs.userAddress);
        if (!validation.valid) {
          throw new Error(validation.error || 'Invalid GIWA attestation transaction');
        }
        signerIndex = GIWA_AUTHORIZED_SIGNERS.findIndex(
          addr => addr.toLowerCase() === validation.signerAddress?.toLowerCase(),
        );
        if (signerIndex === -1) {
          throw new Error('Signer not in GIWA_AUTHORIZED_SIGNERS');
        }
        updateStep('validate', {
          status: 'completed',
          detail: `Signer: ${validation.signerAddress?.slice(0, 10)}... (idx ${signerIndex})`,
        });
        addLog(`GIWA attester verified: ${validation.signerAddress}`);

        // Step 3: signal hash
        updateStep('signal', {status: 'in_progress'});
        const signalPreimage = ethers.utils.solidityPack(
          ['address', 'string', 'string'],
          [inputs.userAddress, inputs.scopeString, CIRCUIT_NAME],
        );
        currentSignalHash = ethers.utils.arrayify(ethers.utils.keccak256(signalPreimage));
        setSignalHash(currentSignalHash);
        const signalHashHex = Buffer.from(currentSignalHash).toString('hex');
        updateStep('signal', {
          status: 'completed',
          detail: `0x${signalHashHex.slice(0, 16)}...`,
        });

        // Step 4: sign
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
          if (!userSignature) throw new Error('Empty signature returned');
        } catch (signError) {
          const msg = signError instanceof Error ? signError.message : String(signError);
          const code = (signError as {code?: number})?.code;
          if (code === -32002 || msg.includes('already pending')) {
            throw new Error('Signing request already pending. Please try again.');
          }
          throw new Error(`Signature failed: ${msg}`);
        } finally {
          isSigningRef.current = false;
        }
        updateStep('sign', {
          status: 'completed',
          detail: `${userSignature.slice(0, 20)}...`,
        });

        // Step 5: recover pubkey
        updateStep('pubkey', {status: 'in_progress'});
        userPubkey = recoverPublicKey(messageHex, userSignature);
        updateStep('pubkey', {
          status: 'completed',
          detail: `${userPubkey.slice(0, 20)}...`,
        });

        // Step 6: scope + nullifier
        updateStep('scope', {status: 'in_progress'});
        updateStep('scope', {status: 'completed'});

        // Step 7: prepare circuit inputs (GIWA version)
        updateStep('inputs', {status: 'in_progress'});
        const circuitInputs = prepareGiwaCircuitInputs(
          currentSignalHash,
          inputs.userAddress,
          userSignature,
          userPubkey,
          inputs.rawTransaction,
          signerIndex,
          inputs.scopeString,
        );
        const flatInputs = flattenCircuitInputs(circuitInputs);
        updateStep('inputs', {
          status: 'completed',
          detail: `${flatInputs.length} input values`,
        });

        // Step 8: storage
        updateStep('storage', {status: 'in_progress'});
        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }
        updateStep('storage', {status: 'completed', detail: 'OK'});

        // Step 9: prove
        updateStep('proof', {status: 'in_progress'});
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
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });

        // Step 10: parse
        updateStep('parse', {status: 'in_progress'});
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
        _cachedParsedProof = parsedData;
        setProof(parsed.proof);
        updateStep('parse', {
          status: 'completed',
          detail: `proof.hex: ${proofHex.substring(0, 16)}... | ${numPublicInputs} public inputs`,
        });

        // Step 11: cleanup
        updateStep('cleanup', {status: 'in_progress'});
        await clearProofCache(addLog);
        updateStep('cleanup', {status: 'completed', detail: 'Cache cleared'});

        setStatus('Proof ready');
        addLog('=== GIWA Proof Generation Complete ===');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error generating proof');
        setProofSteps(prev =>
          prev.map(step =>
            step.status === 'in_progress'
              ? {...step, status: 'error', detail: errorMessage}
              : step,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [updateStep, resetSteps],
  );

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
      try {
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const startTime = Date.now();
        const isValid = verifyNoirProof(circuitPath, useFullProof, true, useVk, true);
        const elapsed = Date.now() - startTime;
        addLog(`Off-chain verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
        setStatus(isValid ? 'Proof verified!' : 'Proof invalid');
        return isValid;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${msg}`);
        setStatus('Error verifying proof');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (addLog: (msg: string) => void): Promise<boolean> => {
      const useParsedProof = parsedProof || _cachedParsedProof;
      if (!useParsedProof) {
        addLog('Please generate proof first');
        return false;
      }
      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      try {
        const verifierAddress = await getVerifierAddress('giwa_attestation');
        if (!verifierAddress) {
          addLog('[OnChain] Verifier address empty — check FALLBACK_VERIFIERS for giwa_attestation');
          setStatus('Verification unavailable');
          return false;
        }
        const network = getNetworkConfigForCircuit('giwa_attestation');
        addLog(`[OnChain] Verifier: ${verifierAddress}`);
        addLog(`[OnChain] Chain: ${network.name} (${network.chainId})`);

        const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
        const verifierContract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          provider,
        );

        const startTime = Date.now();
        const isValid = await verifierContract.verify(
          useParsedProof.proofHex,
          useParsedProof.publicInputsHex,
        );
        const elapsed = Date.now() - startTime;
        addLog(`On-chain verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
        setStatus(isValid ? 'Proof verified on-chain!' : 'Proof invalid (on-chain)');
        return isValid;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(`On-chain verification error: ${msg}`);
        setStatus('Error: on-chain verification failed');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [parsedProof],
  );

  const resetProofCache = useCallback(() => {
    _cachedVk = null;
    _cachedFullProof = null;
    _cachedParsedProof = null;
    setVk(null);
    setFullProof(null);
    setParsedProof(null);
    setProof(null);
    setSignalHash(null);
    resetSteps();
  }, [resetSteps]);

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
    resetProofCache,
  };
};
