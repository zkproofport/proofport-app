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
  whatTheWalletSigns,
  recoverSignerPubkey,
  AUTHORIZED_SIGNERS,
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
  downloadCircuitFiles,
  allCircuitFilesExist,
  ensureWalletOnChain,
} from '../utils';
import {getVerifierAddress, getVerifierAbi, getNetworkConfigForCircuit, getEnvironment, type CircuitName} from '../config';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

// Circuit file names
// CRITICAL: CIRCUIT_NAME is used in deterministic signal_hash generation for nullifier computation.
// Changing this value will produce different nullifiers for the same wallet+scope,
// breaking on-chain duplicate detection in ZKProofportNullifierRegistry.
// DO NOT modify this value without coordinating with the contract and relay teams.
const CIRCUIT_NAME = 'coinbase_attestation';

/**
 * The action-bound circuit, used ONLY when the requester supplied a typed
 * action. It proves the same Coinbase attestation, but the wallet signs an
 * EIP-712 structure and two extra hashes ride in the public inputs.
 *
 * Experimental, testnet only -- no verifier for it is deployed on any mainnet.
 */
const ACTION_CIRCUIT_NAME = 'arc_eligibility';

/**
 * Which circuit a request runs on — named by the caller, then checked.
 *
 * It used to be `action ? ACTION_CIRCUIT_NAME : CIRCUIT_NAME`, which made the
 * presence of one optional field decide the circuit. Picking `Arc Eligibility`
 * on the Verify screen therefore produced a COINBASE proof: the screen passed
 * no action, the ternary fell through, and nothing said so. A registered id
 * resolving quietly to another circuit is the failure this codebase forbids
 * everywhere else.
 *
 * So the caller states the circuit and this function refuses every combination
 * that cannot be honoured, rather than choosing one.
 *
 * `signal_hash` keeps using CIRCUIT_NAME either way, and that is deliberate:
 * the nullifier derives from it, so switching circuits must NOT change a
 * wallet's nullifier for a scope. Feeding the circuit name into signal_hash
 * here would give the same person two identities depending on whether the
 * requester bound an action, and on-chain duplicate detection would stop
 * seeing them as one.
 */
