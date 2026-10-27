/**
 * Checking a proof this phone generated, in one place for every proof hook.
 *
 * Six hooks (Coinbase KYC, Coinbase Country, GIWA, Korea mDL, OIDC domain,
 * Dojang playground) used to carry their own copy of both checks below. The
 * copies had already drifted in what they logged, and an on-chain check that
 * is written six times is a chain or contract lookup that can go wrong six
 * different ways.
 *
 * - Off-chain stays on mopro: it is the prover that produced the proof, with
 *   the same circuit, VK and hash, so it answers "did the phone make a proof
 *   its own verifier accepts".
 * - On-chain goes through `verifyProofOnChain` from `@zkproofport-app/core`,
 *   the same function proofport-ai and dApps use, so the app asks the
 *   contract exactly the way everyone else does. The app decides WHICH CHAIN
 *   (the circuit's own, from CIRCUIT_NETWORKS); core's pinned table decides
 *   WHICH CONTRACT on it, and the app's resolved address is only compared.
 */
import {ethers} from 'ethers';
import {verifyNoirProof} from 'mopro-ffi';
import {verifyProofOnChain, VERIFIER_ABI, type ParsedProof} from '@zkproofport-app/core';
import {
  getEnvironment,
  getNetworkConfigForCircuit,
  getVerifierAddress,
} from '../config/environment';
import type {CircuitName} from '../config/circuitIds';
import {circuitArtifactSource} from '../config/circuitArtifacts';
import type {ProofStatus} from '../types';
import {getAssetPath} from './asset';

/** The hook state a verification reports into. */
export interface VerificationReporter {
  addLog: (msg: string) => void;
  setStatus: (status: ProofStatus) => void;
  setIsLoading: (loading: boolean) => void;
}

/**
 * Verify a full proof (proof bytes with public inputs) off-chain with mopro.
 *
 * `circuit` must be the circuit that produced `fullProof` and `vk`: the circuit
 * json is loaded by that name, and verifying against another circuit's file
 * fails as "invalid proof", naming the proof rather than the mismatch.
 */
