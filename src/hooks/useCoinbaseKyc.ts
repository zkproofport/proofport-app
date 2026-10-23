import {useState, useCallback, useRef} from 'react';
import {isWalletRejection, WALLET_REJECTED_PREFIX} from '../utils/walletRejection';
import {ethers} from 'ethers';
import {
  generateNoirProof,
  getNumPublicInputsFromCircuit,
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
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
  downloadCircuitFiles,
  ensureWalletOnChain,
} from '../utils';
import {getEnvironment, type CircuitName} from '../config';
import {coinbaseKycArtifact} from '../config/circuitArtifacts';
import type {TypedAction} from '../config/circuitIds';
import {signedDigestOf} from '../utils/signedAction';
import {computeScope} from '../utils/circuitHelpers';
import {coinbaseSignalHash} from '../utils/coinbaseSignal';
import {
  flattenCoinbaseAppAttestInputs,
  prepareCoinbaseAppAttestInputs,
} from '../utils/coinbaseAppAttestInputs';
import {checkStatementAge, type AppAttestWitness} from '../appAttest/revocationStatement';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

// The circuit this hook proves. The same id is hashed into the deterministic
// signal_hash (`coinbaseSignalHash` in utils/coinbaseKyc.ts), which the shipped
// circuit's nullifier is derived from: changing it changes every nullifier and
// breaks duplicate detection in ZKProofportNullifierRegistry.
const CIRCUIT_NAME = 'coinbase_attestation';

/**
 * Which circuit a request runs on — named by the caller, then checked.
 *
 * This hook proves exactly one circuit. A request for any other id is refused
 * by name rather than quietly answered with a Coinbase proof.
 */
function circuitFor(requested: string): string {
  if (requested === CIRCUIT_NAME) {
    return CIRCUIT_NAME;
  }
  throw new Error(`This hook proves ${CIRCUIT_NAME}; it was asked for '${requested}'.`);
}

// Module-level proof cache — persists across hook instances (screen navigations)
/**
 * Which circuit produced the cached proof and VK below.
 *
 * Off-chain verification runs from those caches and has no request in scope,
 * so without this it would load whichever circuit was hardcoded and verify a
 * proof against the wrong artifacts -- which fails as "invalid proof", naming
 * the proof rather than the mismatch.
 */
let _cachedCircuitName: string = 'coinbase_attestation';

let _cachedVk: ArrayBuffer | null = null;
let _cachedFullProof: ArrayBuffer | null = null;
let _cachedParsedProof: ParsedProofData | null = null;

