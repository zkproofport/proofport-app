/**
 * Checking a proof this phone generated, in one place for every proof hook.
 *
 * Every proof hook (Coinbase KYC, Coinbase Country, GIWA, OIDC domain, Dojang
 * playground) used to carry its own copy of both checks below. The copies had
 * already drifted in what they logged, and an on-chain check written once per
 * hook is a chain or contract lookup that can go wrong once per hook.
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
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_ATTESTED_AT_MAX_AGE_SECONDS,
  getPinnedVariantVerifier,
  getVerifierContract,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  OIDC_NOW_MAX_AGE_SECONDS,
  SIGNER_ROOT_LAYOUTS,
  signerRootCheck,
  verifyProofOnChain,
  VERIFIER_ABI,
  type ParsedProof,
} from '@zkproofport-app/core';
import {
  getEnvironment,
  getNetworkConfigForCircuit,
  getVerifierAddress,
} from '../config/environment';
import type {CircuitName} from '../config/circuitIds';
import {circuitArtifactSource} from '../config/circuitArtifacts';
import {wireSignerVariant, type WireSignerVariant} from '../config/signerPlatform';
import {verifierForProof} from './proofSignerVariant';
import type {ProofStatus} from '../types';
import {getAssetPath} from './asset';
import {PROOF_TIMING_PREFIX, timed} from './proofTiming';

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
    const isValid = await timed('local verify', () =>
      verifyNoirProof(
        circuitPath,
        fullProof,
        true, // onChain format (Keccak hash)
        vk,
        true, // lowMemoryMode
      ),
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
/**
 * Long hex runs (proof bytes, public inputs, call data an RPC error echoes
 * back) shortened to `0x1234…abcd` for logcat: a public input can be a
 * nullifier. Addresses (40 hex) stay whole.
 */
export function maskLongHex(text: string): string {
  return text.replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{56,}([0-9a-fA-F]{4})/g, '0x$1…$2');
}

/**
 * The time a proof names and how long a requesting service accepts it, per
 * circuit. core's verifyProofOnChain refuses a proof past that window before
 * it asks the contract -- right for a dApp judging a fresh answer, wrong for
 * this phone checking a proof from its History, which then read "failed" for
 * a proof the contract accepts.
 *
 *   index          the public input holding the time (unix seconds)
 *   maxAgeSeconds  core's window for it
 *   stillChecked   what core checks besides the time, run here too when the
 *                  contract is asked directly (null: nothing core exposes
 *                  separately)
 *
 * null: the circuit names no time, and core decides as it always does.
 * Exhaustive over CircuitName, so a new circuit has to be decided here.
 */
interface RequestWindow {
  input: string;
  index: number;
  maxAgeSeconds: number;
  stillChecked: ((publicInputs: readonly string[]) => Promise<{ok: true} | {ok: false; error: string}>) | null;
}

export const REQUEST_WINDOWS: Readonly<Record<CircuitName, RequestWindow | null>> = Object.freeze({
  // attested_at (input 192): when the statement's signer saw the attestation
  // unrevoked. The signer-list root is still compared with Coinbase's.
  coinbase_attestation: {
    input: 'attested_at',
    index: COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,
    maxAgeSeconds: COINBASE_ATTESTED_AT_MAX_AGE_SECONDS,
    stillChecked: signerRootCheck(SIGNER_ROOT_LAYOUTS.coinbase_attestation),
  },
  coinbase_country_attestation: null,
  oidc_domain_attestation: {
    input: 'now',
    index: OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NOW,
    maxAgeSeconds: OIDC_NOW_MAX_AGE_SECONDS,
    stillChecked: null,
  },
  giwa_attestation: null,
  dojang_playground: null,
});

function requestWindow(circuit: string): RequestWindow | null {
  if (!Object.prototype.hasOwnProperty.call(REQUEST_WINDOWS, circuit)) {
    throw new Error(`Unknown circuit '${circuit}'. Known: ${Object.keys(REQUEST_WINDOWS).join(', ')}.`);
  }
  return REQUEST_WINDOWS[circuit as CircuitName];
}

/**
 * Seconds since the time a proof names (OIDC `now`, Coinbase KYC
 * `attested_at`), or null for a circuit that names none (or a public input
 * that does not read as a number).
 */
export function proofAgeSeconds(circuit: string, publicInputsHex: readonly string[], nowSeconds: number): number | null {
  const window = requestWindow(circuit);
  if (!window) return null;
  const raw = publicInputsHex[window.index];
  if (typeof raw !== 'string') return null;
  try {
    return nowSeconds - Number(BigInt(raw));
  } catch {
    return null;
  }
}

/**
 * core's verifyProofOnChain against core's pinned contract for the circuit,
 * the proof's package (`signerVariant`) and the chain -- except for a proof
 * older than the window a requesting service accepts (REQUEST_WINDOWS): that
 * one is asked of the same pinned contract directly, after whatever core
 * would also have checked (stillChecked), and the log says how old it is.
 */
