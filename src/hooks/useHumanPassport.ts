/**
 * useHumanPassport — the `human_passport_score` proof.
 *
 * Same pipeline as useDojangPlayground (load VK -> check the score -> sign ->
 * recover pubkey -> inputs -> prove -> parse). The score is the wallet's
 * Human Passport scoreV2 on Base, found by `findHumanPassportScore` before
 * this hook runs; this hook checks again that it names the connected wallet,
 * meets the threshold and is unexpired at the `now` the proof carries.
 */
import {useState, useCallback, useRef} from 'react';
import {describeWalletError, signingFailure} from '../utils/walletError';
import {ethers} from 'ethers';
import {
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
import {circuitFilesForProof, proveCircuit} from '../utils/proofRun';
import {publicInputCountOf} from '../utils/circuitPublicInputs';
import {verifyProofOffChainWithMopro, verifyProofOnChainWithCore} from '../utils/proofVerification';
import {
  getAssetPath,
  arrayBufferToHex,
  whatTheWalletSigns,
  recoverSignerPubkey,
  clearProofCache,
  ensureStorageAvailable,
  ensureWalletOnChain,
  loadVkFromAssets,
} from '../utils';
import {
  HUMAN_PASSPORT_CIRCUIT,
  PRODUCTION_ISSUER_LEAVES,
  prepareHumanPassportInputs,
  type PassportIssuance,
} from '../utils/humanPassport';
import type {TypedAction} from '../config/circuitIds';
import {type CircuitName} from '../config';
import type {ProofStatus} from '../types';
import type {Step} from '../components';
import type {EthereumProvider, ParsedProofData} from './useGiwaKyc';

const CIRCUIT_NAME = HUMAN_PASSPORT_CIRCUIT;

let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface HumanPassportProofInputs {
  userAddress: string;
  /** From findHumanPassportScore, already checked against the threshold. */
  issuance: PassportIssuance;
  /** Threshold in score units (points x 10^4). */
  minScoreUnits: number;
  scopeString: string;
  /** Optional EIP-712 action; with one, `signal_hash` goes out as zeros. */
  action?: TypedAction;
}

export interface UseHumanPassportReturn {
  status: ProofStatus;
  isLoading: boolean;
  parsedProof: ParsedProofData | null;
  signalHash: Uint8Array | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: HumanPassportProofInputs,
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
  {id: 'validate', label: 'Check the Human Passport score', status: 'pending'},
  {id: 'signal', label: 'Compute deterministic signal hash', status: 'pending'},
  {id: 'sign', label: 'Sign with wallet', status: 'pending'},
  {id: 'pubkey', label: 'Recover public key', status: 'pending'},
  {id: 'inputs', label: 'Prepare circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

export const useHumanPassport = (): UseHumanPassportReturn => {
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
      inputs: HumanPassportProofInputs,
      ethereum: EthereumProvider | null,
      addLog: (msg: string) => void,
    ) => {
      if (!inputs.userAddress) {
        addLog('Please connect wallet first');
        return;
      }

      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog('=== Starting Human Passport Proof Generation ===');

      try {
        // Always -- see the same line in useGiwaKyc.
        await circuitFilesForProof(CIRCUIT_NAME, addLog);

        updateStep('vk', {status: 'in_progress'});
        const vkStart = Date.now();
        const currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        setVk(currentVk);
        _cachedVk = currentVk;
        updateStep('vk', {status: 'completed', detail: `${currentVk.byteLength} bytes (${Date.now() - vkStart}ms)`});

        updateStep('validate', {status: 'in_progress'});
        const {request, head} = inputs.issuance;
        if (request.recipient.toLowerCase() !== inputs.userAddress.toLowerCase()) {
          throw new Error(`The score names ${request.recipient}, not the connected wallet ${inputs.userAddress}.`);
        }
        if (head.score < inputs.minScoreUnits) {
          throw new Error(`Score ${head.score / 1e4} is below the requested ${inputs.minScoreUnits / 1e4}.`);
        }
        // `now` is fixed here and proved; core holds it to the verifier's
        // clock, so it is the phone's clock at the start of proving.
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!(nowSeconds < request.expirationTime)) {
          throw new Error(`The score expired at ${new Date(request.expirationTime * 1000).toISOString()}.`);
        }
        updateStep('validate', {status: 'completed', detail: `score ${head.score / 1e4} >= ${inputs.minScoreUnits / 1e4}`});

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
          addLog(`[Sign] Wallet answered with an error: ${describeWalletError(signError)}`);
          throw signingFailure(signError);
        } finally {
          isSigningRef.current = false;
        }
        updateStep('sign', {status: 'completed', detail: userSignature});

        updateStep('pubkey', {status: 'in_progress'});
        const userPubkey = recoverSignerPubkey(signed, userSignature);
        const recovered = ethers.utils.computeAddress(userPubkey);
        if (recovered.toLowerCase() !== inputs.userAddress.toLowerCase()) {
          throw new Error(`The signature recovers to ${recovered}, not the connected wallet ${inputs.userAddress}.`);
        }
        updateStep('pubkey', {status: 'completed', detail: recovered});

        updateStep('inputs', {status: 'in_progress'});
        const flatInputs = prepareHumanPassportInputs({
          signalHash: currentSignalHash,
          action: signed.publicHashes,
          userAddress: inputs.userAddress,
          userSignature,
          userPubkey,
          scopeString: inputs.scopeString,
          minScoreUnits: inputs.minScoreUnits,
          nowSeconds,
          issuance: inputs.issuance,
          issuerLeaves: PRODUCTION_ISSUER_LEAVES,
        });
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
        const currentProof = await proveCircuit({circuit: CIRCUIT_NAME, variant: 'standard', circuitPath, srsPath, inputs: flatInputs, vk: currentVk, log: addLog});
        setFullProof(currentProof);
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof.byteLength} bytes (${Date.now() - proofStart}ms)`,
        });

        updateStep('parse', {status: 'in_progress'});
        const numPublicInputs = await publicInputCountOf(circuitPath);
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
        addLog('=== Human Passport Proof Generation Complete ===');
      } catch (error) {
        const errorMessage = describeWalletError(error);
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
    (addLog: (msg: string) => void): Promise<boolean> =>
      verifyProofOffChainWithMopro(CIRCUIT_NAME, vk || _cachedVk, fullProof || _cachedFullProof, {addLog, setStatus, setIsLoading}),
    [vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      if (circuit !== CIRCUIT_NAME) {
        throw new Error(`This hook proves ${CIRCUIT_NAME}; it was asked to verify '${circuit}'.`);
      }
      return verifyProofOnChainWithCore(circuit, parsedProof || _cachedParsedProof, {addLog, setStatus, setIsLoading});
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
