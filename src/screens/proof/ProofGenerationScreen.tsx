import {captureHistoryReview} from '../../utils/historyReview';
import {historyDisplay} from '../../utils/historyDisplay';
import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {
  Button,
  Card,
  StepIndicator,
  LiveLogsPanel,
  type StepData,
} from '../../components/ui';
import {useCoinbaseKyc, useCoinbaseCountry, useOidcDomain, useGiwaKyc, useDojangPlayground, useGoogleAuth, useMicrosoftAuth, useWallet, useLogs, useDeepLink, useSettings} from '../../hooks';
import {useCircuitWalletGate} from '../../hooks/useCircuitWalletGate';
import {findAttestationTransaction, findGiwaAttestationTransaction, findDojangPlaygroundIssuance, DojangIssuanceError, SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY, computeScope, nullifierForCircuit} from '../../utils';
import type {TypedAction} from '../../utils/typedAction';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {proofHistoryStore, settingsStore} from '../../stores';
import {getCircuitWallet, walletGroupKey} from '../../stores/circuitWalletStore';
// `getNetworkConfig` is deliberately absent: this screen always resolves the
// network PER CIRCUIT (GIWA is on chain 91342, the Coinbase verifiers on
// Base), so the environment default would be the wrong answer. It was
// imported and unused before this change; lint has been reporting it.
import {getVerifierAddressSync, getNetworkConfigForCircuit, canonicalCircuitId, type CircuitName} from '../../config';
import {getCircuitDisplayName} from '../../utils/circuit';
// Wallet-cache logic now lives in useCircuitWalletGate.
import type {CoinbaseKycInputs, CoinbaseCountryInputs} from '../../utils/deeplink';
import {ethers} from 'ethers';
import {clearActiveProofRequest} from '../../stores/activeProofRequestStore';
import {DETAILS_STAY_IN_LOGS, ErrorCodes, type ErrorCode} from '../../constants/errorCodes';
import {showGlobalError} from '../../utils/errorBridge';
import {isRelayRequestAnswered} from '../../utils/relayAnswer';
import {rejectedInWallet} from '../../utils/walletRejection';
import {AppAttestError} from '../../appAttest/appAttestError';
import {prepareCoinbaseKycStatement, type CoinbaseStatementWitness} from '../../appAttest/coinbaseKycStatement';
import {proofSignerVariant, verifierForProof} from '../../utils/proofSignerVariant';

import {newStandaloneRequestId} from '../../oidc/oidcNonce';
import {prepareOidcAppSigner, type ProviderKeySigner} from '../../oidc/oidcAppSigner';
import {oidcBindingFor, signInBound, signInProviderFor, type OidcBinding, type OidcSignInProvider} from '../../oidc/oidcSignIn';
import {proofLogEnabled, proofLogText} from '../../utils/proofLog';
import {describeIdTokenClaims} from '../../utils/idTokenClaims';
import {AppState} from 'react-native';
import {deviceProfile, setActiveProofTimer, startProofTimer, timed, type ProofTimer} from '../../utils/proofTiming';
import {getProofProgress, resetProofProgress, updateProofProgress} from '../../utils/proofProgress';
import {clearProofInFlight, markProofInFlight} from '../../utils/proofInFlight';
import {claimGenerationScreen, markGenerationScreenBusy, markGenerationScreenIdle, releaseGenerationScreen} from '../../stores/generationScreenStore';
import {markOpenRequestProving} from '../../utils/relayAnswer';
import {ProofProgressCard} from '../../components/ProofProgressCard';

type ProofGenerationRouteProp = RouteProp<ProofStackParamList, 'ProofGeneration'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofGeneration'>;

/**
 * EVERY CIRCUIT THIS SCREEN SERVES. AN ID THAT IS NOT HERE IS AN ERROR.
 *
 * This used to be a chain of equality checks with no final branch, opened by
 *
 *     const circuitId = route.params?.circuitId || 'coinbase-kyc';
 *
 * so a request that named no circuit, or named one this screen did not
 * recognise, silently generated a COINBASE KYC PROOF instead. The user asked
 * for one thing and the app proved another, with nothing on screen to say so.
 *
 * It had already bitten once: underscore ids were added as aliases because deep
 * links sent a canonical id and the screen answered with a Coinbase proof.
 * Aliasing the ids that were noticed does not fix the shape — the next
 * unrecognised id lands in the same place. The fix is that there IS no default.
 *
 * The screen no longer keeps its own spelling tables. Three of them lived here
 * — display names, id translation, proof variant — each carrying both
 * spellings of every id, and they disagreed: the title block below matched
 * only the hyphenated ids, so a deep link naming a canonical id ran one
 * proof under another proof's heading. Everything is keyed by the canonical id now, and the
 * translation happens once, in `canonicalCircuitId`.
 */
type ProofFlow = 'coinbase' | 'country' | 'oidc' | 'giwa' | 'dojang';

const FLOW_OF_CANONICAL: Record<CircuitName, ProofFlow> = {
  coinbase_attestation: 'coinbase',
  coinbase_country_attestation: 'country',
  oidc_domain_attestation: 'oidc',
  giwa_attestation: 'giwa',
  dojang_playground: 'dojang',
};

/** Title / description i18n keys, keyed canonically so no id can miss them. */
const CIRCUIT_TEXT: Record<CircuitName, {title: string; description: string}> = {
  coinbase_attestation: {
    title: 'host.proof.generation.coinbaseKycTitle',
    description: 'host.proof.generation.coinbaseKycDescription',
  },
  coinbase_country_attestation: {
    title: 'host.proof.generation.coinbaseCountryTitle',
    description: 'host.proof.generation.coinbaseCountryDescription',
  },
  oidc_domain_attestation: {
    title: 'host.proof.generation.oidcTitle',
    description: 'host.proof.generation.oidcDescription',
  },
  giwa_attestation: {
    title: 'host.proof.generation.giwaKycTitle',
    description: 'host.proof.generation.giwaKycDescription',
  },
  dojang_playground: {
    title: 'host.proof.generation.dojangPlaygroundTitle',
    description: 'host.proof.generation.dojangPlaygroundDescription',
  },
};

/**
 * The ErrorModal code a failed hook step is reported under — to the person and,
 * for a relay request, to the dApp (`errorCode`).
 *
 * Keyed by the step ids the proof hooks declare. A step id missing here is
 * caught by `src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts`,
 * which reads every hook's step ids.
 */
type HookStepId =
  | 'vk' | 'download' | 'validate' | 'jwks' | 'signal' | 'sign' | 'pubkey'
  | 'scope' | 'country' | 'inputs' | 'storage' | 'proof' | 'parse' | 'cleanup';

/**
 * The contract shown on the completion screen: the Android package's own for
 * an Android proof, the standard one otherwise. Display only: a proof with no
 * verifier in this build was refused before it got here, and an empty string
 * reads as "verification unavailable".
 */
