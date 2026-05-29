/**
 * useMdlKr — Korea Mobile ID (web2) attestation flow.
 *
 * Three Noir circuits — `mdl_kr_ownership`, `mdl_kr_age`, `mdl_kr_region`
 * — each enforcing a single predicate but sharing the same canonical
 * natural-person commitment. The hook is instantiated with one of these
 * variants and produces a proof + verifier address tailored to it.
 *
 * Flow:
 *   1. Drive the OmniOne CX 4-stage API (token -> deep link -> result -> parse)
 *   2. Build variant-specific circuit inputs (utils/mdlKr.ts)
 *   3. Generate a Noir proof via mopro-ffi
 *   4. Verify off-chain and (optionally) on-chain against Base Sepolia
 *
 * No defaults are filled in for safety-critical inputs (targetRegion,
 * ageThreshold, discloseFlags): the caller must supply them, otherwise
 * the call throws. This avoids the previous "silently extract region
 * from OmniOne address" footgun where every region passed verification.
 */
import {useCallback, useRef, useState} from 'react';
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
  clearProofCache,
  ensureStorageAvailable,
  loadVkFromAssets,
  downloadCircuitFiles,
  allCircuitFilesExist,
} from '../utils';
import {
  prepareMdlKrOwnershipInputs,
  prepareMdlKrAgeInputs,
  prepareMdlKrRegionInputs,
  flattenMdlKrOwnershipInputs,
  flattenMdlKrAgeInputs,
  flattenMdlKrRegionInputs,
  MDL_KR_CIRCUIT_NAMES,
  DISCLOSE_NAME,
  DISCLOSE_BIRTH,
  DISCLOSE_SEX,
  DISCLOSE_TELNO,
  type MdlKrVariant,
  type MdlKrOwnershipInputs,
  type MdlKrAgeInputs,
  type MdlKrRegionInputs,
  type OmniOneCxData,
} from '../utils/mdlKr';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  runAppAuthFlow,
  type OacxProvider,
  type OacxParsedToken,
} from '../utils/oacxClient';
import * as oacxResultBus from '../utils/oacxResultBus';
import type {ProofStackParamList} from '../navigation/types';
import {
  getVerifierAddress,
  getVerifierAbi,
  getNetworkConfigForCircuit,
  getEnvironment,
} from '../config';
import type {CircuitName} from '../config/contracts';
import type {ProofStatus} from '../types';
import type {Step} from '../components';

// --------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------

export interface MdlKrOwnershipProofInputs {
  variant: 'ownership';
  provider: OacxProvider;
  scopeString: string;
  /** Bitmask 0x00..0x0F (DISCLOSE_NAME|BIRTH|SEX|TELNO). 0 = anonymous. */
  discloseFlags: number;
  /** Expected name (user-typed or dApp-supplied). Defaults to mDL name. */
  expectedName?: string;
  /** Expected birth_date "YYYYMMDD". */
  expectedBirth?: string;
  /** Expected sex char ('M' / 'F' / ''). */
  expectedSex?: string;
  /** Expected telno digits. */
  expectedTelno?: string;
}

export interface MdlKrAgeProofInputs {
  variant: 'age';
  provider: OacxProvider;
  scopeString: string;
  /** Minimum age the circuit enforces. */
  ageThreshold: number;
  /** Optional explicit current_year; defaults to current calendar year. */
  currentYear?: number;
}

export interface MdlKrRegionProofInputs {
  variant: 'region';
  provider: OacxProvider;
  scopeString: string;
  /** Required: dApp-chosen si/do (e.g., "경기도"). No fallback. */
  targetRegion: string;
}

export type MdlKrProofInputs =
  | MdlKrOwnershipProofInputs
  | MdlKrAgeProofInputs
  | MdlKrRegionProofInputs;

export type AnyMdlKrCircuitInputs =
  | MdlKrOwnershipInputs
  | MdlKrAgeInputs
  | MdlKrRegionInputs;

export interface ParsedProofData {
  proofHex: string;
  publicInputsHex: string[];
  numPublicInputs: number;
}

export interface UseMdlKrReturn {
  status: ProofStatus;
  isLoading: boolean;
  vk: ArrayBuffer | null;
  proof: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
  cxData: OacxParsedToken | null;
  circuitInputs: AnyMdlKrCircuitInputs | null;
  proofSteps: Step[];
  generateProofWithSteps: (
    inputs: MdlKrProofInputs,
    addLog: (msg: string) => void,
  ) => Promise<void>;
  verifyProofOffChain: (addLog: (msg: string) => void) => Promise<boolean>;
  verifyProofOnChain: (addLog: (msg: string) => void) => Promise<boolean>;
  resetSteps: () => void;
  resetProofCache: () => void;
}