async function askVerifier(
  circuit: CircuitName,
  parsedProof: ParsedProof,
  provider: ethers.providers.JsonRpcProvider,
  signerVariant: WireSignerVariant,
  claimed: {verifierAddress: string; chainId: number},
  log: (m: string) => void,
): Promise<{valid: boolean; error?: string}> {
  const window = requestWindow(circuit);
  const age = proofAgeSeconds(circuit, parsedProof.publicInputsHex, Math.floor(Date.now() / 1000));
  if (window && age !== null && age > window.maxAgeSeconds) {
    log(
      `[OnChain] Proof made ${age}s ago (${window.input}), past the ${window.maxAgeSeconds}s a requesting service accepts; ` +
        'asking the contract directly',
    );
    try {
      const pinned = getPinnedVariantVerifier(circuit, signerVariant, claimed.chainId);
      if (pinned.address.toLowerCase() !== claimed.verifierAddress.toLowerCase()) {
        return {
          valid: false,
          error:
            `This build names verifier ${claimed.verifierAddress}, but a ${signerVariant} ${circuit} proof verifies against ` +
            `${pinned.address} on chain ${claimed.chainId}.`,
        };
      }
      if (window.stillChecked) {
        const checked = await window.stillChecked(parsedProof.publicInputsHex);
        if (!checked.ok) return {valid: false, error: checked.error};
      }
      const contract = getVerifierContract(provider, {address: pinned.address, chainId: claimed.chainId, abi: VERIFIER_ABI});
      return {valid: (await contract.verify(parsedProof.proofHex, parsedProof.publicInputsHex)) === true};
    } catch (e) {
      return {valid: false, error: e instanceof Error ? e.message : String(e)};
    }
  }
  return verifyProofOnChain(circuit, parsedProof, provider, {chainId: claimed.chainId}, claimed, {signerVariant});
}

export async function verifyProofOnChainWithCore(
  circuit: CircuitName,
  parsedProof: ParsedProof | null,
  {addLog: attemptLog, setStatus, setIsLoading}: VerificationReporter,
): Promise<boolean> {
  // Every line also goes to logcat / the Xcode console under [ProofTiming],
  // long hex masked: a failed on-chain check used to leave no trace there.
  const addLog = (m: string) => {
    attemptLog(m);
    console.log(`${PROOF_TIMING_PREFIX} onchain ${maskLongHex(m)}`);
  };
  if (!parsedProof) {
    addLog('Please generate proof first');
    return false;
  }

  setIsLoading(true);
  setStatus('Verifying proof on-chain...');
  addLog('=== Starting On-Chain Verification ===');

  try {
    // The Android package of a circuit id has its own vk, so its own verifier
    // contract (src/config/variantVerifiers.ts); the address in
    // FALLBACK_VERIFIERS is the iPhone circuit's and rejects every Android
    // proof. A build with no row for the variant is refused by name.
    const artifact = circuitArtifactSource(circuit);
    if (artifact && artifact.variant !== 'app_attest') {
      let variantVerifier: {address: string; chainId: number} | null;
      try {
        variantVerifier = verifierForProof(circuit, wireSignerVariant(artifact.variant));
      } catch (e) {
        addLog(`[OnChain] ${circuit} (${artifact.remoteFileName}): ${e instanceof Error ? e.message : String(e)}`);
        setStatus('Verification unavailable');
        return false;
      }
      if (!variantVerifier) throw new Error(`No ${artifact.variant} verifier resolved for ${circuit}`);
      const net = getNetworkConfigForCircuit(circuit);
      addLog(`[OnChain] Circuit: ${circuit} (${artifact.remoteFileName})`);
      addLog(`[OnChain] Contract: ${variantVerifier.address}`);
      addLog(`[OnChain] Chain: ${net.name} (${net.chainId})`);
      const startedAt = Date.now();
      addLog(`[OnChain] Proof: ${parsedProof.proofHex.length} hex chars, ${parsedProof.publicInputsHex.length} public inputs`);
      // core's pinned contract for this package, chosen by signerVariant: a
      // contract named without it is read as the standard package's, and core
      // refuses an Android-length proof there before asking anything.
      const r = await timed('onchain verify', () =>
        askVerifier(
          circuit,
          parsedProof,
          new ethers.providers.JsonRpcProvider(net.rpcUrl),
          wireSignerVariant(artifact.variant),
          {verifierAddress: variantVerifier!.address, chainId: variantVerifier!.chainId},
          addLog,
        ),
      );
      if (r.error !== undefined) {
        addLog(`On-chain verification error: ${r.error}`);
        logOnChainErrorHint(r.error, addLog);
        setStatus('Error: on-chain verification failed');
        return false;
      }
      addLog(`[OnChain] Verification time: ${Date.now() - startedAt}ms`);
      addLog(`[OnChain] Result: ${r.valid ? 'VALID ✓' : 'INVALID ✗'}`);
      setStatus(r.valid ? 'Proof verified on-chain!' : 'Proof invalid (on-chain)');
      return r.valid;
    }
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
    // the one every dApp on core 0.2.0+ calls -- Coinbase KYC v2 included
    // since core 0.4.0-beta.1. The address the app resolved (cache or
    // fallback) goes in as what the app CLAIMS: when it differs, core
    // refuses, and the phone learns the same answer the dApp will give
    // instead of a "valid" from a contract nobody else checks. (An Android
    // proof took the branch above: its package has its own contract.)
    const result = await timed('onchain verify', () =>
      askVerifier(circuit, parsedProof, provider, 'standard', {verifierAddress, chainId: network.chainId}, addLog),
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