function completionVerifier(circuit: CircuitName, parsedProof: object): string {
  try {
    const v = verifierForProof(circuit, proofSignerVariant(circuit, parsedProof));
    return v ? v.address : getVerifierAddressSync(circuit);
  } catch (e) {
    console.warn('[Proof] No verifier to show for this proof:', e);
    return '';
  }
}

export const STEP_ERROR_CODE: Record<HookStepId, ErrorCode> = {
  // Loading the key downloads the circuit files when they are missing.
  vk: 'E2002',
  download: 'E2002',
  // The attestation transaction did not check out for this wallet.
  validate: 'E2005',
  jwks: 'E3002',
  signal: 'E2001',
  sign: 'E4002',
  pubkey: 'E2001',
  scope: 'E2001',
  country: 'E2004',
  inputs: 'E2001',
  storage: 'E5001',
  proof: 'E2001',
  parse: 'E2001',
  cleanup: 'E2001',
};

/** Where one flow's step means something else under the same id. */
const FLOW_STEP_ERROR_CODE: Record<ProofFlow, Partial<Record<HookStepId, ErrorCode>>> = {
  coinbase: {},
  country: {},
  // OIDC's `validate` checks the sign-in token, not an attestation.
  oidc: {validate: 'E2008'},
  giwa: {},
  dojang: {},
};

export function errorCodeForStep(flow: ProofFlow, stepId: string): ErrorCode {
  const own = FLOW_STEP_ERROR_CODE[flow];
  if (Object.prototype.hasOwnProperty.call(own, stepId)) {
    return own[stepId as HookStepId] as ErrorCode;
  }
  if (Object.prototype.hasOwnProperty.call(STEP_ERROR_CODE, stepId)) {
    return STEP_ERROR_CODE[stepId as HookStepId];
  }
  // The attempt has ALREADY failed; throwing here would leave the relay
  // request unanswered, which is the defect this table exists to close. The
  // generic proof code is sent and the unknown id is logged loudly. The test
  // named above fails before a new step id can reach this line.
  console.error(`[ProofGeneration] No error code for step '${stepId}' in flow '${flow}'. Known: ${Object.keys(STEP_ERROR_CODE).join(', ')}.`);
  return 'E2001';
}

const ProgressButton: React.FC<{
  progress: number; // 0 to 1
  label: string;
  height?: number;
}> = ({progress, label, height = 52}) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      }),
    ).start();
  }, [shimmerAnim]);

  const shimmerTranslateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 400],
  });

  return (
    <View style={[progressStyles.container, {height}]}>
      {/* Background (unfilled) */}
      <View style={progressStyles.unfilled} />
      {/* Filled portion */}
      <View style={[progressStyles.filled, {width: `${Math.max(progress * 100, 5)}%`}]}>
        {/* Shimmer overlay */}
        <Animated.View
          style={[
            progressStyles.shimmer,
            {transform: [{translateX: shimmerTranslateX}]},
          ]}>
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.3)', 'transparent']}
            start={{x: 0, y: 0.5}}
            end={{x: 1, y: 0.5}}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
      {/* Text label on top */}
      <View style={progressStyles.labelContainer}>
        <Text style={progressStyles.label}>{label}</Text>
      </View>
    </View>
  );
};

const progressStyles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  unfilled: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#94A3B8',
  },
  filled: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#3B82F6',
    borderRadius: 0,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 200,
  },
  labelContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

/** Step ids with a label under host.proof.generation.steps in every locale. */
const TRANSLATED_STEP_IDS: ReadonlySet<string> = new Set([
  'google', 'download', 'vk', 'validate', 'jwks', 'inputs', 'storage', 'proof', 'parse', 'cleanup',
  'wallet', 'attestation', 'transaction', 'signer', 'signing',
]);

const toUserSteps = (
  hookSteps: Array<{id: string; label: string; status: string}>,
  walletConnected: boolean,
  searching: boolean,
): StepData[] => {
  const steps: StepData[] = [
    {id: 'wallet', label: 'Wallet connected', status: walletConnected ? 'complete' : 'pending', icon: 'credit-card'},
    {id: 'attestation', label: 'Fetching attestation', status: searching ? 'active' : 'pending', icon: 'search'},
    {id: 'transaction', label: 'Fetching raw transaction', status: 'pending', icon: 'download'},
    {id: 'signer', label: 'Verifying attester signer', status: 'pending', icon: 'shield'},
    {id: 'signing', label: 'Signing dApp challenge', status: 'pending', icon: 'edit-3'},
    {id: 'proof', label: 'Generating ZK proof', status: 'pending', icon: 'cpu'},
  ];

  const map: Record<string, string> = {
    validate: 'attestation', vk: 'transaction', inputs: 'transaction',
    signal: 'signer', pubkey: 'signer', country: 'signer',
    sign: 'signing', storage: 'proof', proof: 'proof', parse: 'proof', cleanup: 'proof',
  };

  for (const hs of hookSteps) {
    const uid = map[hs.id];
    if (!uid) continue;
    const us = steps.find(s => s.id === uid);
    if (!us) continue;
    if (hs.status === 'in_progress') us.status = 'active';
    else if (hs.status === 'completed' && us.status !== 'active') us.status = 'complete';
    else if (hs.status === 'error') us.status = 'error';
  }

  // Find the last active step — earlier active steps become complete
  let lastActiveIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'active') {
      if (lastActiveIdx === -1) {
        lastActiveIdx = i;
      } else {
        steps[i].status = 'complete';
      }
    }
  }

  // Mark all pending steps before the active one as complete
  if (lastActiveIdx > 0) {
    for (let i = 0; i < lastActiveIdx; i++) {
      if (steps[i].status === 'pending') steps[i].status = 'complete';
    }
  }

  return steps;
};

