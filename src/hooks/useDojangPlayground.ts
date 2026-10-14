/**
 * useDojangPlayground — the `dojang_playground` proof on GIWA Sepolia.
 *
 * Same pipeline as useGiwaKyc (load VK -> check the transaction -> sign ->
 * recover pubkey -> inputs -> prove -> parse) with the circuit's own inputs:
 * no issuer list and no Merkle root. The issuance transaction is the wallet's
 * own `payAndIssueEAS()` call to the Playground faucet, found by
 * `findDojangPlaygroundIssuance` before this hook runs; this hook checks it
 * again against the connected wallet, because a proof is only as good as the
 * last check before it.
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
  whatTheWalletSigns,
  recoverSignerPubkey,
  clearProofCache,
  ensureStorageAvailable,
  ensureWalletOnChain,
  loadVkFromAssets,
  downloadCircuitFiles,
  allCircuitFilesExist,
} from '../utils';
import {
  checkDojangIssuanceTx,
  flattenDojangPlaygroundInputs,
  prepareDojangPlaygroundInputs,
} from '../utils/dojangPlayground';
import type {TypedAction} from '../config/circuitIds';
import {
  getVerifierAddress,
  getVerifierAbi,
  getNetworkConfigForCircuit,
  getEnvironment,
  type CircuitName,
} from '../config';
import type {ProofStatus} from '../types';
import type {Step} from '../components';
import type {EthereumProvider, ParsedProofData} from './useGiwaKyc';

const CIRCUIT_NAME = 'dojang_playground';

let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface DojangPlaygroundProofInputs {
  userAddress: string;
  /** The issuance's exact signed bytes, from findDojangPlaygroundIssuance. */
  rawTransaction: string;
  scopeString: string;
  /** Optional EIP-712 action; with one, `signal_hash` goes out as zeros. */
  action?: TypedAction;
}