const INITIAL_PROOF_STEPS: Step[] = [
  {id: 'vk', label: 'Load Verification Key', status: 'pending'},
  {id: 'oacx', label: 'OmniOne CX 4-stage authentication (App2App)', status: 'pending'},
  {id: 'inputs', label: 'Prepare Korea mDL circuit inputs', status: 'pending'},
  {id: 'storage', label: 'Check storage availability', status: 'pending'},
  {id: 'proof', label: 'Generate ZK proof', status: 'pending'},
  {id: 'parse', label: 'Parse proof (extract public inputs)', status: 'pending'},
  {id: 'cleanup', label: 'Clean up cache', status: 'pending'},
];

// Module-level proof cache per variant. The previous design kept the
// vk/proof in a useRef on the hook instance, but ProofCompleteScreen
// instantiates a *new* `useMdlKr` after navigation, so a per-instance
// cache lost the just-generated proof and the verify calls fell back
// to the wrong (Coinbase) hook entirely. Module scope is fine here
// because the data is non-secret and bounded to a single user session.
interface MdlKrCache {
  vk: ArrayBuffer | null;
  fullProof: ArrayBuffer | null;
  parsedProof: ParsedProofData | null;
}
const moduleCaches: Record<MdlKrVariant, MdlKrCache> = {
  ownership: {vk: null, fullProof: null, parsedProof: null},
  age:       {vk: null, fullProof: null, parsedProof: null},
  region:    {vk: null, fullProof: null, parsedProof: null},
};

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

type ProofNavigation = NativeStackNavigationProp<ProofStackParamList>;

