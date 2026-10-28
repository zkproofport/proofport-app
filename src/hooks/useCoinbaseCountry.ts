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
  prepareCircuitInputs,
  verifyAttestationTx,
  whatTheWalletSigns,
  recoverSignerPubkey,
  AUTHORIZED_SIGNERS,
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
} from '../utils';
import {type CircuitName} from '../config';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

// CRITICAL: CIRCUIT_NAME is used in deterministic signal_hash generation for nullifier computation.
// Changing this value will produce different nullifiers for the same wallet+scope,
// breaking on-chain duplicate detection in ZKProofportNullifierRegistry.
// DO NOT modify this value without coordinating with the contract and relay teams.
const CIRCUIT_NAME = 'coinbase_country_attestation';

let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface CoinbaseCountryInputs {
  userAddress: string;
  rawTransaction: string;
  signerIndex: number;
  countryList: string[];
  countryListLength: number;
  isIncluded: boolean;
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

export interface UseCoinbaseCountryReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  signalHash: Uint8Array | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: CoinbaseCountryInputs,
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
  {id: 'validate', label: 'Validate attestation transaction', status: 'pending'},
  {id: 'country', label: 'Encode country list', status: 'pending'},
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

function encodeCountryList(countries: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < 10; i++) {
    if (i < countries.length) {
      result.push('0x' + countries[i].charCodeAt(0).toString(16).padStart(2, '0'));
      result.push('0x' + countries[i].charCodeAt(1).toString(16).padStart(2, '0'));
    } else {
      result.push('0x00');
      result.push('0x00');
    }
  }
  return result;
}

