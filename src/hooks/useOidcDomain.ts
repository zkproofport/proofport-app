import {useState, useCallback} from 'react';
import {
  getNumPublicInputsFromCircuit,
  parseProofWithPublicInputs,
  type ProofWithPublicInputs,
} from 'mopro-ffi';
import {circuitFilesForProof, proveCircuit, timerFor} from '../utils/proofRun';
import {verifyProofOffChainWithMopro, verifyProofOnChainWithCore} from '../utils/proofVerification';
import {
  getAssetPath,
  arrayBufferToHex,
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
  circuitAbiParameterNames,
} from '../utils';
import {type CircuitName} from '../config';
import {currentSignerVariant, wireSignerVariant, type WireSignerVariant} from '../config/signerPlatform';
import {prepareOidcInputs, flattenOidcInputs, OIDC_PUBLIC_INPUT_COUNT, requireOidcAbi} from '../utils/oidcDomain';
import {AppAttestError} from '../appAttest/appAttestError';
import {requireVerifierForVariant} from '../utils/proofSignerVariant';
import {OidcProviderKeyError} from '../oidc/providerKeyStatement';
import type {ProviderKeySigner} from '../oidc/oidcAppSigner';
import type {ErrorCode} from '../constants/errorCodes';
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
  domain?: string; // Target domain to prove — auto-extracted from JWT email if omitted
  provider?: string; // Workspace provider (e.g., 'google') — when set, verifies org membership via hd claim
  /**
   * The nonce this request signed in with (64 lowercase hex, oidcNonce.ts).
   * The circuit binds the token to it (nonce_mode 1, nonce_binding).
   */
  nonce: string;
  /**
   * Signs the provider-key statement with App Attest (prepareOidcAppSigner,
   * made before the sign-in sheet so a phone that cannot sign is refused
   * first). The circuit refuses a proof without the statement.
   */
  providerKeySigner: ProviderKeySigner;
}