export const useMdlKr = (variant: MdlKrVariant): UseMdlKrReturn => {
  const CIRCUIT_NAME = MDL_KR_CIRCUIT_NAMES[variant];
  const navigation = useNavigation<ProofNavigation>();

  const [status, setStatus] = useState<ProofStatus>('Ready');
  const [isLoading, setIsLoading] = useState(false);
  const [vk, setVk] = useState<ArrayBuffer | null>(null);
  const [proof, setProof] = useState<ArrayBuffer | null>(null);
  const [fullProof, setFullProof] = useState<ArrayBuffer | null>(null);
  const [parsedProof, setParsedProof] = useState<ParsedProofData | null>(null);
  const [cxData, setCxData] = useState<OacxParsedToken | null>(null);
  const [circuitInputs, setCircuitInputs] = useState<AnyMdlKrCircuitInputs | null>(null);
  const [proofSteps, setProofSteps] = useState<Step[]>(INITIAL_PROOF_STEPS);

  const isRunningRef = useRef(false);

  const updateStep = useCallback((stepId: string, updates: Partial<Step>) => {
    setProofSteps((prev) =>
      prev.map((step) => (step.id === stepId ? {...step, ...updates} : step)),
    );
  }, []);

  const resetSteps = useCallback(() => {
    setProofSteps(INITIAL_PROOF_STEPS);
    setParsedProof(null);
  }, []);

  const generateProofWithSteps = useCallback(
    async (
      inputs: MdlKrProofInputs,
      addLog: (msg: string) => void,
    ) => {
      if (inputs.variant !== variant) {
        throw new Error(
          `useMdlKr(${variant}) cannot run inputs.variant=${inputs.variant}`,
        );
      }
      if (isRunningRef.current) {
        addLog('mDL flow already in progress');
        return;
      }
      isRunningRef.current = true;
      setIsLoading(true);
      setStatus('Generating proof...');
      resetSteps();
      addLog(`=== Starting Korea mDL Proof Generation (${variant}) ===`);

      let currentVk: ArrayBuffer | null = null;
      let currentProof: ArrayBuffer | null = null;
      let parsedCx: OacxParsedToken | null = null;

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
        const vkStart = Date.now();
        currentVk = await loadVkFromAssets(CIRCUIT_NAME, addLog);
        const vkElapsed = Date.now() - vkStart;
        setVk(currentVk);
        moduleCaches[variant].vk = currentVk;
        updateStep('vk', {
          status: 'completed',
          detail: `${currentVk.byteLength} bytes (${vkElapsed}ms)`,
        });

        // Step 2: OmniOne CX authentication via WebView widget.
        // Navigates to OacxWebViewScreen which loads the RAON standard widget.
        // The screen resolves via OacxResultBus. If the WebView fails (e.g.,
        // RAON RP origin not registered yet), falls back to the raw 4-stage
        // HTTP path (oacxClient.ts::runAppAuthFlow).
        updateStep('oacx', {status: 'in_progress'});
        const oacxStart = Date.now();
        try {
          addLog('OACX — navigating to WebView widget...');
          const resultPromise = oacxResultBus.awaitNextResult(5 * 60 * 1000);
          navigation.navigate('OacxWebView', {
            provider: inputs.provider,
            scope: inputs.scopeString,
          });
          const busResult = await resultPromise;
          if (busResult.ok) {
            parsedCx = busResult.payload;
            addLog('OACX WebView succeeded');
          } else {
            addLog(`OACX WebView failed (${busResult.error}), falling back to raw API path...`);
            parsedCx = await runAppAuthFlow({
              provider: inputs.provider,
              ci: true,
              telno: true,
              onLog: addLog,
            });
          }
        } catch (webViewErr) {
          const msg = webViewErr instanceof Error ? webViewErr.message : String(webViewErr);
          addLog(`OACX WebView error (${msg}), falling back to raw API path...`);
          parsedCx = await runAppAuthFlow({
            provider: inputs.provider,
            ci: true,
            telno: true,
            onLog: addLog,
          });
        }
        const oacxElapsed = Date.now() - oacxStart;
        setCxData(parsedCx);
        updateStep('oacx', {
          status: 'completed',
          detail: `name=${parsedCx.data.name}, vc=${parsedCx.data.vcTypeCode} (${oacxElapsed}ms)`,
        });

        // Step 3: Prepare circuit inputs
        updateStep('inputs', {status: 'in_progress'});
        // v4: OmniOneCxData no longer includes jti/pri (HS256 path dormant).
        // TODO(HS256): Re-add jti/pri when RAON RP registration is complete.
        const cxRaw: OmniOneCxData = {
          ci: parsedCx.data.ci,
          name: parsedCx.data.name,
          birth: parsedCx.data.birth,
          telno: parsedCx.data.telno,
          sex: parsedCx.data.sex,
          address: parsedCx.data.address,
        };

        let prepared: AnyMdlKrCircuitInputs;
        let flat: string[];
        let detail: string;
        switch (inputs.variant) {
          case 'ownership': {
            const p = prepareMdlKrOwnershipInputs(cxRaw, {
              scopeString: inputs.scopeString,
              discloseFlags: inputs.discloseFlags,
              expectedName:  inputs.expectedName,
              expectedBirth: inputs.expectedBirth,
              expectedSex:   inputs.expectedSex,
              expectedTelno: inputs.expectedTelno,
            });
            prepared = p;
            flat = flattenMdlKrOwnershipInputs(p);
            detail = `flags=0x${(inputs.discloseFlags & 0x0f).toString(16).padStart(2, '0')}, ${flat.length} fields`;
            break;
          }
          case 'age': {
            const currYear = inputs.currentYear ?? new Date().getFullYear();
            const p = prepareMdlKrAgeInputs(cxRaw, {
              scopeString: inputs.scopeString,
              ageThreshold: inputs.ageThreshold,
              currentYear: currYear,
            });
            prepared = p;
            flat = flattenMdlKrAgeInputs(p);
            detail = `age_threshold=${inputs.ageThreshold}, current_year=${currYear}, ${flat.length} fields`;
            break;
          }
          case 'region': {
            const p = prepareMdlKrRegionInputs(cxRaw, {
              scopeString: inputs.scopeString,
              targetRegion: inputs.targetRegion,
            });
            prepared = p;
            flat = flattenMdlKrRegionInputs(p);
            detail = `target_region="${inputs.targetRegion}", ${flat.length} fields`;
            break;
          }
        }
        setCircuitInputs(prepared);
        updateStep('inputs', {status: 'completed', detail});

        // Step 4: storage
        updateStep('storage', {status: 'in_progress'});
        const hasSpace = await ensureStorageAvailable(500, addLog);
        if (!hasSpace) {
          throw new Error('Insufficient storage for proof generation');
        }
        updateStep('storage', {status: 'completed', detail: 'OK'});

        // Step 5: prove
        updateStep('proof', {status: 'in_progress'});
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const srsPath = await getAssetPath(`${CIRCUIT_NAME}.srs`);
        const proofStart = Date.now();
        currentProof = generateNoirProof(
          circuitPath,
          srsPath,
          flat,
          true, // onChain
          currentVk,
          true, // lowMemoryMode
        );
        const proofElapsed = Date.now() - proofStart;
        setFullProof(currentProof);
        moduleCaches[variant].fullProof = currentProof;
        updateStep('proof', {
          status: 'completed',
          detail: `${currentProof!.byteLength} bytes (${proofElapsed}ms)`,
        });

        // Step 6: parse
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
        moduleCaches[variant].parsedProof = parsedData;
        setProof(parsed.proof);
        updateStep('parse', {
          status: 'completed',
          detail: `${numPublicInputs} public inputs`,
        });

        // Step 7: cleanup
        updateStep('cleanup', {status: 'in_progress'});
        await clearProofCache(addLog);
        updateStep('cleanup', {status: 'completed', detail: 'Cache cleared'});

        setStatus('Proof ready');
        addLog(`=== Korea mDL (${variant}) Proof Generation Complete ===`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(`Error: ${msg}`);
        setStatus('Error generating proof');
        setProofSteps((prev) =>
          prev.map((step) =>
            step.status === 'in_progress'
              ? {...step, status: 'error', detail: msg}
              : step,
          ),
        );
      } finally {
        isRunningRef.current = false;
        setIsLoading(false);
      }
    },
    [CIRCUIT_NAME, navigation, resetSteps, updateStep, variant],
  );

  const verifyProofOffChain = useCallback(
    async (addLog: (msg: string) => void): Promise<boolean> => {
      const useVk = vk || moduleCaches[variant].vk;
      const useFullProof = fullProof || moduleCaches[variant].fullProof;
      if (!useVk || !useFullProof) {
        addLog('Please generate proof first');
        return false;
      }
      setIsLoading(true);
      setStatus('Verifying proof...');
      try {
        const circuitPath = await getAssetPath(`${CIRCUIT_NAME}.json`);
        const start = Date.now();
        const isValid = verifyNoirProof(circuitPath, useFullProof, true, useVk, true);
        const elapsed = Date.now() - start;
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
    [CIRCUIT_NAME, vk, fullProof],
  );

  const verifyProofOnChain = useCallback(
    async (addLog: (msg: string) => void): Promise<boolean> => {
      const useParsed = parsedProof || moduleCaches[variant].parsedProof;
      if (!useParsed) {
        addLog('Please generate proof first');
        return false;
      }
      setIsLoading(true);
      setStatus('Verifying proof on-chain...');
      try {
        const verifierAddress = await getVerifierAddress(CIRCUIT_NAME as CircuitName);
        if (!verifierAddress) {
          addLog(`[OnChain] Verifier address empty — check FALLBACK_VERIFIERS.${CIRCUIT_NAME}`);
          setStatus('Verification unavailable');
          return false;
        }
        const network = getNetworkConfigForCircuit(CIRCUIT_NAME as CircuitName);
        addLog(`[OnChain] Verifier: ${verifierAddress}`);
        addLog(`[OnChain] Chain: ${network.name} (${network.chainId})`);

        const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
        const contract = new ethers.Contract(
          verifierAddress,
          getVerifierAbi(),
          provider,
        );

        const start = Date.now();
        const isValid = await contract.verify(
          useParsed.proofHex,
          useParsed.publicInputsHex,
        );
        const elapsed = Date.now() - start;
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
    [CIRCUIT_NAME, parsedProof],
  );

  const resetProofCache = useCallback(() => {
    moduleCaches[variant] = {vk: null, fullProof: null, parsedProof: null};
    setVk(null);
    setFullProof(null);
    setParsedProof(null);
    setProof(null);
    setCxData(null);
    setCircuitInputs(null);
    resetSteps();
  }, [resetSteps]);

  return {
    status,
    isLoading,
    vk,
    proof,
    fullProof,
    parsedProof,
    cxData,
    circuitInputs,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
    resetSteps,
    resetProofCache,
  };
};

// Re-export disclosure-flag bit constants so screens can use them directly.
export {DISCLOSE_NAME, DISCLOSE_BIRTH, DISCLOSE_SEX, DISCLOSE_TELNO};