export async function verifyProofOffChainWithMopro(
  circuit: string,
  vk: ArrayBuffer | null,
  fullProof: ArrayBuffer | null,
  {addLog, setStatus, setIsLoading}: VerificationReporter,
): Promise<boolean> {
  if (!vk || !fullProof) {
    addLog('Please generate proof first');
    return false;
  }

  setIsLoading(true);
  setStatus('Verifying proof...');
  addLog('=== Starting Off-Chain Verification ===');
  addLog('[OffChain] Starting local verification...');
  addLog(`[OffChain] Using cached VK: ${vk.byteLength} bytes`);
  addLog(`[OffChain] Using cached proof: ${fullProof.byteLength} bytes`);

  try {
    addLog(`[OffChain] Loading circuit: ${circuit}.json`);
    const circuitPath = await getAssetPath(`${circuit}.json`);

    addLog('[OffChain] Calling mopro verifyNoirProof...');
    const startTime = Date.now();
    const isValid = verifyNoirProof(
      circuitPath,
      fullProof,
      true, // onChain format (Keccak hash)
      vk,
      true, // lowMemoryMode
    );
    const elapsed = Date.now() - startTime;

    addLog(`[OffChain] Verification time: ${elapsed}ms`);
    addLog(`[OffChain] Result: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
    addLog(`Off-chain verification completed in ${elapsed}ms`);
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
}

/** Hints for the failures a person can do something about. */
function logOnChainErrorHint(errorMessage: string, addLog: (msg: string) => void) {
  if (errorMessage.includes('call revert')) {
    addLog('[OnChain] Contract call reverted');
    addLog('[OnChain] This may indicate a circuit/verifier mismatch');
    addLog('[OnChain] Try clearing app cache and restarting');
  } else if (errorMessage.includes('could not detect network')) {
    addLog('[OnChain] RPC endpoint unreachable');
  } else if (errorMessage.includes('network')) {
    addLog('[OnChain] Network error - check internet connection');
  }
}

/**
 * Verify a parsed proof against the circuit's verifier contract, on the
 * circuit's own chain, through `@zkproofport-app/core`.
 *
 * Returns false (never throws) for every failure, with the reason logged and
 * the status set — the same contract the hooks had before.
 */
export async function verifyProofOnChainWithCore(
  circuit: CircuitName,
  parsedProof: ParsedProof | null,
  {addLog, setStatus, setIsLoading}: VerificationReporter,
): Promise<boolean> {
  if (!parsedProof) {
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
      addLog(
        `[OnChain] ERROR: Verifier address is empty for ${circuit} - check FALLBACK_VERIFIERS and the environment config`,
      );
      addLog('[OnChain] Environment: ' + getEnvironment());
      setStatus('Verification unavailable');
      return false;
    }

    // The circuit's OWN chain, not the build's. Asking for the build default
    // once sent a proof from a circuit pinned to another chain to Base
    // Sepolia, where its verifier address held a different contract.
    const network = getNetworkConfigForCircuit(circuit);

    addLog(`[OnChain] Circuit: ${circuit}`);
    addLog(`[OnChain] Contract: ${verifierAddress}`);
    addLog(`[OnChain] Chain: ${network.name} (${network.chainId})`);

    addLog(`[OnChain] Connecting to ${network.name} RPC...`);
    const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);

    addLog(`[OnChain] Proof size: ${parsedProof.proofHex.length} chars`);
    addLog(`[OnChain] Public inputs: ${parsedProof.numPublicInputs}`);
    addLog('[OnChain] Calling verify(bytes, bytes32[])...');
    const startTime = Date.now();

    // The contract is core's pinned verifier for this circuit on this chain,
    // the one every dApp on core 0.2.0+ calls. The address the app resolved
    // (cache or fallback) goes in as what the app CLAIMS: when it differs,
    // core refuses, and the phone learns the same answer the dApp will give
    // instead of a "valid" from a contract nobody else checks.
    //
    // Exception: a circuit read from a pinned circuits commit
    // (circuitArtifacts.ts -- Coinbase KYC v2 on this branch) is not in core's
    // table yet; core 0.3.0 still pins the v1 Coinbase verifier, which rejects
    // every v2 proof. Its contract is the one this app configures for it, named
    // explicitly. Remove with the artifact row once core pins v2.
    const target = circuitArtifactSource(circuit)
      ? {address: verifierAddress, chainId: network.chainId, abi: VERIFIER_ABI}
      : {chainId: network.chainId};
    const result = await verifyProofOnChain(
      circuit,
      parsedProof,
      provider,
      target,
      {verifierAddress, chainId: network.chainId},
    );

    const elapsed = Date.now() - startTime;

    if (result.error !== undefined) {
      addLog(`On-chain verification error: ${result.error}`);
      logOnChainErrorHint(result.error, addLog);
      setStatus('Error: on-chain verification failed');
      return false;
    }

    addLog(`[OnChain] Verification time: ${elapsed}ms`);
    addLog(`[OnChain] Result: ${result.valid ? 'VALID ✓' : 'INVALID ✗'}`);
    addLog('[OnChain] Note: view function call (no gas spent)');
    addLog(`On-chain verification completed in ${elapsed}ms`);
    addLog(`Result: ${result.valid ? 'VALID' : 'INVALID'}`);

    if (result.valid) {
      addLog(`Proof verified on ${network.name} blockchain!`);
      setStatus('Proof verified on-chain!');
    } else {
      addLog('Proof rejected by on-chain verifier');
      setStatus('Proof invalid (on-chain)');
    }
    return result.valid;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    addLog(`On-chain verification error: ${errorMessage}`);
    logOnChainErrorHint(errorMessage, addLog);
    setStatus('Error: on-chain verification failed');
    return false;
  } finally {
    setIsLoading(false);
  }
}