function circuitFor(requested: string, action?: TypedAction): string {
  if (requested === ACTION_CIRCUIT_NAME) {
    if (!action) {
      throw new Error(
        `${ACTION_CIRCUIT_NAME} proves that a wallet authorised ONE EIP-712 action, and no ` +
        `action was supplied. There is nothing for the wallet to sign and nothing to put in ` +
        `the public inputs. Supply inputs.action, or ask for ${CIRCUIT_NAME}.`,
      );
    }
    return ACTION_CIRCUIT_NAME;
  }

  if (requested === CIRCUIT_NAME) {
    if (action) {
      throw new Error(
        `An action was supplied but ${CIRCUIT_NAME} was requested, and that circuit has no ` +
        `public inputs to carry it. The action would be signed and then silently dropped, ` +
        `so the proof would say nothing about it. Ask for ${ACTION_CIRCUIT_NAME}.`,
      );
    }
    return CIRCUIT_NAME;
  }

  throw new Error(
    `This hook proves ${CIRCUIT_NAME} and ${ACTION_CIRCUIT_NAME}; it was asked for ` +
    `'${requested}'.`,
  );
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

/**
 * An EIP-712 typed structure, as `eth_signTypedData_v4` takes it.
 *
 * The requester owns every field; this app defines no action shapes and keeps
 * no registry of them. It passes the structure to the wallet, which renders
 * the named fields for the person to read before approving.
 */
// The shape a dapp signs. Declared once, in the SDK, because a dapp and this
// app have to agree on it byte for byte — this file used to repeat it, and two
// declarations agree only until somebody edits one.
export type {TypedAction} from '../utils/typedAction';
import type {TypedAction} from '../utils/typedAction';

export interface CoinbaseKycProofInputs {
  /**
   * Which circuit to prove. Required, and checked against `action` below:
   * `arc_eligibility` without an action is an error, and so is an action with
   * `coinbase_attestation`. Neither can be honoured, and guessing produced a
   * proof from the wrong circuit.
   */
  circuit: string;
  userAddress: string;
  rawTransaction: string;
  signerIndex: number;
  scopeString: string;  // dApp scope identifier (REQUIRED)
  /**
   * Bind the proof to one action.
   *
   * ABSENT is the shipped behaviour and must stay that way: the wallet signs
   * `signal_hash` through personal_sign, the proof goes to the
   * `coinbase_attestation` circuit, and every deployed verifier keeps working.
   * A build that started sending typed data unconditionally would produce
   * proofs the deployed verifiers cannot check.
   *
   * PRESENT switches the whole path -- typed-data signing, and the
   * `arc_eligibility` circuit, whose public inputs carry two extra hashes.
   * The two are not interchangeable at either end, which is why one field
   * decides both rather than a separate circuit toggle that could disagree
   * with it.
   *
   * Experimental, and testnet only: no verifier for that circuit is deployed
   * on any mainnet yet.
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
   * `coinbase_attestation` on the build's default network — so an
   * `arc_eligibility` proof was checked against the WRONG CONTRACT on the
   * WRONG CHAIN and came back "failed" while being perfectly valid. Seen in a
   * simulator on 2026-09-12, off-chain green and on-chain red on the same
   * proof.
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
        const circuitName = circuitFor(inputs.circuit, inputs.action);
        _cachedCircuitName = circuitName;
        const filesExist = await allCircuitFilesExist(circuitName);
        if (!filesExist) {
          addLog('Circuit files not found, downloading...');
          const env = getEnvironment();
          await downloadCircuitFiles(circuitName, env, undefined, addLog);
          addLog('Circuit files downloaded');
        }

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

        // Step 4: Sign with wallet
        updateStep('sign', {status: 'in_progress'});
        addLog('Step 4: Requesting signature from wallet...');
        addLog(
          inputs.action
            ? '[Sign] Preparing EIP-712 eth_signTypedData_v4 request...'
            : '[Sign] Preparing EIP-191 personal_sign request...',
        );

        if (!ethereum) {
          throw new Error('Wallet provider not available');
        }

        const messageHex = ethers.utils.hexlify(currentSignalHash);
        // One decision for all three uses below — the signing request, the key
        // recovery, and the circuit inputs. They were three separate reads of
        // `inputs.action` and drifted apart twice in one day.
        const signed = whatTheWalletSigns(messageHex, inputs.action);
        const selectedAddr = await ethereum.getSelectedAddress?.();
        const from = selectedAddr || inputs.userAddress;
        addLog(`[Sign] Signer address: ${from}`);

        if (inputs.action) {
          addLog('[Sign] Typed action present -- the wallet will show its fields');
          // A wallet refuses to sign typed data whose domain names a chain it
          // is not on: "Active chainId is 0x1 but received 0x4cef52", and
          // nothing else. Ask it to switch -- and to add the network first if
          // it has never seen it -- rather than leaving a person to type the
          // RPC and chain id in by hand.
          await ensureWalletOnChain(ethereum, circuitName as CircuitName, addLog);
          addLog(`[Sign] Contract: ${inputs.action.domain.verifyingContract}`);
          addLog(`[Sign] Action: ${inputs.action.primaryType}`);
        } else {
          addLog(`[Sign] Message: ${messageHex.slice(0, 20)}...`);
        }

        if (isSigningRef.current) {
          throw new Error('Signing already in progress');
        }

        try {
          isSigningRef.current = true;
          // Two request shapes, chosen by whether an action was bound. The
          // typed one carries `EIP712Domain` in `types` -- wallets require it
          // in the wire payload even though ethers adds it for you when
          // hashing, and omitting it here is rejected as a malformed request.
          // `personal_sign` takes [message, from]; `eth_signTypedData_v4`
          // takes [from, payload]. The order differs and is easy to get
          // backwards, so it is applied once here from the one resolution.
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

        // Recover against WHAT WAS SIGNED, which is not the same thing for
        // the two circuits.
        //
        // Without an action the wallet signed `signal_hash` through
        // personal_sign. With one it signed the EIP-712 digest —
        // keccak256(0x1901 ++ domainSeparator ++ structHash) — and the arc
        // circuit recomputes exactly that from its own public inputs before
        // checking the signature. Recovering against `signal_hash` there
        // yields a DIFFERENT public key: every step still succeeds, the input
        // vector is the right length, and the prover fails at the end with
        // `MoproError.NoirError` and nothing naming the cause. Seen on
        // 2026-09-12 with 963 correct inputs and a wrong key among them.
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
          // This hook serves coinbase_attestation and arc_eligibility, and
          // they derive their nullifiers differently -- so the circuit is
          // named rather than assumed.
          circuitName,
          // The two hashes that are PUBLIC INPUTS of the action-bound
          // circuit, from the same resolution the signature and the recovery
          // used. Leaving them out does not shorten the proof — it builds a
          // different circuit's, which the prover rejects one second in with
          // `MoproError.NoirError` and nothing else.
          signed.publicHashes,
        );
        const flatInputs = flattenCircuitInputs(circuitInputs);

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
      addLog('[OffChain] Starting local verification...');
      addLog(`[OffChain] Using cached VK: ${useVk ? useVk.byteLength + ' bytes' : 'null'}`);
      addLog(`[OffChain] Using cached proof: ${useFullProof ? useFullProof.byteLength + ' bytes' : 'null'}`);

      try {
        addLog(`[OffChain] Loading circuit: ${_cachedCircuitName}.json`);
        const circuitPath = await getAssetPath(`${_cachedCircuitName}.json`);

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

        addLog(`[OffChain] Verification time: ${elapsed}ms`);
        addLog(`[OffChain] Result: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        addLog(`Verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);
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
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      const useParsedProof = parsedProof || _cachedParsedProof;

      if (!useParsedProof) {
        addLog('Please generate proof first');
        return false;
      }

      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      addLog('=== Starting On-Chain Verification ===');

      try {
        addLog('[OnChain] Loading network configuration...');
        const verifierAddress = await getVerifierAddress(circuit);

        if (!verifierAddress) {
          addLog('[OnChain] ERROR: Verifier address is empty - check environment config');
          addLog('[OnChain] Environment: ' + getEnvironment());
          setStatus('Verification unavailable');
          return false;
        }

        // The circuit's OWN chain, not the build's. `arc_eligibility` is
        // pinned to Arc Testnet and its verifier exists nowhere else; asking
        // for the build default sent the call to Base Sepolia, where that
        // address holds a different contract entirely.
        const network = getNetworkConfigForCircuit(circuit);

        addLog(`[OnChain] Circuit: ${circuit}`);
        addLog('[OnChain] Starting on-chain verification...');
        addLog(`[OnChain] Contract: ${verifierAddress}`);
        addLog(`[OnChain] Chain: ${network.name} (${network.chainId})`);
        addLog(`Verifier contract: ${verifierAddress}`);
        addLog(`Chain: ${network.name} (${network.chainId})`);

        addLog(`[OnChain] Connecting to ${network.name} RPC...`);
        const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
        addLog(`Connected to ${network.name} RPC`);

        addLog('[OnChain] Creating contract instance...');
        const verifierContract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          provider,
        );

        addLog(`[OnChain] Proof size: ${useParsedProof.proofHex.length} chars`);
        addLog(`[OnChain] Public inputs: ${useParsedProof.numPublicInputs}`);
        addLog(`Proof hex (first 40 chars): ${useParsedProof.proofHex.substring(0, 42)}...`);
        addLog(`Public inputs count: ${useParsedProof.numPublicInputs}`);

        addLog('[OnChain] Calling verify(bytes, bytes32[])...');
        addLog('Calling verifier contract...');
        const startTime = Date.now();

        const isValid = await verifierContract.verify(
          useParsedProof.proofHex,
          useParsedProof.publicInputsHex,
        );

        const elapsed = Date.now() - startTime;
        addLog(`[OnChain] Verification time: ${elapsed}ms`);
        addLog(`[OnChain] Result: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        addLog('[OnChain] Note: view function call (no gas spent)');
        addLog(`On-chain verification completed in ${elapsed}ms`);
        addLog(`Result: ${isValid ? 'VALID' : 'INVALID'}`);

        // Log transaction info
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
          addLog('[OnChain] Contract call reverted');
          addLog('[OnChain] This may indicate a circuit/verifier mismatch');
          addLog('[OnChain] Try clearing app cache and restarting');
        } else if (errorMessage.includes('network')) {
          addLog('[OnChain] Network error - check internet connection');
        } else if (errorMessage.includes('could not detect network')) {
          addLog('[OnChain] RPC endpoint unreachable');
        }

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