export interface UseDojangPlaygroundReturn {
  status: ProofStatus;
  isLoading: boolean;
  parsedProof: ParsedProofData | null;
  signalHash: Uint8Array | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: DojangPlaygroundProofInputs,
    ethereum: EthereumProvider | null,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<boolean>;
  verifyProofOnChain: (circuit: CircuitName, addLog: (msg: string) => void) => Promise<boolean>;
  resetSteps: () => void;
  resetProofCache: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'validate', label: 'Check the Dojang Playground issuance', status: 'pending'},
  {id: 'signal', label: 'Compute deterministic signal hash', status: 'pending'},
  {id: 'sign', label: 'Sign with wallet', status: 'pending'},
  {id: 'pubkey', label: 'Recover public key', status: 'pending'},
  {id: 'inputs', label: 'Prepare circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

export const useDojangPlayground = (): UseDojangPlaygroundReturn => {
  const [status, setStatus] = useState<ProofStatus>('Ready');
  const [isLoading, setIsLoading] = useState(false);
  const [vk, setVk] = useState<ArrayBuffer | null>(null);
  const [fullProof, setFullProof] = useState<ArrayBuffer | null>(null);
  const [parsedProof, setParsedProof] = useState<ParsedProofData | null>(null);
  const [signalHash, setSignalHash] = useState<Uint8Array | null>(null);
  const [proofSteps, setProofSteps] = useState<Step[]>(INITIAL_PROOF_STEPS);
  const isSigningRef = useRef(false);

  const updateStep = useCallback((stepId: string, updates: Partial<Step>) => {
    setProofSteps(prev => prev.map(step => (step.id === stepId ? {...step, ...updates} : step)));
  }, []);

  const resetSteps = useCallback(() => {
    setProofSteps(INITIAL_PROOF_STEPS);
    setParsedProof(null);
  }, []);

  const generateProofWithSteps = useCallback(
    async (
      inputs: DojangPlaygroundProofInputs,
      ethereum: EthereumProvider | null,
      addLog: (msg: string) => void,
    ) => {
      if (!inputs.userAddress) {
        addLog('Please connect wallet first');
        return;
      }
      if (!inputs.rawTransaction) {
        addLog('No Dojang Playground issuance transaction was supplied');
        return;
      }

      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog('=== Starting Dojang Playground Proof Generation ===');

      try {
        if (!(await allCircuitFilesExist(CIRCUIT_NAME))) {
          addLog(`Circuit files for ${CIRCUIT_NAME} not found, downloading...`);
          await downloadCircuitFiles(CIRCUIT_NAME, getEnvironment(), undefined, addLog);
          addLog('Circuit files downloaded');
        }

        updateStep('vk', {status: 'in_progress'});
        const vkStart = Date.now();
        const currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        setVk(currentVk);
        _cachedVk = currentVk;
        updateStep('vk', {status: 'completed', detail: `${currentVk.byteLength} bytes (${Date.now() - vkStart}ms)`});

        updateStep('validate', {status: 'in_progress'});
        const {txType} = checkDojangIssuanceTx(inputs.rawTransaction, inputs.userAddress);
        updateStep('validate', {status: 'completed', detail: `type ${txType} faucet call by this wallet`});

        updateStep('signal', {status: 'in_progress'});
        let currentSignalHash: Uint8Array;
        if (inputs.action) {
          // The circuit asserts signal_hash is zero when an action is bound.
          currentSignalHash = new Uint8Array(32);
          addLog('[Signal] Action bound -- signal_hash goes out as zeros');
        } else {
          currentSignalHash = ethers.utils.arrayify(
            ethers.utils.keccak256(
              ethers.utils.solidityPack(
                ['address', 'string', 'string'],
                [inputs.userAddress, inputs.scopeString, CIRCUIT_NAME],
              ),
            ),
          );
        }
        setSignalHash(currentSignalHash);
        updateStep('signal', {status: 'completed', detail: ethers.utils.hexlify(currentSignalHash)});

        updateStep('sign', {status: 'in_progress'});
        if (!ethereum) throw new Error('Wallet provider not available');
        const signed = whatTheWalletSigns(ethers.utils.hexlify(currentSignalHash), inputs.action);
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;
        if (inputs.action) {
          addLog(`[Sign] Typed action: ${inputs.action.primaryType}`);
          await ensureWalletOnChain(ethereum, CIRCUIT_NAME, addLog);
        }
        if (isSigningRef.current) throw new Error('Signing already in progress');
        let userSignature: string;
        try {
          isSigningRef.current = true;
          // personal_sign takes [message, from]; eth_signTypedData_v4 takes [from, payload].
          const result = await ethereum.request({
            method: signed.method,
            params: signed.method === 'personal_sign' ? [...signed.params, from] : [from, ...signed.params],
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
        updateStep('sign', {status: 'completed', detail: userSignature});

        updateStep('pubkey', {status: 'in_progress'});
        const userPubkey = recoverSignerPubkey(signed, userSignature);
        // The faucet transaction must be signed by this same key -- the circuit
        // checks it against this pubkey, so say so here in words if it is not.
        const recovered = ethers.utils.computeAddress(userPubkey);
        if (recovered.toLowerCase() !== inputs.userAddress.toLowerCase()) {
          throw new Error(`The signature recovers to ${recovered}, not the connected wallet ${inputs.userAddress}.`);
        }
        updateStep('pubkey', {status: 'completed', detail: recovered});

        updateStep('inputs', {status: 'in_progress'});
        const flatInputs = flattenDojangPlaygroundInputs(
          prepareDojangPlaygroundInputs({
            signalHash: currentSignalHash,
            userAddress: inputs.userAddress,
            userSignature,
            userPubkey,
            rawTransaction: inputs.rawTransaction,
            scopeString: inputs.scopeString,
            action: signed.publicHashes,
          }),
        );
        updateStep('inputs', {status: 'completed', detail: `${flatInputs.length} input values`});

        updateStep('storage', {status: 'in_progress'});
        if (!(await ensureStorageAvailable(500, addLog))) {
          throw new Error('Insufficient storage for proof generation');
        }
        updateStep('storage', {status: 'completed', detail: 'OK'});

        updateStep('proof', {status: 'in_progress'});
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);
        const proofStart = Date.now();
        const currentProof = generateNoirProof(circuitPath, srsPath, flatInputs, true, currentVk, true);
        setFullProof(currentProof);
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof.byteLength} bytes (${Date.now() - proofStart}ms)`,
        });

        updateStep('parse', {status: 'in_progress'});
        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        const parsed: ProofWithPublicInputs = parseProofWithPublicInputs(currentProof, numPublicInputs);
        const parsedData: ParsedProofData = {
          proofHex: '0x' + arrayBufferToHex(parsed.proof),
          publicInputsHex: parsed.publicInputs.map((pi: ArrayBuffer) => '0x' + arrayBufferToHex(pi)),
          numPublicInputs,
        };
        setParsedProof(parsedData);
        _cachedParsedProof = parsedData;
        updateStep('parse', {status: 'completed', detail: `${numPublicInputs} public inputs`});

        updateStep('cleanup', {status: 'in_progress'});
        await clearProofCache(addLog);
        updateStep('cleanup', {status: 'completed', detail: 'Cache cleared'});

        setStatus('Proof ready');
        addLog('=== Dojang Playground Proof Generation Complete ===');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${errorMessage}`);
        setStatus('Error generating proof');
        setProofSteps(prev =>
          prev.map(step => (step.status === 'in_progress' ? {...step, status: 'error', detail: errorMessage} : step)),
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
        const isValid = verifyNoirProof(circuitPath, useFullProof, true, useVk, true);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
        setStatus(isValid ? 'Proof verified!' : 'Proof invalid');
        return isValid;
      } catch (error) {
        addLog(`Error: ${error instanceof Error ? error.message : String(error)}`);
        setStatus('Error verifying proof');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      if (circuit !== CIRCUIT_NAME) {
        throw new Error(`This hook proves ${CIRCUIT_NAME}; it was asked to verify '${circuit}'.`);
      }
      const useParsedProof = parsedProof || _cachedParsedProof;
      if (!useParsedProof) {
        addLog('Please generate proof first');
        return false;
      }
      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      try {
        const verifierAddress = await getVerifierAddress(circuit);
        if (!verifierAddress) {
          addLog(`[OnChain] No verifier address for ${circuit}`);
          setStatus('Verification unavailable');
          return false;
        }
        const net = getNetworkConfigForCircuit(circuit);
        addLog(`[OnChain] Verifier: ${verifierAddress} on ${net.name} (${net.chainId})`);
        const contract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          new ethers.providers.JsonRpcProvider(net.rpcUrl),
        );
        const isValid = await contract.verify(useParsedProof.proofHex, useParsedProof.publicInputsHex);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
        setStatus(isValid ? 'Proof verified on-chain!' : 'Proof invalid (on-chain)');
        return isValid;
      } catch (error) {
        addLog(`On-chain verification error: ${error instanceof Error ? error.message : String(error)}`);
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
    setSignalHash(null);
    resetSteps();
  }, [resetSteps]);

  return {
    status,
    isLoading,
    parsedProof,
    signalHash,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    resetSteps,
    resetProofCache,
  };
};