export interface ParsedProofData {
  proofHex: string;
  publicInputsHex: string[];
  numPublicInputs: number;
  /** Which package of the circuit id made it (the callback's `signerVariant`). */
  signerVariant: WireSignerVariant;
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
  resetSteps: () => void;
  resetProofCache: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'download', label: 'Download circuit files', status: 'pending'},
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'validate', label: 'Validate JWT token', status: 'pending'},
  {id: 'jwks', label: 'Check the provider key and sign it on this device', status: 'pending'},
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

      if (!inputs.nonce) {
        addLog('The request nonce is required');
        return;
      }

      if (typeof inputs.providerKeySigner !== 'function') {
        addLog('The provider-key signer is required');
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
        // Step 1: Circuit files. Always through downloadCircuitFiles: it owns
        // the cache check (the pinned circuits ref and the data version are
        // the key) and fetches only what is stale, so files from an older
        // circuit on this phone are replaced rather than proved with.
        updateStep('download', {status: 'in_progress'});
        // An Android proof verifies only on its package's own contract; with
        // none in this build it could not be checked by anyone (E2018) --
        // refused before any file is fetched.
        const signerVariant = currentSignerVariant();
        requireVerifierForVariant(CIRCUIT_NAME, signerVariant);
        addLog('Step 1: Checking circuit files...');
        await circuitFilesForProof(CIRCUIT_NAME, addLog);

        // These inputs are for one circuit: 214 public inputs and this
        // phone's provider-key signer after them (App Attest on iPhone,
        // Android key attestation on Android -- two circuits under this id).
        // An older file set (148 inputs, or 214 without the signer) or the
        // other platform's would fail inside the prover with a witness error
        // that names nothing -- and only after the device had signed.
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);
        const timer = timerFor(CIRCUIT_NAME, addLog);
        const circuitPublicInputs = await timer.step('circuit public input count', () => getNumPublicInputsFromCircuit(circuitPath));
        if (circuitPublicInputs !== OIDC_PUBLIC_INPUT_COUNT) {
          throw new Error(
            `The downloaded ${CIRCUIT_NAME} circuit has ${circuitPublicInputs} public inputs; ` +
              `this app builds inputs for ${OIDC_PUBLIC_INPUT_COUNT} (OIDC v2). Delete the circuit files and download them again.`,
          );
        }
        requireOidcAbi(await timer.step('circuit ABI check', () => circuitAbiParameterNames(CIRCUIT_NAME)), signerVariant);
        updateStep('download', {status: 'completed', detail: `${circuitPublicInputs} public inputs`});

        // Step 2: Load VK
        updateStep('vk', {status: 'in_progress'});
        addLog('Step 2: Loading verification key...');

        const vkStartTime = Date.now();
        currentVk = await timer.step('load vk', () => loadVkFromAssets(CIRCUIT_NAME, addLog));
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

        // Decode payload to check email_verified and hd
        const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(payloadB64));

        // Auto-extract domain from JWT email if not provided
        let domain = inputs.domain;
        if (!domain && payload.email) {
          domain = (payload.email as string).split('@')[1];
          addLog(`[JWT] Domain auto-extracted from email: ${domain}`);
        }
        if (!domain) {
          throw new Error('Domain could not be determined: no domain input and no email claim in JWT');
        }

        // Provider-specific email verification and organization validation
        if (inputs.provider === 'microsoft') {
          // Log Microsoft JWT claims for debugging
          addLog(`[JWT] Microsoft claims: tid=${payload.tid}, email=${payload.email}, xms_edov=${payload.xms_edov}, preferred_username=${payload.preferred_username}`);

          // Microsoft 365: email_verified claim does NOT exist.
          // Use xms_edov (email domain owner verified) as alternative.
          // No exceptions: every Microsoft account must present xms_edov=true.
          if (!payload.xms_edov) {
            throw new Error('Email domain is not verified by Microsoft 365. Only verified organizational accounts can generate proofs.');
          }
          addLog(`[JWT] xms_edov: true (Microsoft email domain owner verified)`);

          // tid = Tenant ID — present only for organizational accounts
          if (!payload.tid) {
            throw new Error('This is not a Microsoft organizational account. Organization membership verification requires a Microsoft 365 (work/school) account.');
          }
          // Verify email domain matches requested domain
          if (!payload.email) {
            throw new Error('Microsoft JWT does not contain email claim. Configure "email" as an optional claim in Azure AD App Registration > Token configuration.');
          }
          const emailDomain = (payload.email as string).split('@')[1];
          if (inputs.domain && emailDomain !== domain) {
            throw new Error(`Microsoft 365 domain mismatch: account email domain is "${emailDomain}" but proof is for "${domain}"`);
          }
          addLog(`[JWT] Microsoft 365 verified: tid=${payload.tid}, domain=${emailDomain}`);
        } else if (inputs.provider === 'google') {
          if (!payload.email_verified) {
            throw new Error('Email is not verified. Only verified email accounts can generate proofs.');
          }
          addLog(`[JWT] email_verified: true`);

          if (!payload.hd) {
            throw new Error('This account is not a Google Workspace account. Organization membership verification requires a Workspace account.');
          }
          if (inputs.domain && payload.hd !== domain) {
            throw new Error(`Google Workspace domain mismatch: account belongs to "${payload.hd}" but proof is for "${domain}"`);
          }
          // Verify email domain matches hd
          const emailDomain = (payload.email as string).split('@')[1];
          if (emailDomain !== payload.hd) {
            throw new Error(`Email domain "${emailDomain}" does not match Workspace domain "${payload.hd}"`);
          }
          addLog(`[JWT] Google Workspace verified: hd=${payload.hd}`);
        } else {
          // Generic provider (no provider specified) — standard email_verified check
          if (!payload.email_verified) {
            throw new Error('Email is not verified. Only verified email accounts can generate proofs.');
          }
          addLog(`[JWT] email_verified: true`);
        }

        addLog('[JWT] Token validated');
        addLog(`[JWT] Target domain: ${domain}`);
        const providerLabel = inputs.provider === 'microsoft' ? 'Entra ID' : inputs.provider === 'google' ? 'Workspace' : null;
        updateStep('validate', {status: 'completed', detail: providerLabel ? `${providerLabel}: ${domain}` : `JWT valid (${domain})`});

        // Step 3: Fetch the provider's key list, prepare circuit inputs and
        // sign the provider-key statement. prepareOidcInputs handles: the live
        // key list, RSA limbs, partial SHA-256, domain, scope/nullifier, and
        // last the App Attest signature over (provider, now, modulus).
        updateStep('jwks', {status: 'in_progress'});
        addLog('Step 3: Fetching the provider key list and signing the provider key...');

        const inputsStartTime = Date.now();
        const circuitInputs = await timer.step('oidc inputs (provider keys + device signature)', () => prepareOidcInputs({
          jwt: inputs.jwtToken,
          scope: inputs.scopeString,
          domain,
          provider: inputs.provider as 'google' | 'microsoft' | undefined,
          nonce: inputs.nonce,
          clockSeconds: Math.floor(Date.now() / 1000),
          signProviderKey: inputs.providerKeySigner,
        }));
        const inputsElapsed = Date.now() - inputsStartTime;

        addLog(`[JWKS] Provider key found in the live list, statement signed (${inputsElapsed}ms)`);
        updateStep('jwks', {
          status: 'completed',
          detail: `Provider key signed (${inputsElapsed}ms)`,
        });

        // Step 4: Flatten inputs for mopro
        updateStep('inputs', {status: 'in_progress'});
        addLog('Step 4: Preparing circuit inputs...');

        const flatInputs = await timer.step('flatten inputs', () => flattenOidcInputs(circuitInputs));
        addLog(`[Inputs] Domain: ${domain}${!inputs.domain ? ' (auto-extracted)' : ''}`);
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
        addLog(`[Inputs] nonce_mode: ${circuitInputs.nonce_mode}, now: ${circuitInputs.now}`);
        addLog(`[Inputs] Statement signer: ${signerVariant}`);
        updateStep('inputs', {
          status: 'completed',
          detail: `${flatInputs.length} input values`,
        });

        // Step 5: Check storage
        updateStep('storage', {status: 'in_progress'});
        addLog('Step 5: Checking storage availability...');

        const hasSpace = await timer.step('storage check', () => ensureStorageAvailable(500, addLog));
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

        addLog('[Proof] Starting Noir proof generation off the JS thread...');
        const proofStartTime = Date.now();
        currentProof = await proveCircuit({circuit: CIRCUIT_NAME, variant: signerVariant, circuitPath, srsPath, inputs: flatInputs, vk: currentVk, log: addLog});
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

        const numPublicInputs = circuitPublicInputs;
        addLog(`[Parse] Number of public inputs: ${numPublicInputs}`);
        const proofBytes = currentProof;
        const parsed: ProofWithPublicInputs = await timer.step('parse proof', () =>
          parseProofWithPublicInputs(proofBytes, numPublicInputs),
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
          signerVariant: wireSignerVariant(signerVariant),
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

        // Device-signer and provider-key failures carry their own modal code
        // (E2009 / E2014 / E2015 / E2016 / E3006 / E3002 / E2008); the screen uses it
        // instead of the step's generic one.
        const code: ErrorCode | undefined =
          error instanceof AppAttestError || error instanceof OidcProviderKeyError ? error.code : undefined;
        setProofSteps(prev =>
          prev.map(step =>
            step.status === 'in_progress' ? {...step, status: 'error', detail: errorMessage, ...(code ? {code} : {})} : step,
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
      verifyProofOffChainWithMopro(CIRCUIT_NAME, vk || _cachedVk, fullProof || _cachedFullProof, {addLog, setStatus, setIsLoading}),
    [vk, fullProof],
  );

  /**
   * Verify proof on-chain using the deployed Verifier contract
   */
  const verifyProofOnChain = useCallback(
    async (circuit: CircuitName, addLog: (msg: string) => void): Promise<boolean> => {
      if (circuit !== 'oidc_domain_attestation') {
        throw new Error(
          `This hook proves oidc_domain_attestation; it was asked to verify '${circuit}'.`,
        );
      }
      return verifyProofOnChainWithCore(circuit, parsedProof || _cachedParsedProof, {addLog, setStatus, setIsLoading});
    },
    [parsedProof],
  );

  return {
    status,
    isLoading,
    vk,
    fullProof,
    // Return the live `parsedProof` state only. Falling back to the
    // module-level cache here would make a fresh hook consumer see a stale
    // proof from a previous run, which races ProofGeneration's "navigate to
    // ProofComplete" effect.
    parsedProof,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    resetSteps,
    resetProofCache,
  };
};