export const ProofGenerationScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const route = useRoute<ProofGenerationRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  // The route owns this attempt. A previous callback may still be pending in
  // the active store, or a newer request may already have replaced it there.
  const proofRequest = route.params?.proofRequest;

  const hasAutoStarted = useRef(false);
  const didResetOnMountRef = useRef(false);
  const proofStartedAt = useRef<number | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const failedMarkedRef = useRef(false);
  // One failure (or cancel) per attempt: the step watcher, the catch and an
  // inline path can all see the same failure.
  const attemptEndedRef = useRef(false);
  const lastErrorStepsRef = useRef<unknown>(null);
  // Whether THIS attempt keeps its log (Developer Mode + live logs), decided
  // from the settings read when the attempt starts.
  const keepLogRef = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);
  // This attempt's [ProofTiming] timer (proofTiming.ts).
  const timerRef = useRef<ProofTimer | null>(null);

  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {logs, addLog, clearLogs, getLatestLogs} = useLogs();
  const {settings} = useSettings();

  // No default. A missing or unrecognised id is refused below, never quietly
  // turned into a Coinbase proof — see the note on FLOW_OF_CANONICAL.
  //
  // `circuitId` is whatever the caller navigated with, which for a deep link
  // minted before the canonical spelling may be a legacy route id. `canonical`
  // is the only form anything below this line looks at.
  const circuitId = route.params?.circuitId ?? '';
  const canonical = canonicalCircuitId(circuitId);
  const flow: ProofFlow | undefined = canonical
    ? FLOW_OF_CANONICAL[canonical]
    : undefined;
  const isCountry = flow === 'country';
  const isOidc = flow === 'oidc';
  const isGiwa = flow === 'giwa';
  const isDojang = flow === 'dojang';
  const oidcProvider = (proofRequest?.inputs as {provider?: string} | undefined)?.provider || route.params?.domainInput?.provider;

  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const oidcHook = useOidcDomain();
  const giwaHook = useGiwaKyc();
  const dojangHook = useDojangPlayground();
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const generateKycProof = kycHook.generateProofWithSteps;
  const generateCountryProof = countryHook.generateProofWithSteps;
  const generateOidcProof = oidcHook.generateProofWithSteps;
  const generateGiwaProof = giwaHook.generateProofWithSteps;
  const generateDojangProof = dojangHook.generateProofWithSteps;
  const googleReady = googleAuth.isReady;
  const microsoftReady = microsoftAuth.isReady;
  const promptGoogleSignIn = googleAuth.promptSignIn;
  const promptMicrosoftSignIn = microsoftAuth.promptSignIn;
  // One row per flow. With no flow the screen refuses the request on arrival
  // (see the E2006 effect below) and drives no hook; the Coinbase hook is only
  // what renders its untouched step list meanwhile.
  const HOOK_OF_FLOW = {
    coinbase: kycHook,
    country: countryHook,
    oidc: oidcHook,
    giwa: giwaHook,
    dojang: dojangHook,
  } satisfies Record<ProofFlow, unknown>;
  const hook = flow ? HOOK_OF_FLOW[flow] : kycHook;

  // Each entry to this screen starts from a clean slate. Without this, the
  // module-level proof caches inside the hooks (kept across navigations to
  // survive ProofComplete → re-verify) would replay the previous proof on
  // the new attempt, racing the "navigate to ProofComplete" effect below.
  if (!didResetOnMountRef.current) {
    didResetOnMountRef.current = true;
    kycHook.resetProofCache();
    countryHook.resetProofCache();
    oidcHook.resetProofCache();
    giwaHook.resetProofCache();
    dojangHook.resetProofCache();
  }

  const {account, isReady: isWalletReady, connect: connectWallet, disconnect: disconnectWallet, getProvider} = useWallet(addLog);
  const walletGate = useCircuitWalletGate({
    account,
    connectWallet,
    disconnectWallet,
    onPending: () => {},
    log: addLog,
  });
  // Hook wrapper objects are rebuilt every render. Depend on the memoized
  // methods so an ordinary render cannot cancel an approved auto-start timer.
  const runWalletGate = walletGate.runGate;
  const recordLookupFailure = walletGate.recordLookupFailure;
  // Track the last `account` we observed; when the gate is in post-picker
  // mode and `account` flips to a new value, we re-fire handleGenerateProof.
  const previousAccountRef = useRef<string | null>(null);
  const {sendProof, sendError, sendCancelled} = useDeepLink();

  // Per-circuit readiness keyed by wallet group: this circuit is "ready" only
  // when its GROUP's bound wallet is the one currently connected. Coinbase KYC
  // and Country share a group, so binding one makes the other ready too.
  const [circuitReady, setCircuitReady] = useState(false);
  useEffect(() => {
    if (isOidc) {
      // OIDC is a web2 flow — no wallet binding, so the circuit is always
      // "ready" without a wallet gate.
      setCircuitReady(true);
      return;
    }
    // An id this build does not serve has no wallet binding to look up, and
    // the effect below refuses it outright.
    if (!canonical) {
      setCircuitReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const bound = await getCircuitWallet(walletGroupKey(canonical));
      if (cancelled) return;
      setCircuitReady(
        !!bound && !!account && bound.toLowerCase() === account.toLowerCase(),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [canonical, account, isOidc]);

  const googleStepStatus = googleAuth.idToken ? 'complete' : 'pending';
  const googleStepLabel = 'Google Sign-In';
  const oidcUserSteps: StepData[] = [
    {id: 'google', label: googleStepLabel, status: googleStepStatus, icon: 'log-in'},
    ...hook.proofSteps.map(s => {
      const status: StepData['status'] =
        s.status === 'in_progress' ? 'active' :
        s.status === 'completed' ? 'complete' :
        s.status === 'error' ? 'error' : 'pending';
      return {
        id: s.id,
        label: s.label,
        status,
        icon: s.id === 'vk' ? 'key' : s.id === 'download' ? 'download' : s.id === 'validate' ? 'check-circle' : s.id === 'jwks' ? 'globe' : s.id === 'proof' ? 'cpu' : s.id === 'storage' ? 'hard-drive' : 'check',
      };
    }),
  ];
  // Shown in the person's language; a step id without a translation keeps
  // the hook's own wording.
  const userSteps = (isOidc ? oidcUserSteps : toUserSteps(hook.proofSteps, circuitReady, isSearching)).map(s =>
    TRANSLATED_STEP_IDS.has(s.id) ? {...s, label: t(`host.proof.generation.steps.${s.id}`)} : s,
  );

  /** The attempt's log for its History record, or nothing when logs are off. */
  const attemptLog = useCallback(
    (): {log?: string} => (keepLogRef.current ? {log: proofLogText(getLatestLogs())} : {}),
    [getLatestLogs],
  );

  /**
   * The attempt is over: the timing summary, the running-proof record
   * removed (a later launch must not report a proof that ended), the screen
   * progress closed. On success the timer stays active so the completion
   * screen's verification is timed under the same attempt.
   */
  const endAttemptTiming = useCallback((outcome: 'proved' | 'failed' | 'cancelled') => {
    const timer = timerRef.current;
    if (timer) timer.note(`attempt end ${outcome} total=${timer.elapsed()}ms`);
    if (outcome !== 'proved') {
      setActiveProofTimer(null);
      timerRef.current = null;
    }
    updateProofProgress({stage: outcome === 'proved' ? 'done' : 'failed'});
    clearProofInFlight().catch(console.error);
    // Nothing runs here any more: a request that arrived meanwhile opens now.
    markGenerationScreenIdle();
  }, []);

  // Mark history as failed (idempotent via ref), with the log up to the failure.
  const markHistoryFailed = useCallback(() => {
    if (failedMarkedRef.current || !historyIdRef.current) return;
    failedMarkedRef.current = true;
    proofHistoryStore.update(historyIdRef.current, {
      overallStatus: 'failed',
      offChainStatus: 'failed',
      onChainStatus: 'failed',
      ...attemptLog(),
    }).catch(console.error);
  }, [attemptLog]);

  /**
   * End this attempt as FAILED: inline text, ErrorModal, History, and — for a
   * relay request — one `error` answer carrying the same code. Every failure
   * path below goes through here; a second call in the same attempt is a
   * no-op, and the responder refuses a second answer for the request anyway.
   */
  const failAttempt = useCallback(
    ({code, error, inline, details}: {code: ErrorCode; error: string; inline?: string; details?: string}) => {
      if (attemptEndedRef.current) return;
      attemptEndedRef.current = true;
      // What the person was shown, so the kept log ends with it.
      addLog(`[Failed] ${code}: ${details ?? error}`);
      endAttemptTiming('failed');
      // A device-check code shows its own neutral text on this screen too; the
      // precise reason stays in the log line above (DETAILS_STAY_IN_LOGS).
      setErrorMessage(DETAILS_STAY_IN_LOGS.has(code) ? t(`host.errors.${code}.description`) : inline ?? error);
      showGlobalError(code, details ?? error);
      markHistoryFailed();
      if (proofRequest) {
        sendError(proofRequest, code, error).catch(console.error);
        clearActiveProofRequest(proofRequest);
      }
    },
    [proofRequest, sendError, markHistoryFailed, addLog, endAttemptTiming, t],
  );

  /** End this attempt because the person declined (sign-in sheet, wallet). */
  const cancelAttempt = useCallback(
    (reason: string) => {
      if (attemptEndedRef.current) return;
      attemptEndedRef.current = true;
      addLog(`[Cancelled] ${reason}`);
      endAttemptTiming('cancelled');
      setErrorMessage(reason);
      markHistoryFailed();
      if (proofRequest) {
        sendCancelled(proofRequest, reason).catch(console.error);
        clearActiveProofRequest(proofRequest);
      }
    },
    [proofRequest, sendCancelled, markHistoryFailed, addLog, endAttemptTiming],
  );

  // CRITICAL: Watch hook's proofSteps for errors.
  // The hooks catch errors internally and don't re-throw,
  // so we detect failure by watching for 'error' step status.
  useEffect(() => {
    const errStep = hook.proofSteps.find(s => s.status === 'error');
    if (!errStep || !flow) return;
    // The same step array is one failure, however often this effect re-runs.
    if (lastErrorStepsRef.current === hook.proofSteps) return;
    lastErrorStepsRef.current = hook.proofSteps;
    const detail = (errStep as {detail?: string}).detail || 'Proof generation failed';
    if (rejectedInWallet(detail)) {
      cancelAttempt(detail);
      return;
    }
    // A cause with its own code (App Attest, the provider key list) wins over
    // the step's generic one.
    failAttempt({code: errStep.code ?? errorCodeForStep(flow, errStep.id), error: detail});
  }, [hook.proofSteps, flow, failAttempt, cancelAttempt]);

  // Leaving the screen before the request was answered — back button, a
  // stack reset, the screen closing — is the person abandoning it. The dApp
  // is told `cancelled` instead of waiting out the relay's timeout.
  const proofRequestRef = useRef(proofRequest);
  proofRequestRef.current = proofRequest;
  const sendCancelledRef = useRef(sendCancelled);
  sendCancelledRef.current = sendCancelled;
  // An accepted relay request is about to start here: hold new reviews. An
  // in-app screen nobody has started holds nothing. Leaving the screen
  // returns the store to its default.
  useEffect(() => {
    const screen = {};
    claimGenerationScreen(screen, proofRequestRef.current !== null && proofRequestRef.current !== undefined);
    return () => releaseGenerationScreen(screen);
  }, []);

  useEffect(() => () => {
    const request = proofRequestRef.current;
    if (!request || isRelayRequestAnswered(request.requestId)) return;
    sendCancelledRef.current(request, 'The user left the proof screen before the proof was finished.')
      .catch(console.error);
    clearActiveProofRequest(request);
  }, []);

  // Handle successful proof → update history + navigate
  // Only navigate to ProofComplete when the parsedProof was produced AFTER
  // we hit "Generate" on THIS screen entry. proofStartedAt is null on mount
  // and set only inside handleGenerateProof, so a stale cached proof from a
  // previous screen entry can't trigger this navigation.
  const parsedProof = hook.parsedProof;
  const signalHash = 'signalHash' in hook ? hook.signalHash : null;
  useEffect(() => {
    if (!parsedProof || !proofStartedAt.current) return;
    // Unreachable without a canonical id — nothing starts a proof without one
    // — but narrowing here keeps the address/network lookups below honest.
    if (!canonical) return;

    const generatedAt = Date.now();
    const resolved: CircuitName = canonical;
    endAttemptTiming('proved');
    const kept = attemptLog();

    if (historyIdRef.current) {
      proofHistoryStore.update(historyIdRef.current, {
        proofHash: parsedProof.proofHex,
        offChainStatus: 'generated',
        onChainStatus: 'generated',
        overallStatus: 'generated',
        ...kept,
      }).catch(console.error);
    }

    if (proofRequest) {
      let signerVariant: ReturnType<typeof proofSignerVariant>;
      let verifierAddress: string;
      try {
        signerVariant = proofSignerVariant(resolved, parsedProof);
        // An Android proof names its package's own contract; with none in
        // this build it is refused (E2018), never sent with the iPhone
        // circuit's address, which rejects it.
        const variantVerifier = verifierForProof(resolved, signerVariant);
        verifierAddress = variantVerifier ? variantVerifier.address : getVerifierAddressSync(resolved);
      } catch (variantError) {
        const msg = variantError instanceof Error ? variantError.message : String(variantError);
        addLog(`Error: ${msg}`);
        failAttempt({code: variantError instanceof AppAttestError ? variantError.code : 'E2016', error: msg});
        return;
      }
      let nullifierHex = '0x' + '00'.repeat(32);
      if (isOidc) {
        // OIDC: nullifier is embedded in public inputs (circuit computes it)
        // No separate computation needed
      } else {
        const inputs = proofRequest.inputs as CoinbaseKycInputs | undefined;
        const scope = inputs?.scope || 'proofport:default';
        const scopeBytes = computeScope(scope);
        // By the circuit's own rule: GIWA and Dojang Playground hash the wallet
        // with the circuit id, the Coinbase pair hash it with signal_hash.
        const nullifierBytes = signalHash
          ? nullifierForCircuit(resolved, account || '', signalHash, scopeBytes)
          : new Uint8Array(32);
        nullifierHex = ethers.utils.hexlify(nullifierBytes);
      }

      const circuitNet = getNetworkConfigForCircuit(resolved);
      const startedAt = proofStartedAt.current;
      timed('relay send', () => sendProof(proofRequest, {
        signerVariant,
        proof: parsedProof.proofHex,
        publicInputs: parsedProof.publicInputsHex,
        numPublicInputs: parsedProof.numPublicInputs,
        nullifier: nullifierHex,
        verificationType: 'off-chain',
        verificationResult: false,
        startedAt,
        completedAt: generatedAt,
        verifierAddress,
        chainId: circuitNet.chainId,
      })).then(() => clearActiveProofRequest(proofRequest)).catch(console.error);
    }

    const circuitNet = getNetworkConfigForCircuit(resolved);
    navigation.navigate('ProofComplete', {
      proofHex: parsedProof.proofHex,
      publicInputsHex: parsedProof.publicInputsHex,
      numPublicInputs: parsedProof.numPublicInputs,
      circuitId,
      timestamp: generatedAt.toString(),
      verification: {
        offChain: null,
        onChain: null,
        verifierContract: completionVerifier(resolved, parsedProof),
        chainName: circuitNet.name,
        explorerUrl: circuitNet.explorerUrl,
      },
      walletAddress: account || undefined,
      historyId: historyIdRef.current || undefined,
      // The completion screen continues this log through verification.
      proofLog: kept.log,
    });
    // Clear the "in-flight proof" marker so a re-mount of this screen with a
    // stale `hook.parsedProof` value can't navigate again.
    proofStartedAt.current = null;
    historyIdRef.current = null;
  }, [parsedProof, signalHash, navigation, circuitId, canonical, proofRequest, sendProof, account, isOidc, attemptLog, addLog, failAttempt, endAttemptTiming]);

  // An unrecognised circuit id is refused on arrival, not on button press, so
  // nobody sits looking at a form for a proof the app will not generate.
  useEffect(() => {
    if (flow) return;
    // The reader's own language; ErrorCodes carries the English fallback only.
    const said = t('host.errors.E2006.description', {
      defaultValue: ErrorCodes.E2006.description,
    });
    // Named with a ternary, not `circuitId || ...`. The guard test forbids
    // that shape outright rather than trying to tell a harmless display
    // fallback from the one that used to substitute a whole circuit.
    const named = circuitId ? circuitId : 'none';
    addLog(`[Circuit] refusing unknown circuit id ${JSON.stringify(circuitId)} — no proof generated`);
    failAttempt({
      code: 'E2006',
      error: `${ErrorCodes.E2006.description} (${named})`,
      inline: `[${ErrorCodes.E2006.code}] ${said} (${named})`,
    });
  }, [flow, circuitId, addLog, t, failAttempt]);

  const handleGenerateProof = useCallback(async () => {
    // A relay request has one answer. Once it is sent, another attempt could
    // only produce a proof nobody receives — say so instead of starting one.
    if (proofRequest && isRelayRequestAnswered(proofRequest.requestId)) {
      const said = t('host.errors.E1007.description', {defaultValue: ErrorCodes.E1007.description});
      setErrorMessage(`[${ErrorCodes.E1007.code}] ${said}`);
      showGlobalError('E1007', `Request ${proofRequest.requestId}`);
      return;
    }
    // Refuse rather than fall through. Before this guard existed the id
    // defaulted to Coinbase KYC, so an unrecognised request produced a real
    // proof of the wrong thing. See the note on FLOW_OF_CANONICAL.
    // `flow` cannot exist without `canonical`; both are named so the compiler
    // knows it too and nothing below has to re-derive the id.
    if (!flow || !canonical) {
      setErrorMessage(`[${ErrorCodes.E2006.code}] ` +
        t('host.errors.E2006.description', {defaultValue: ErrorCodes.E2006.description}));
      return;
    }
    // Wallet flow is fully driven by useCircuitWalletGate (single source of
    // truth implementing the documented K-map). Anything other than `address`
    // means the gate already opened a picker / dismissed; the auto-retry
    // effect below will re-invoke handleGenerateProof when account changes.
    let gatedAddress: string | null = null;
    if (!isOidc) {
      const gateResult = await runWalletGate(
        canonical,
        getCircuitDisplayName(canonical),
      );
      if (gateResult === 'pending') return;
      if (gateResult === 'cancelled') {
        setErrorMessage('Wallet selection cancelled.');
        return;
      }
      gatedAddress = gateResult.address;
    }

    clearLogs();
    setIsSearching(true);
    setErrorMessage(null);
    failedMarkedRef.current = false;
    attemptEndedRef.current = false;
    keepLogRef.current = false;
    proofStartedAt.current = Date.now();
    markGenerationScreenBusy();
    addLog(
      `[Attempt] ${canonical}, ${proofRequest
        ? `relay request ${proofRequest.requestId} from ${JSON.stringify(proofRequest.dappName ?? null)}`
        : 'in-app'}, started ${new Date(proofStartedAt.current).toISOString()}`,
    );

    // OIDC: which request this proof answers, fixed before History records
    // it. A route carries a dApp request or an in-app DomainInput, never both.
    const oidcInputs = (proofRequest ? proofRequest.inputs : route.params?.domainInput) as
      | {scope?: unknown; domain?: unknown; provider?: unknown}
      | undefined;
    let oidcBinding: OidcBinding | null = null;
    let oidcSignInWith: OidcSignInProvider | null = null;
    if (isOidc) {
      try {
        oidcSignInWith = signInProviderFor(oidcInputs?.provider);
        oidcBinding = oidcBindingFor(oidcInputs?.scope, proofRequest?.requestId, newStandaloneRequestId);
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e);
        proofStartedAt.current = null;
        setIsSearching(false);
        addLog(`[OIDC] ${details}`);
        failAttempt({code: 'E2004', error: details});
        return;
      }
      addLog(
        `[OIDC] Request ${oidcBinding.requestId} (${proofRequest ? 'relay' : 'in-app'}), nonce ${oidcBinding.nonce}`,
      );
    }

    const displayName = getCircuitDisplayName(canonical);
    const configName: CircuitName = canonical;

    // Read settings directly from store (avoids stale closure from useSettings)
    let currentSettings: Awaited<ReturnType<typeof settingsStore.get>>;
    try {
      currentSettings = await settingsStore.get();
    } catch (error) {
      // Storage failure leaves the user's history preference unknown. Stop
      // before authentication/proving and keep this attempt available to retry.
      const details = error instanceof Error ? error.message : String(error);
      proofStartedAt.current = null;
      historyIdRef.current = null;
      setIsSearching(false);
      failAttempt({
        code: 'E5002',
        error: details,
        inline: `[E5002] ${t('host.errors.E5002.description')}`,
      });
      return;
    }

    // Kept only with Developer Mode AND live logs on; otherwise nothing is.
    keepLogRef.current = proofLogEnabled(currentSettings);

    if (currentSettings.autoSaveProofs) {
      try {
        const reviewInputs: Record<string, unknown> = {
          ...route.params?.domainInput,
          ...proofRequest?.inputs,
          ...route.params?.countryInputs,
          ...(route.params?.scope !== undefined ? {scope: route.params.scope} : {}),
          ...(route.params?.action !== undefined ? {action: route.params.action} : {}),
        };
        const savedReview = captureHistoryReview(reviewInputs);
        const item = await proofHistoryStore.add({
          circuitId,
          circuitName: displayName,
          proofHash: '',
          offChainStatus: 'pending',
          onChainStatus: 'pending',
          overallStatus: 'started',
          timestamp: new Date().toISOString(),
          // The chain this circuit actually verifies on, not a literal.
          // It WAS the literal 'Sepolia', so every proof — including one
          // verified on Base mainnet — was filed in History as Sepolia, while
          // the result screen a tap away said Base. Two screens, one proof,
          // two different chains. Spotted on 2026-09-11 in the App Review
          // demo recording, where both screens appear within thirty seconds
          // of each other.
          network: getNetworkConfigForCircuit(configName).name,
          walletAddress: account ?? '',
          verifierAddress: getVerifierAddressSync(configName),
          source: proofRequest ? 'deeplink' : 'manual',
          dappName: proofRequest?.dappName,
          // An in-app OIDC proof has no relay id; the one minted for its nonce
          // is kept so the proof can be checked against it later.
          requestId: proofRequest ? proofRequest.requestId : oidcBinding?.requestId,
          review: savedReview,
          // The text History shows, stored so History never looks it up.
          // Built from the SANITISED snapshot, never the raw inputs: those
          // carry the sign-in token and the raw transaction.
          display: historyDisplay(canonical, savedReview?.inputs ?? {}, t),
        });
        historyIdRef.current = item.id;
        addLog(`[History] Record created: ${item.id}`);
      } catch (e) {
        addLog(`[History] Failed to create record: ${e}`);
        historyIdRef.current = null;
      }
    } else {
      historyIdRef.current = null;
    }

    // Timing, progress and the running-proof record start here, so every
    // later step -- sign-in, device signature, download, proving -- is
    // timed, and a death from here on is reported at the next launch.
    const timer = startProofTimer(canonical, addLog);
    timerRef.current = timer;
    setActiveProofTimer(timer);
    resetProofProgress();
    const device = deviceProfile();
    timer.note(
      `attempt start ${proofRequest ? 'relay' : 'in-app'} ` +
        `device totalMem=${device.totalMemKb === null ? '?' : `${Math.round(device.totalMemKb / 1024)}MiB`} ` +
        `cpus=${device.cpuCount ?? '?'}`,
    );
    if (proofRequest) {
      // The relay stops waiting a fixed time after it created the request
      // (proofport-relay REQUEST_DEADLINE_MS); its age here is how much of
      // that the person has already spent before the proof starts.
      const created = typeof proofRequest.createdAt === 'string' ? Date.parse(proofRequest.createdAt) : proofRequest.createdAt;
      timer.note(`relay request age ${Number.isFinite(created) ? `${Date.now() - created}ms` : 'unknown'}`);
    }
    await markProofInFlight({
      circuit: canonical,
      startedAt: proofStartedAt.current ?? Date.now(),
      historyId: historyIdRef.current,
      requestId: proofRequest ? proofRequest.requestId : null,
    });
    if (proofRequest) await markOpenRequestProving(proofRequest.requestId);

    try {
      if (isOidc) {
        // OIDC: on-device proof generation — no attestation lookup needed.
        // Both are set above whenever isOidc; the attempt ended otherwise.
        const binding = oidcBinding as OidcBinding;
        const signInWith = oidcSignInWith as OidcSignInProvider;
        const domainStr = typeof oidcInputs?.domain === 'string' ? oidcInputs.domain : '';
        const providerStr = oidcInputs?.provider as string | undefined;

        // Domain is optional — auto-extracted from JWT email if not provided
        if (!domainStr) {
          addLog('[OIDC] No domain provided — will auto-extract from JWT email');
        }

        const SIGN_IN = {
          google: {providerName: 'Google', authReady: googleReady, promptSignIn: promptGoogleSignIn},
          microsoft: {providerName: 'Microsoft', authReady: microsoftReady, promptSignIn: promptMicrosoftSignIn},
        } satisfies Record<OidcSignInProvider, unknown>;
        const {providerName, authReady, promptSignIn} = SIGN_IN[signInWith];

        // The circuit needs this phone's hardware signature over the
        // provider's key (App Attest on iPhone, Android key attestation on
        // Android), so a phone that cannot make one is told so BEFORE the
        // sign-in sheet: no App Attest / simulator (E2009), a development key
        // (E2014), Apple unreachable (E3006), no Android module (E2015).
        // Thrown AppAttestErrors end the attempt with their code (catch below).
        addLog('=== Device signer: preparing to sign the provider key ===');
        const providerKeySigner: ProviderKeySigner = await timer.step('device signer ready', () => prepareOidcAppSigner(addLog));

        addLog(`[OIDC] Starting ${providerName} Sign-In...`);

        if (!authReady) {
          const msg = `${providerName} Sign-In is not ready. Please try again.`;
          addLog(`[Error] ${msg}`);
          failAttempt({code: 'E2008', error: msg});
          return;
        }

        // One shape for every outcome. The reason arrives WITH the result,
        // so nothing here reads a state value that has not landed yet — which
        // is why every failure used to read "cancelled". A token without this
        // request's nonce comes back as a failure (E2012) and is never proved.
        // The claims (aud/azp/nonce/iss/exp, never the token) are logged
        // BEFORE the nonce check, so a refused token still shows what it carried.
        const signIn = await timer.step('sign-in', () => signInBound(async nonce => {
          const result = await promptSignIn(nonce);
          if ('token' in result) addLog(describeIdTokenClaims(result.token));
          return result;
        }, binding.nonce));
        if (!('token' in signIn)) {
          const msg = signIn.cancelled
            ? `${providerName} Sign-In was cancelled`
            : `${providerName} Sign-In failed: ${signIn.error}`;
          addLog(`[Error] ${msg}`);
          if (signIn.cancelled) cancelAttempt(msg);
          else failAttempt({code: signIn.code, error: msg});
          return;
        }
        const jwtToken = signIn.token;

        addLog(`[OIDC] ${providerName} Sign-In successful — JWT carries this request's nonce`);

        await generateOidcProof(
          {jwtToken, scopeString: binding.scope, domain: domainStr, provider: providerStr, nonce: binding.nonce, providerKeySigner},
          addLog,
        );
        // Hook errors are caught internally — detected via useEffect on proofSteps
        return;
      }

      // The gate already resolved the wallet for this circuit.
      const walletAddress = gatedAddress as string;

      if (isDojang) {
        addLog('=== Searching for a Dojang Playground issuance ===');
        let issuance: Awaited<ReturnType<typeof findDojangPlaygroundIssuance>>;
        try {
          issuance = await findDojangPlaygroundIssuance(walletAddress, addLog);
        } catch (e) {
          const details = e instanceof Error ? e.message : String(e);
          // `none` is an answer about this wallet; anything else is a lookup
          // that did not finish, and must not read as "you have none".
          const noIssuance = e instanceof DojangIssuanceError && e.kind === 'none';
          const code = noIssuance ? 'E2007' : 'E3002';
          if (noIssuance) await recordLookupFailure(configName, walletAddress);
          addLog(details);
          failAttempt({
            code,
            error: details,
            inline: `[${code}] ${t(`host.errors.${code}.description`, {defaultValue: ErrorCodes[code].description})}`,
          });
          return;
        }

        const provider = await getProvider();
        if (!provider) {
          addLog('No wallet provider available');
          failAttempt({code: 'E4001', error: 'No wallet provider available'});
          return;
        }
        const deep = proofRequest?.inputs as {scope?: string; action?: TypedAction} | undefined;
        // A deep link must carry its scope (validateProofRequest refuses one
        // without); the Laboratory names its own.
        const scopeStr = route.params?.scope ?? deep?.scope ?? 'proofport:dojang-playground';
        await generateDojangProof(
          {
            userAddress: walletAddress,
            rawTransaction: issuance.rawTransaction,
            scopeString: scopeStr,
            action: route.params?.action ?? deep?.action,
          },
          {
            request: async (args: {method: string; params?: unknown[]}) =>
              provider.send(args.method, args.params || []),
          },
          addLog,
        );
        return;
      }

      const selector = isCountry ? SELECTOR_ATTEST_COUNTRY : SELECTOR_ATTEST_ACCOUNT;
      addLog(isGiwa
        ? '=== Searching for GIWA Attestation ==='
        : isCountry
        ? '=== Searching for Coinbase Country Attestation ==='
        : '=== Searching for Coinbase Attestation ===');

      const txResult = await timer.step('attestation lookup', () => isGiwa
        ? findGiwaAttestationTransaction(walletAddress, addLog)
        : findAttestationTransaction(walletAddress, addLog, selector));
      if (!txResult) {
        await recordLookupFailure(configName, walletAddress);
        const msg = isGiwa
          ? `No GIWA attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`
          : isCountry
          ? `No country attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`
          : `No attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`;
        addLog(msg);
        failAttempt({code: 'E2005', error: msg});
        return;
      }

      // Binding already committed by the wallet gate at connect time;
      // attestation success is just observed, not bound.
      addLog('Attestation found!');
      addLog(`TX length: ${txResult.rawTransaction.length} chars`);

      const provider = await getProvider();
      if (!provider) {
        addLog('No wallet provider available');
        failAttempt({code: 'E4001', error: 'No wallet provider available'});
        return;
      }

      const ethereum = {
        request: async (args: {method: string; params?: unknown[]}) =>
          provider.send(args.method, args.params || []),
      };

      if (isCountry) {
        const manual = route.params?.countryInputs;
        const deep = proofRequest?.inputs as CoinbaseCountryInputs | undefined;
        const scopeStr = route.params?.scope || deep?.scope || 'proofport:default';
        const countryList = manual?.countryList || deep?.countryList;
        const isIncluded = manual?.isIncluded ?? deep?.isIncluded;

        if (!countryList || countryList.length === 0 || typeof isIncluded !== 'boolean') {
          const msg = 'Missing required inputs: countryList and isIncluded';
          addLog(`[Error] ${msg}`);
          failAttempt({code: 'E2004', error: msg});
          return;
        }

        await generateCountryProof(
          {userAddress: walletAddress, rawTransaction: txResult.rawTransaction, signerIndex: 0, countryList, countryListLength: countryList.length, isIncluded, scopeString: scopeStr},
          ethereum, addLog,
        );
      } else if (isGiwa) {
        const deep = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeStr = deep?.scope || 'proofport:giwa-poc';

        await generateGiwaProof(
          {
            userAddress: walletAddress,
            rawTransaction: txResult.rawTransaction,
            signerIndex: 0,
            scopeString: scopeStr,
            // Optional: the GIWA circuit signs the typed action when one
            // arrives and its signal hash when none does. Passing it is what makes the request's action reach the
            // wallet screen instead of being dropped on the way.
            action:
              route.params?.action ??
              (proofRequest?.inputs as {action?: TypedAction} | undefined)?.action,
          },
          ethereum, addLog,
        );
      } else {
        const deep = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeStr = route.params?.scope || deep?.scope || 'proofport:default';

        // Optional EIP-712 action: from the Coinbase action screen, or from
        // the dApp's request. Coinbase KYC v2 signs it instead of the signal
        // hash when present.
        const action =
          route.params?.action ??
          (proofRequest?.inputs as {action?: TypedAction} | undefined)?.action;

        // Coinbase KYC v2, for every request (in-app and dApp): right before
        // proving, look the attestation up again and have this phone's
        // hardware key sign that it is unrevoked (App Attest on iPhone,
        // Android key attestation on Android). Refused here, with its own
        // code, on a phone or simulator without App Attest (E2009), an
        // Android phone or build the circuit does not accept (E2015 / E2016),
        // and for a revoked verification (E2011) -- before the wallet is asked.
        addLog('=== Device signer: checking revocation and signing the statement ===');
        const appAttestWitness: CoinbaseStatementWitness = await timer.step('device: Coinbase statement', () => prepareCoinbaseKycStatement({
          walletAddress,
          attestationUid: txResult.attestation.id,
          scopeString: scopeStr,
          action,
          log: addLog,
        }));

        // The circuit is named, not inferred. `canonical` is the id the user
        // picked or the deep link asked for; the hook refuses any id it does
        // not prove, instead of quietly proving another circuit.
        await generateKycProof(
          {
            circuit: canonical,
            userAddress: walletAddress,
            rawTransaction: txResult.rawTransaction,
            signerIndex: 0,
            scopeString: scopeStr,
            appAttest: {witness: appAttestWitness, action},
          },
          ethereum, addLog,
        );
      }
      // Hook errors are caught internally — detected via useEffect on proofSteps
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog(`Error: ${msg}`);
      // Device-signer failures carry the code for their cause (unsupported
      // device, an Android chain the circuit refuses, revoked, Apple
      // unreachable, ...).
      failAttempt({code: error instanceof AppAttestError ? error.code : 'E2001', error: msg});
    } finally {
      setIsSearching(false);
    }
  }, [runWalletGate, recordLookupFailure, addLog, clearLogs, getProvider,
    generateKycProof, generateCountryProof, generateOidcProof, generateGiwaProof, generateDojangProof,
    googleReady, microsoftReady, promptGoogleSignIn, promptMicrosoftSignIn,
    isCountry, isOidc, isGiwa, isDojang, proofRequest, route.params,
    circuitId, canonical, flow, account, failAttempt, cancelAttempt, t]);

  // After the wallet gate opens a picker / reconnect prompt, it sets its
  // internal post-picker flag. When `account` then flips to a new wallet,
  // we auto-retry handleGenerateProof. The gate's runGate() sees P=1 and
  // skips the confirmation alert.
  //
  // Guard: if the user re-picked a wallet that already failed an
  // attestation lookup in this session, do NOT auto-retry — the search
  // would just fail again and we'd loop forever. Surface a clear hint
  // and let the user choose a different wallet themselves.
  useEffect(() => {
    const prev = previousAccountRef.current;
    if (walletGate.isPostPicker && account && account !== prev) {
      previousAccountRef.current = account;
      if (!canonical) return;
      if (walletGate.wasFailedAddress(canonical, account)) {
        addLog(
          `[Wallet] Re-selected ${account} which already failed lookup — pick a different wallet.`,
        );
        setErrorMessage(
          `${account.slice(0, 10)}… already has no attestation. Pick a different wallet.`,
        );
        return;
      }
      addLog(`[Wallet] Wallet connected: ${account}. Retrying proof generation…`);
      setErrorMessage(null);
      // No clearTimeout cleanup here: a re-render (e.g. circuitReady update)
      // re-runs this effect and the cleanup would cancel the pending retry
      // before it fires. previousAccountRef already prevents duplicate retries
      // for the same account, so the timer is safe to leave running.
      setTimeout(() => handleGenerateProof(), 300);
      return;
    }
    if (!walletGate.isPostPicker) previousAccountRef.current = account;
  }, [account, walletGate, canonical, addLog, handleGenerateProof]);

  // Auto-start for deep link requests
  useEffect(() => {
    if (proofRequest && circuitReady && account && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] From: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] ID: ${proofRequest.requestId}`);
      addLog(`[DeepLink] Auto-starting...`);
      const t = setTimeout(() => handleGenerateProof(), 500);
      return () => clearTimeout(t);
    }
  }, [proofRequest, circuitReady, account, handleGenerateProof, addLog]);

  // Auto-start for OIDC deep link requests (no wallet needed)
  useEffect(() => {
    if (isOidc && proofRequest && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] OIDC from: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Auto-starting...`);
      const t = setTimeout(() => handleGenerateProof(), 500);
      return () => clearTimeout(t);
    }
  }, [isOidc, proofRequest, handleGenerateProof, addLog]);

  useEffect(() => {
    if (proofRequest && !circuitReady && isWalletReady && !hasAutoStarted.current) {
      addLog(`[DeepLink] From: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Connect wallet to continue`);
    }
  }, [proofRequest, circuitReady, isWalletReady, addLog]);

  const isProcessing = hook.isLoading || isSearching;

  // Leaving the app mid-proof is timed and shown: Android may pause or kill
  // an app in the background, and the person should see that the proof
  // continued (or the next launch reports E2019 if it did not survive).
  useEffect(() => {
    if (!isProcessing) return;
    let leftAt: number | null = null;
    let leftWhileProving = false;
    const sub = AppState.addEventListener('change', next => {
      const timer = timerRef.current;
      if (next === 'background' || next === 'inactive') {
        if (leftAt === null) {
          leftAt = Date.now();
          // The sign-in sheet also takes the app out of the foreground; only
          // time away while proving is worth telling the person about.
          leftWhileProving = getProofProgress().stage === 'prove';
          timer?.note(`app ${next} stage=${getProofProgress().stage}`);
        }
      } else if (next === 'active' && leftAt !== null) {
        timer?.note(`app foreground after ${Date.now() - leftAt}ms away`);
        if (leftWhileProving) updateProofProgress({wasInBackground: true});
        leftAt = null;
      }
    });
    return () => sub.remove();
  }, [isProcessing]);
  const hasStepsStarted = hook.proofSteps.some(s => s.status !== 'pending');

  useEffect(() => {
    if ((hasStepsStarted || isProcessing) && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({animated: true});
      }, 300);
    }
  }, [hook.proofSteps, hasStepsStarted, isProcessing, logs]);

  const getButtonState = () => {
    if (isProcessing) {
      const activeIdx = userSteps.findIndex(s => s.status === 'active');
      const activeStep = activeIdx >= 0 ? userSteps[activeIdx] : null;
      const stepNum = activeIdx >= 0 ? activeIdx + 1 : userSteps.length;
      const title = activeStep
        ? `${stepNum}/${userSteps.length}  ${activeStep.label}`
        : t('host.proof.generation.processing');
      const progress = stepNum / userSteps.length;
      return {title, onPress: () => {}, disabled: true, loading: false, progress};
    }
    if (!isOidc && !circuitReady && !walletGate.isPostPicker)
      return {title: t('host.proof.generation.connectWallet'), onPress: handleGenerateProof, disabled: false, loading: false};
    if (errorMessage)
      return {title: t('host.proof.generation.retryButton'), onPress: handleGenerateProof, disabled: false, loading: false};
    return {
      title: isOidc
        ? (oidcProvider === 'microsoft' ? t('host.proof.generation.signInMicrosoft') : t('host.proof.generation.signInGoogle'))
        : t('host.proof.generation.generateButton'),
      onPress: settings?.confirmBeforeGenerate
        ? () => Alert.alert(
            t('host.proof.generation.confirmTitle'),
            t('host.proof.generation.confirmMessage'),
            [
              {text: t('host.proof.generation.confirmCancel'), style: 'cancel'},
              {text: t('host.proof.generation.confirmGenerate'), onPress: handleGenerateProof},
            ])
        : handleGenerateProof,
      disabled: false,
      loading: false,
    };
  };

  const btn = getButtonState();

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView ref={scrollViewRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.hero}>
          <Text style={{fontSize: 11, fontWeight: '700', color: themeColors.info[400], letterSpacing: 1.5, marginBottom: 8}}>
            {t('host.proof.generation.portalLabel')}
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, marginBottom: 12}}>
            {/*
              * One lookup, keyed canonically. This was a ladder of equality
              * checks against the HYPHENATED ids only, with a Coinbase KYC
              * heading as its final else — so a canonical id, which is what a
              * deep link actually carries, ran one proof under another's
              * heading, and any id the ladder did not name was announced as
              * Coinbase KYC while proving something else.
              */}
            {canonical ? t(CIRCUIT_TEXT[canonical].title) : ''}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {canonical ? t(CIRCUIT_TEXT[canonical].description) : ''}
          </Text>
        </Card>

        {(hasStepsStarted || isProcessing) && (
          <Card style={styles.steps}>
            <StepIndicator steps={userSteps} />
          </Card>
        )}

        {proofLogEnabled(settings) && (
          <View style={styles.logsWrap}>
            <LiveLogsPanel logs={logs} />
          </View>
        )}

        {errorMessage && (
          <Card style={{marginTop: 12, marginBottom: 20, backgroundColor: themeColors.error.background, borderColor: themeColors.error[500]}}>
            <Text style={{color: themeColors.error[400], fontSize: 14, textAlign: 'center'}}>{errorMessage}</Text>
          </Card>
        )}

        {/*
          * Directly above the progress button: the screen keeps scrolling to
          * its end while a proof runs, and the notice and the bar have to
          * stay in view together.
          */}
        <ProofProgressCard />

        <View style={styles.btnWrap}>
          {isProcessing && (btn as any).progress != null ? (
            <ProgressButton progress={(btn as any).progress} label={btn.title} />
          ) : (
            <Button title={btn.title} onPress={btn.onPress} disabled={btn.disabled} loading={btn.loading} size="large" />
          )}
        </View>
      </ScrollView>
      {isProcessing && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="large" color={themeColors.info[500]} />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scroll: {flex: 1},
  content: {paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32},
  hero: {marginBottom: 20, padding: 24},
  steps: {marginBottom: 20, paddingHorizontal: 16, paddingVertical: 8},
  logsWrap: {marginBottom: 16},
  btnWrap: {marginBottom: 20},
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
});
