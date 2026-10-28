/**
 * useGiwaKyc — GIWA Sepolia variant of useCoinbaseKyc.
 *
 * Identical step pipeline (load VK → validate raw tx → sign → recover pubkey →
 * prepare inputs → generate proof → parse → verify) but every Coinbase-specific
 * constant is swapped for the GIWA PoC equivalent:
 *
 * - Circuit name: giwa_attestation (loads target/giwa_attestation.{json,srs} + vk)
 * - Attester contract: MockGiwaAttester on GIWA Sepolia
 * - Authorized signers: a single mock Upbit attester EOA
 * - On-chain verifier: GIWA Sepolia HonkVerifier (chain 91342)
 */
import {useState, useCallback, useRef} from 'react';
import {isWalletRejection, WALLET_REJECTED_PREFIX} from '../utils/walletRejection';
import {ethers} from 'ethers';
import {
  getNumPublicInputsFromCircuit,
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
import {circuitFilesForProof, proveCircuit} from '../utils/proofRun';
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
  verifyGiwaAttestationTx,
  prepareGiwaCircuitInputs,
  GIWA_AUTHORIZED_SIGNERS,
} from '../utils/giwaKyc';
import {flattenCircuitInputs} from '../utils/circuitHelpers';
import type {TypedAction} from '../config/circuitIds';
import {
  type CircuitName,
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
  /**
   * The EIP-712 action this proof authorizes, when a dapp sent one.
   *
   * Optional, and the circuit is what makes it optional: with an action the
   * wallet signs the typed data and `signal_hash` goes out as zeros; without
   * one it personal_signs `signal_hash` and the EIP-712 pair goes out as
   * zeros. The circuit refuses a request that fills both.
   */
  action?: TypedAction;
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
  /**
   * Check a generated proof against its verifier contract.
   *
   * `circuit` is required and is checked against what this hook proves. Every
   * hook took only a logger and looked up its own circuit on the BUILD's
   * default network, which is wrong the moment a circuit is pinned elsewhere —
   * a proof from a circuit on another chain was tested against the Coinbase
   * contract on Base Sepolia and reported "failed" while being valid.
   */
  verifyProofOnChain: (
    circuit: CircuitName,
    addLog: (msg: string) => void,
  ) => Promise<boolean>;
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
        // Always, as useMdlKr does: downloadCircuitFiles owns the version
        // check and only fetches what is missing or stale. Gating it on the
        // files existing let a stale copy prove -- and since the startup
        // prefetch skips Laboratory circuits while the switch is off, this is
        // the one place a lab circuit's cache is brought up to date.
        await circuitFilesForProof(CIRCUIT_NAME, addLog);

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
        /*
         * With an action there is no signal hash: the circuit asserts it is
         * empty, because a proof that carries both leaves each verifier to
         * decide which half to believe.
         */
        if (inputs.action) {
          currentSignalHash = new Uint8Array(32);
          addLog('[Signal] Action bound -- signal_hash goes out as zeros');
        } else {
          const signalPreimage = ethers.utils.solidityPack(
            ['address', 'string', 'string'],
            [inputs.userAddress, inputs.scopeString, CIRCUIT_NAME],
          );
          currentSignalHash = ethers.utils.arrayify(ethers.utils.keccak256(signalPreimage));
        }
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
        // One decision for the request, the recovery and the circuit inputs.
        // Three separate reads of `inputs.action` is how the Coinbase flow
        // drifted apart twice in one day.
        const signed = whatTheWalletSigns(messageHex, inputs.action);
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;
        if (inputs.action) {
          addLog(`[Sign] Typed action: ${inputs.action.primaryType}`);
          await ensureWalletOnChain(ethereum, CIRCUIT_NAME, addLog);
          addLog(`[Sign] Contract: ${inputs.action.domain.verifyingContract}`);
        }

        if (isSigningRef.current) {
          throw new Error('Signing already in progress');
        }

        try {
          isSigningRef.current = true;
          // `personal_sign` takes [message, from]; `eth_signTypedData_v4`
          // takes [from, payload]. The order differs and is easy to reverse.
          const result = await ethereum.request({
            method: signed.method,
            params:
              signed.method === 'personal_sign'
                ? [...signed.params, from]
                : [from, ...signed.params],
          });
          userSignature = result as string;
          if (!userSignature) throw new Error('Empty signature returned');
        } catch (signError) {
          const msg = signError instanceof Error ? signError.message : String(signError);
          const code = (signError as {code?: number})?.code;
          if (code === -32002 || msg.includes('already pending')) {
            throw new Error('Signing request already pending. Please try again.');
          }
          if (isWalletRejection(signError)) {
            throw new Error(`${WALLET_REJECTED_PREFIX}: ${msg}`);
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
        // Against whatever was actually signed. Recovering a typed-data
        // signature as though it were personal_sign returns a well-formed key
        // for a wallet nobody controls, and the circuit then fails on "User
        // pubkey does not match address" -- pointing at the address.
        userPubkey = recoverSignerPubkey(signed, userSignature);
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
          signed.publicHashes,
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
        currentProof = await proveCircuit({circuit: CIRCUIT_NAME, variant: 'standard', circuitPath, srsPath, inputs: flatInputs, vk: currentVk, log: addLog});
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
    (addLog: (msg: string) => void): Promise<boolean> =>
      verifyProofOffChainWithMopro(CIRCUIT_NAME, vk || _cachedVk, fullProof || _cachedFullProof, {addLog, setStatus, setIsLoading}),
    [vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      if (circuit !== 'giwa_attestation') {
        throw new Error(
          `This hook proves giwa_attestation; it was asked to verify '${circuit}'.`,
        );
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