export const useCoinbaseCountry = (): UseCoinbaseCountryReturn => {
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

  const generateProofWithSteps = useCallback(
    async (
      inputs: CoinbaseCountryInputs,
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
        // Always: downloadCircuitFiles owns the cache check (data version and
        // ref). Gated on "files exist" a stale cached circuit was proved with.
        await circuitFilesForProof(CIRCUIT_NAME, addLog);

        updateStep('vk', {status: 'in_progress'});
        addLog('Step 1: Loading verification key...');
        addLog('[VK] Loading verification key from assets...');
        addLog(`[VK] Circuit name: ${CIRCUIT_NAME}`);

        const vkStartTime = Date.now();
        currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        const vkElapsed = Date.now() - vkStartTime;

        addLog(`[VK] VK loaded successfully: ${currentVk.byteLength} bytes`);
        addLog('[VK] Caching VK for cross-screen persistence');
        setVk(currentVk);
        _cachedVk = currentVk;
        updateStep('vk', {
          status: 'completed',
          detail: `${currentVk.byteLength} bytes (${vkElapsed}ms)`,
        });
        addLog(`VK loaded: ${currentVk.byteLength} bytes (${vkElapsed}ms)`);

        updateStep('validate', {status: 'in_progress'});
        addLog('Step 2: Validating attestation transaction...');
        addLog('[Validate] Checking transaction format and signer...');

        const validation = verifyAttestationTx(inputs.rawTransaction, inputs.userAddress);
        if (!validation.valid) {
          throw new Error(validation.error || 'Invalid transaction');
        }

        addLog('[Validate] Transaction recipient confirmed');
        signerIndex = AUTHORIZED_SIGNERS.findIndex(
          addr => addr.toLowerCase() === validation.signerAddress?.toLowerCase(),
        );
        if (signerIndex === -1) {
          throw new Error('Signer not found in authorized list');
        }
        addLog(`[Validate] Authorized signer index: ${signerIndex}`);

        updateStep('validate', {
          status: 'completed',
          detail: `Signer: ${validation.signerAddress?.slice(0, 10)}... (index: ${signerIndex})`,
        });
        addLog(`Coinbase signer verified: ${validation.signerAddress}`);

        updateStep('country', {status: 'in_progress'});
        addLog('Step 3: Encoding country list...');
        addLog(`[Country] Countries: ${inputs.countryList.join(', ')}`);
        addLog(`[Country] List length: ${inputs.countryListLength}`);
        addLog(`[Country] Mode: ${inputs.isIncluded ? 'inclusion' : 'exclusion'}`);

        const encodedCountries = encodeCountryList(inputs.countryList);
        addLog(`[Country] Encoded to ${encodedCountries.length} values`);

        updateStep('country', {
          status: 'completed',
          detail: `${inputs.countryList.join(', ')} (${inputs.isIncluded ? 'include' : 'exclude'})`,
        });
        addLog(`Country list encoded: ${inputs.countryList.length} countries`);

        updateStep('signal', {status: 'in_progress'});
        addLog('Step 4: Computing deterministic signal hash...');
        addLog('[Signal] Computing deterministic signal hash...');

        // Deterministic signal_hash = keccak256(userAddress + scopeString + circuitName)
        // This ensures the same wallet + scope + circuit always produces the same nullifier,
        // enabling on-chain duplicate detection in ZKProofportNullifierRegistry.
        const signalPreimage = ethers.utils.solidityPack(
          ['address', 'string', 'string'],
          [inputs.userAddress, inputs.scopeString, CIRCUIT_NAME]
        );
        currentSignalHash = ethers.utils.arrayify(ethers.utils.keccak256(signalPreimage));
        setSignalHash(currentSignalHash);
        const signalHashHex = Buffer.from(currentSignalHash).toString('hex');

        addLog(`[Signal] Signal hash: 0x${signalHashHex.slice(0, 32)}...`);
        updateStep('signal', {
          status: 'completed',
          detail: `0x${signalHashHex.slice(0, 16)}...`,
        });
        addLog(`Signal hash: 0x${signalHashHex.slice(0, 16)}...`);

        updateStep('sign', {status: 'in_progress'});
        addLog('Step 5: Requesting signature from wallet...');
        addLog('[Sign] Preparing EIP-191 personal_sign request...');

        if (!ethereum) {
          throw new Error('Wallet provider not available');
        }

        const messageHex = ethers.utils.hexlify(currentSignalHash);
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;
        addLog(`[Sign] Signer address: ${from}`);
        addLog(`[Sign] Message: ${messageHex.slice(0, 20)}...`);

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
          addLog(`[Sign] Signature received (${userSignature.length} chars)`);
          addLog(`[Sign] Signature: ${userSignature.slice(0, 40)}...`);
        } catch (signError) {
          const signErrorMsg = signError instanceof Error ? signError.message : String(signError);
          const errorCode = (signError as {code?: number})?.code;

          if (errorCode === -32002 || signErrorMsg.includes('already pending')) {
            throw new Error('Signing request already pending. Please try again.');
          }
          if (isWalletRejection(signError)) {
            throw new Error(`${WALLET_REJECTED_PREFIX}: ${signErrorMsg}`);
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

        updateStep('pubkey', {status: 'in_progress'});
        addLog('Step 6: Recovering public key from signature...');
        addLog('[PubKey] Recovering secp256k1 public key from signature...');

        // Through the one place that decides what was signed. This circuit
        // has no typed action, so it is personal_sign over the signal hash --
        // said once, in src/utils/signedAction.ts, rather than assumed here.
        userPubkey = recoverSignerPubkey(whatTheWalletSigns(messageHex), userSignature);

        addLog(`[PubKey] Public key: ${userPubkey.slice(0, 40)}...`);
        addLog(`[PubKey] Key length: ${userPubkey.length} chars`);
        updateStep('pubkey', {
          status: 'completed',
          detail: `${userPubkey.slice(0, 20)}...`,
        });
        addLog(`Public key recovered: ${userPubkey.slice(0, 20)}...`);

        updateStep('scope', {status: 'in_progress'});
        addLog('Step 7: Computing scope and nullifier...');
        addLog('[Scope] Scope string: ' + inputs.scopeString);
        updateStep('scope', {
          status: 'completed',
          detail: `scope: ${inputs.scopeString.slice(0, 20)}`,
        });

        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 8: Preparing circuit inputs...');
        addLog('[Inputs] Preparing Noir circuit inputs...');

        const baseInputs = prepareCircuitInputs(
          currentSignalHash,
          inputs.userAddress,
          userSignature,
          userPubkey,
          inputs.rawTransaction,
          signerIndex,
          inputs.scopeString,
          CIRCUIT_NAME,
        );

        const scopeHex = baseInputs.scope;
        const nullifierHex = baseInputs.nullifier;

        addLog(`[Scope] Scope bytes: ${scopeHex.slice(0, 4).join(',')}...`);
        addLog(`[Scope] Nullifier: ${nullifierHex.slice(0, 4).join(',')}...`);

        const signalHashArray = Array.from(currentSignalHash).map(b => '0x' + b.toString(16).padStart(2, '0'));
        const signerListRoot = baseInputs.signer_list_merkle_root;

        const flatInputs: string[] = [
          ...signalHashArray,
          ...signerListRoot,
          ...encodedCountries,
          inputs.countryListLength.toString(),
          inputs.isIncluded ? '1' : '0',
          ...baseInputs.scope,
          ...baseInputs.nullifier,
          ...baseInputs.user_address,
          ...baseInputs.user_signature,
          ...baseInputs.user_pubkey_x,
          ...baseInputs.user_pubkey_y,
          ...baseInputs.raw_transaction,
          baseInputs.tx_length,
          ...baseInputs.coinbase_attester_pubkey_x,
          ...baseInputs.coinbase_attester_pubkey_y,
          ...baseInputs.coinbase_signer_merkle_proof.flat(),
          baseInputs.coinbase_signer_leaf_index,
          baseInputs.merkle_proof_depth,
        ];

        addLog('[Inputs] Signal hash: ✓');
        addLog('[Inputs] Signer list merkle root: ✓');
        addLog('[Inputs] Country list: ✓');
        addLog('[Inputs] User address: ✓');
        addLog('[Inputs] Signature: ✓');
        addLog('[Inputs] Public key: ✓');
        addLog('[Inputs] Raw transaction: ✓');
        addLog(`[Inputs] Signer index: ${signerIndex}`);
        addLog(`[Inputs] Flattened to ${flatInputs.length} input values`);
        updateStep('inputs', {
          status: 'completed',
          detail: `${flatInputs.length} input values`,
        });
        addLog(`Total circuit inputs: ${flatInputs.length}`);

        updateStep('storage', {status: 'in_progress'});
        addLog('Step 9: Checking storage availability...');

        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }

        updateStep('storage', {
          status: 'completed',
          detail: 'Sufficient storage available',
        });

        updateStep('proof', {status: 'in_progress'});
        addLog('Step 10: Generating ZK proof...');
        addLog(`[Proof] Loading circuit file: ${CIRCUIT_NAME}.json`);
        addLog(`[Proof] Loading SRS file: ${CIRCUIT_NAME}.srs`);

        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);

        addLog('[Proof] Starting Noir proof generation (low memory mode)...');
        const proofStartTime = Date.now();
        currentProof = await proveCircuit({circuit: CIRCUIT_NAME, variant: 'standard', circuitPath, srsPath, inputs: flatInputs, vk: currentVk, log: addLog});
        const proofElapsed = Date.now() - proofStartTime;

        addLog(`[Proof] Proof generated! Size: ${currentProof!.byteLength} bytes`);
        addLog(`[Proof] Generation time: ${proofElapsed}ms`);
        setFullProof(currentProof);
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });
        addLog(`Proof generated: ${currentProof!.byteLength} bytes (${proofElapsed}ms)`);

        updateStep('parse', {status: 'in_progress'});
        addLog('Step 11: Parsing proof...');
        addLog('[Parse] Extracting public inputs from proof...');

        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        addLog(`[Parse] Number of public inputs: ${numPublicInputs}`);
        const parsed: ProofWithPublicInputs = parseProofWithPublicInputs(
          currentProof!,
          numPublicInputs,
        );

        const proofHex = arrayBufferToHex(parsed.proof);
        addLog(`[Parse] Proof hex length: ${proofHex.length} chars`);
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
        setProof(parsed.proof);

        updateStep('parse', {
          status: 'completed',
          detail: `proof.hex: ${proofHex.substring(0, 16)}... | ${numPublicInputs} public inputs`,
        });

        addLog(`Parsed proof size: ${parsed.proof.byteLength} bytes`);
        addLog(`Number of public inputs: ${numPublicInputs}`);

        updateStep('cleanup', {status: 'in_progress'});
        addLog('Step 12: Cleaning up cache...');

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

  const verifyProofOffChain = useCallback(
    (addLog: (msg: string) => void): Promise<boolean> =>
      verifyProofOffChainWithMopro(CIRCUIT_NAME, vk || _cachedVk, fullProof || _cachedFullProof, {addLog, setStatus, setIsLoading}),
    [vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      if (circuit !== 'coinbase_country_attestation') {
        throw new Error(
          `This hook proves coinbase_country_attestation; it was asked to verify '${circuit}'.`,
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