export interface CoinbaseKycProofInputs {
  /**
   * Which circuit to prove. Required, and checked: this hook proves
   * `coinbase_attestation` only, and any other id is an error rather than a
   * proof from the wrong circuit.
   */
  circuit: string;
  userAddress: string;
  rawTransaction: string;
  signerIndex: number;
  scopeString: string;  // dApp scope identifier (REQUIRED)
  /**
   * Required: Coinbase KYC v2 proves that this app, attested by Apple, saw
   * the Coinbase verification unrevoked. The screen makes the statement before
   * the wallet is asked to sign (src/appAttest/revocationStatement.ts).
   */
  appAttest: {
    witness: AppAttestWitness;
    /** The EIP-712 action, when one is bound (signal_hash then goes out as zeros). */
    action?: TypedAction;
  };
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
    inputs: CoinbaseKycProofInputs,
    ethereum: EthereumProvider | null,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<boolean>;
  /**
   * Check a generated proof against its verifier contract.
   *
   * `circuit` is required. This used to take only a logger and look up
   * `coinbase_attestation` on the build's default network — so a proof from
   * a circuit pinned to another chain was checked against the WRONG CONTRACT
   * on the WRONG CHAIN and came back "failed" while being perfectly valid.
   * Seen in a simulator on 2026-09-12, off-chain green and on-chain red on the
   * same proof.
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
      inputs: CoinbaseKycProofInputs,
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
        // Step 0: Download circuit files if needed
        // Bound once from the request so every artifact below -- files, VK,
        // SRS, circuit json -- comes from the same circuit. Reading the
        // request separately at each call site is how one of them ends up on
        // the other circuit's files and the proof fails with nothing naming
        // the cause.
        const circuitName = circuitFor(inputs.circuit);
        _cachedCircuitName = circuitName;
        const statement = inputs.appAttest;
        if (!statement?.witness) {
          throw new Error('Coinbase KYC v2 needs an App Attest statement; none was made for this request.');
        }
        addLog(`[AppAttest] Coinbase KYC v2 (circuits ${coinbaseKycArtifact().ref})`);
        checkStatementAge(statement.witness.attestedAt, Math.floor(Date.now() / 1000));
        // Always: downloadCircuitFiles owns the version check (the pinned
        // commit is part of the cache key) and fetches only what is stale.
        await downloadCircuitFiles(circuitName, getEnvironment(), undefined, addLog);

        // Step 1: Load VK
        updateStep('vk', {status: 'in_progress'});
        addLog('Step 1: Loading verification key...');
        addLog('[VK] Loading verification key from assets...');
        addLog(`[VK] Circuit name: ${circuitName}`);

        const vkStartTime = Date.now();
        currentVk = await loadVkFromAssets(circuitName, addLog);
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

        // Step 2: Validate transaction
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

        // Step 3: Generate signal hash
        updateStep('signal', {status: 'in_progress'});
        addLog('Step 3: Computing deterministic signal hash...');
        addLog('[Signal] Computing deterministic signal hash...');

        // Deterministic signal_hash = keccak256(userAddress + scopeString + circuitName)
        // This ensures the same wallet + scope + circuit always produces the same nullifier,
        // enabling on-chain duplicate detection in ZKProofportNullifierRegistry.
        // With an action there is no signal hash: the
        // circuit refuses a request that carries both.
        const action = statement.action;
        if (action) {
          currentSignalHash = new Uint8Array(32);
        } else {
          currentSignalHash = coinbaseSignalHash(inputs.userAddress, inputs.scopeString);
        }
        setSignalHash(currentSignalHash);
        const signalHashHex = Buffer.from(currentSignalHash).toString('hex');

        addLog(`[Signal] Signal hash: 0x${signalHashHex.slice(0, 32)}...`);
        updateStep('signal', {
          status: 'completed',
          detail: `0x${signalHashHex.slice(0, 16)}...`,
        });
        addLog(`Signal hash: 0x${signalHashHex.slice(0, 16)}...`);

        // Step 4: Sign with wallet
        updateStep('sign', {status: 'in_progress'});
        addLog('Step 4: Requesting signature from wallet...');
        addLog('[Sign] Preparing EIP-191 personal_sign request...');

        if (!ethereum) {
          throw new Error('Wallet provider not available');
        }

        const messageHex = ethers.utils.hexlify(currentSignalHash);
        // One description of what is signed, shared by the signing request and
        // the key recovery below.
        const signed = whatTheWalletSigns(messageHex, action);
        {
          // The statement App Attest signed names the digest this request
          // makes the wallet sign. Checked before the wallet is asked, so a
          // mismatch never costs the person a signature.
          const bound = ethers.utils.hexlify(statement.witness.clientData.slice(161, 193));
          if (bound.toLowerCase() !== signedDigestOf(signed).toLowerCase()) {
            throw new Error(`The App Attest statement binds request ${bound}, this request signs ${signedDigestOf(signed)}`);
          }
        }
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;
        addLog(`[Sign] Signer address: ${from}`);
        if (action) {
          // Typed data is refused by a wallet on another chain than the
          // domain's; the domain follows this circuit's network.
          addLog(`[Sign] Typed action: ${action.primaryType}`);
          await ensureWalletOnChain(ethereum, CIRCUIT_NAME, addLog);
        }

        addLog(`[Sign] Message: ${messageHex.slice(0, 20)}...`);

        if (isSigningRef.current) {
          throw new Error('Signing already in progress');
        }

        try {
          isSigningRef.current = true;
          // `personal_sign` takes [message, from]; `eth_signTypedData_v4`
          // takes [from, payload].
          const result = await ethereum.request({
            method: signed.method,
            params:
              signed.method === 'personal_sign'
                ? [...signed.params, from]
                : [from, ...signed.params],
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

        // Step 5: Recover public key
        updateStep('pubkey', {status: 'in_progress'});
        addLog('Step 5: Recovering public key from signature...');
        addLog('[PubKey] Recovering secp256k1 public key from signature...');

        // Recover against WHAT WAS SIGNED: `signal_hash` through personal_sign.
        // A key recovered against any other digest is a DIFFERENT public key,
        // and the prover fails at the end with `MoproError.NoirError` and
        // nothing naming the cause.
        addLog(
          `[PubKey] Recovering against what was signed: ${signed.digest.slice(0, 20)}... ` +
            `(${signed.method}, personal_sign prefix ${signed.prefixed ? 'yes' : 'no'})`,
        );
        userPubkey = recoverSignerPubkey(signed, userSignature);

        addLog(`[PubKey] Public key: ${userPubkey.slice(0, 40)}...`);
        addLog(`[PubKey] Key length: ${userPubkey.length} chars`);
        updateStep('pubkey', {
          status: 'completed',
          detail: `${userPubkey.slice(0, 20)}...`,
        });
        addLog(`Public key recovered: ${userPubkey.slice(0, 20)}...`);

        // Step 6: Compute scope and nullifier
        updateStep('scope', {status: 'in_progress'});
        addLog('Step 6: Computing scope and nullifier...');
        updateStep('scope', {status: 'completed'});

        // Step 7: Prepare circuit inputs
        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 7: Preparing circuit inputs...');
        addLog('[Inputs] Preparing Noir circuit inputs...');

        const circuitInputs = prepareCircuitInputs(
          currentSignalHash,
          inputs.userAddress,
          userSignature,
          userPubkey,
          inputs.rawTransaction,
          signerIndex,
          inputs.scopeString,  // NEW: scope string for nullifier
          // Circuits derive their nullifiers differently, so the circuit is
          // named rather than assumed.
          circuitName,
        );
        const flatInputs = flattenCoinbaseAppAttestInputs(
              prepareCoinbaseAppAttestInputs(
                circuitInputs,
                {
                  userAddress: inputs.userAddress,
                  scope: computeScope(inputs.scopeString),
                  signedDigest: signedDigestOf(signed),
                  publicHashes: signed.publicHashes,
                },
                statement.witness,
              ),
            );

        addLog('[Inputs] Signal hash: ✓');
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

        // Step 8: Check storage
        updateStep('storage', {status: 'in_progress'});
        addLog('Step 8: Checking storage availability...');

        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }

        updateStep('storage', {
          status: 'completed',
          detail: 'Sufficient storage available',
        });

        // Step 9: Generate proof
        updateStep('proof', {status: 'in_progress'});
        addLog('Step 9: Generating ZK proof...');
        addLog(`[Proof] Loading circuit file: ${circuitName}.json`);
        addLog(`[Proof] Loading SRS file: ${circuitName}.srs`);

        const circuitPath = await getAssetPath(`${circuitName}.json`);
        const srsPath = await getAssetPath(`${circuitName}.srs`);

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

        addLog(`[Proof] Proof generated! Size: ${currentProof!.byteLength} bytes`);
        addLog(`[Proof] Generation time: ${proofElapsed}ms`);
        setFullProof(currentProof);
        _cachedFullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });
        addLog(`Proof generated: ${currentProof!.byteLength} bytes (${proofElapsed}ms)`);

        // Step 10: Parse proof
        updateStep('parse', {status: 'in_progress'});
        addLog('Step 10: Parsing proof...');
        addLog('[Parse] Extracting public inputs from proof...');

        const numPublicInputs = getNumPublicInputsFromCircuit(circuitPath);
        addLog(`[Parse] Number of public inputs: ${numPublicInputs}`);
        if (numPublicInputs !== coinbaseKycArtifact().publicInputCount) {
          throw new Error(
            `${circuitName} has ${numPublicInputs} public inputs; this app reads ${coinbaseKycArtifact().publicInputCount}. The downloaded circuit is not the one the app was built for.`,
          );
        }
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

        // Step 11: Cleanup
        updateStep('cleanup', {status: 'in_progress'});
        addLog('Step 11: Cleaning up cache...');

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
    (addLog: (msg: string) => void): Promise<boolean> =>
      verifyProofOffChainWithMopro(_cachedCircuitName, vk || _cachedVk, fullProof || _cachedFullProof, {addLog, setStatus, setIsLoading}),
    [vk, fullProof],
  );

  /**
   * Verify proof on-chain using the deployed Verifier contract
   */
  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
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
