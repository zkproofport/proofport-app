import React, {useState, useCallback, useEffect, useRef} from 'react';
import {MobileIdTypeSheet, type MdlProvider} from '../../components/MobileIdTypeSheet';
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
import {useCoinbaseKyc, useCoinbaseCountry, useOidcDomain, useGiwaKyc, useGoogleAuth, useMicrosoftAuth, useWallet, useLogs, useDeepLink, useSettings} from '../../hooks';
import {useMdlKr} from '../../hooks/useMdlKr';
import {useCircuitWalletGate} from '../../hooks/useCircuitWalletGate';
import {findAttestationTransaction, findGiwaAttestationTransaction, SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY, computeScope, computeNullifier} from '../../utils';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {proofHistoryStore, settingsStore} from '../../stores';
import {getCircuitWallet, walletGroupKey} from '../../stores/circuitWalletStore';
// `getNetworkConfig` is deliberately absent: this screen always resolves the
// network PER CIRCUIT (GIWA is on chain 91342, the mDL verifiers on Base
// Sepolia), so the environment default would be the wrong answer. It was
// imported and unused before this change; lint has been reporting it.
import {getVerifierAddressSync, getNetworkConfigForCircuit, canonicalCircuitId, type CircuitName} from '../../config';
import {getCircuitDisplayName} from '../../utils/circuit';
// Wallet-cache logic now lives in useCircuitWalletGate.
import type {CoinbaseKycInputs, CoinbaseCountryInputs} from '../../utils/deeplink';
import {ethers} from 'ethers';
import {getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';
import {ErrorCodes} from '../../constants/errorCodes';

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
 * links sent `mdl_kr_age` and the screen answered with a Coinbase proof.
 * Aliasing the ids that were noticed does not fix the shape — the next
 * unrecognised id lands in the same place. The fix is that there IS no default.
 *
 * The screen no longer keeps its own spelling tables. Three of them lived here
 * — display names, id translation, mDL variant — each carrying both spellings
 * of every id, and they disagreed: the title block below matched only the
 * hyphenated ids, so a deep link naming `mdl_kr_age` ran the AGE proof under
 * the OWNERSHIP heading. Everything is keyed by the canonical id now, and the
 * translation happens once, in `canonicalCircuitId`.
 */
type ProofFlow = 'coinbase' | 'country' | 'oidc' | 'giwa' | 'mdl';

const FLOW_OF_CANONICAL: Record<CircuitName, ProofFlow> = {
  coinbase_attestation: 'coinbase',
  coinbase_country_attestation: 'country',
  oidc_domain_attestation: 'oidc',
  giwa_attestation: 'giwa',
  mdl_kr_ownership: 'mdl',
  mdl_kr_age: 'mdl',
  mdl_kr_region: 'mdl',
};

/**
 * The mDL predicate each circuit proves. `MdlKrInputScreen` collects the
 * matching parameter (disclose_flags / age_threshold / target_region) before
 * navigating here.
 */
const MDL_VARIANT_OF: Partial<Record<CircuitName, 'ownership' | 'age' | 'region'>> = {
  mdl_kr_ownership: 'ownership',
  mdl_kr_age: 'age',
  mdl_kr_region: 'region',
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
  mdl_kr_ownership: {
    title: 'host.proof.generation.mdlKrOwnershipTitle',
    description: 'host.proof.generation.mdlKrOwnershipDescription',
  },
  mdl_kr_age: {
    title: 'host.proof.generation.mdlKrAgeTitle',
    description: 'host.proof.generation.mdlKrAgeDescription',
  },
  mdl_kr_region: {
    title: 'host.proof.generation.mdlKrRegionTitle',
    description: 'host.proof.generation.mdlKrRegionDescription',
  },
};

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

const toUserSteps = (
  hookSteps: Array<{id: string; label: string; status: string}>,
  walletConnected: boolean,
  searching: boolean,
): StepData[] => {
  const steps: StepData[] = [
    {id: 'wallet', label: 'Wallet connected', status: walletConnected ? 'complete' : 'pending', icon: 'wallet'},
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
  const proofRequest = getActiveProofRequest() ?? route.params?.proofRequest;

  const hasAutoStarted = useRef(false);
  const didResetOnMountRef = useRef(false);
  const proofStartedAt = useRef<number | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const failedMarkedRef = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {logs, addLog, clearLogs} = useLogs();
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
  const mdlVariant = canonical ? MDL_VARIANT_OF[canonical] : undefined;
  const isMdl = flow === 'mdl';
  // Document-type bottom sheet for the mDL flow. The chosen provider is held
  // in a ref so handleGenerateProof (a stable useCallback) reads the latest
  // value without being recreated.
  const [mdlSheetVisible, setMdlSheetVisible] = useState(false);
  const chosenMdlProviderRef = useRef<MdlProvider | null>(null);
  const oidcProvider = (proofRequest?.inputs as {provider?: string} | undefined)?.provider || route.params?.domainInput?.provider;

  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const oidcHook = useOidcDomain();
  const giwaHook = useGiwaKyc();
  // useMdlKr requires a variant at hook init. When this screen is not
  // serving an mDL circuit, the hook still mounts (rules of hooks) but
  // is never driven; we keep 'ownership' as the inert default.
  const mdlHook = useMdlKr(mdlVariant ?? 'ownership');
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const hook = isMdl
    ? mdlHook
    : isOidc
    ? oidcHook
    : isGiwa
    ? giwaHook
    : isCountry
    ? countryHook
    : kycHook;

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
    mdlHook.resetProofCache();
  }

  const {account, isReady: isWalletReady, connect: connectWallet, disconnect: disconnectWallet, getProvider} = useWallet(addLog);
  const walletGate = useCircuitWalletGate({
    account,
    connectWallet,
    disconnectWallet,
    onPending: () => {},
    log: addLog,
  });
  // Track the last `account` we observed; when the gate is in post-picker
  // mode and `account` flips to a new value, we re-fire handleGenerateProof.
  const previousAccountRef = useRef<string | null>(null);
  const {sendProof, sendError} = useDeepLink();

  // Per-circuit readiness keyed by wallet group: this circuit is "ready" only
  // when its GROUP's bound wallet is the one currently connected. Coinbase KYC
  // and Country share a group, so binding one makes the other ready too.
  const [circuitReady, setCircuitReady] = useState(false);
  useEffect(() => {
    if (isOidc || isMdl) {
      // OIDC and Korea mDL are web2 flows — no wallet binding, so the
      // circuit is always "ready" without a wallet gate.
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
  }, [canonical, account, isOidc, isMdl]);

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
  const userSteps = isOidc ? oidcUserSteps : toUserSteps(hook.proofSteps, circuitReady, isSearching);

  // Mark history as failed (idempotent via ref)
  const markHistoryFailed = useCallback(() => {
    if (failedMarkedRef.current || !historyIdRef.current) return;
    failedMarkedRef.current = true;
    proofHistoryStore.update(historyIdRef.current, {
      overallStatus: 'failed',
      offChainStatus: 'failed',
      onChainStatus: 'failed',
    }).catch(console.error);
  }, []);

  // CRITICAL: Watch hook's proofSteps for errors.
  // The hooks catch errors internally and don't re-throw,
  // so we detect failure by watching for 'error' step status.
  useEffect(() => {
    const errStep = hook.proofSteps.find(s => s.status === 'error');
    if (errStep) {
      const detail = (errStep as any).detail || 'Proof generation failed';
      setErrorMessage(detail);
      markHistoryFailed();
    }
  }, [hook.proofSteps, markHistoryFailed]);

  // Handle successful proof → update history + navigate
  // Only navigate to ProofComplete when the parsedProof was produced AFTER
  // we hit "Generate" on THIS screen entry. proofStartedAt is null on mount
  // and set only inside handleGenerateProof, so a stale cached proof from a
  // previous screen entry can't trigger this navigation.
  useEffect(() => {
    if (!hook.parsedProof || !proofStartedAt.current) return;
    // Unreachable without a canonical id — nothing starts a proof without one
    // — but narrowing here keeps the address/network lookups below honest.
    if (!canonical) return;

    const generatedAt = Date.now();
    const resolved: CircuitName = canonical;

    if (historyIdRef.current) {
      proofHistoryStore.update(historyIdRef.current, {
        proofHash: hook.parsedProof.proofHex,
        offChainStatus: 'generated',
        onChainStatus: 'generated',
        overallStatus: 'generated',
      }).catch(console.error);
    }

    if (proofRequest) {
      let nullifierHex = '0x' + '00'.repeat(32);
      if (isOidc) {
        // OIDC: nullifier is embedded in public inputs (circuit computes it)
        // No separate computation needed
      } else {
        const inputs = proofRequest.inputs as CoinbaseKycInputs | undefined;
        const scope = inputs?.scope || 'proofport:default';
        const scopeBytes = computeScope(scope);
        const nullifierBytes = (hook as any).signalHash
          ? computeNullifier(account || '', (hook as any).signalHash, scopeBytes)
          : new Uint8Array(32);
        nullifierHex = ethers.utils.hexlify(nullifierBytes);
      }

      const circuitNet = getNetworkConfigForCircuit(resolved);
      sendProof(proofRequest, {
        proof: hook.parsedProof.proofHex,
        publicInputs: hook.parsedProof.publicInputsHex,
        numPublicInputs: hook.parsedProof.numPublicInputs,
        nullifier: nullifierHex,
        verificationType: 'off-chain',
        verificationResult: false,
        startedAt: proofStartedAt.current,
        completedAt: generatedAt,
        verifierAddress: getVerifierAddressSync(resolved),
        chainId: circuitNet.chainId,
      }).then(() => setActiveProofRequest(null)).catch(console.error);
    }

    const circuitNet = getNetworkConfigForCircuit(resolved);
    navigation.navigate('ProofComplete', {
      proofHex: hook.parsedProof.proofHex,
      publicInputsHex: hook.parsedProof.publicInputsHex,
      numPublicInputs: hook.parsedProof.numPublicInputs,
      circuitId,
      timestamp: generatedAt.toString(),
      verification: {
        offChain: null,
        onChain: null,
        verifierContract: getVerifierAddressSync(resolved),
        chainName: circuitNet.name,
        explorerUrl: circuitNet.explorerUrl,
      },
      walletAddress: account || undefined,
      historyId: historyIdRef.current || undefined,
    });
    // Clear the "in-flight proof" marker so a re-mount of this screen with a
    // stale `hook.parsedProof` value can't navigate again.
    proofStartedAt.current = null;
    historyIdRef.current = null;
  }, [hook.parsedProof, navigation, circuitId, canonical, proofRequest, sendProof, account, isOidc, markHistoryFailed]);

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
    setErrorMessage(`[${ErrorCodes.E2006.code}] ${said} (${named})`);
    addLog(`[Circuit] refusing unknown circuit id ${JSON.stringify(circuitId)} — no proof generated`);
  }, [flow, circuitId, addLog, t]);

  const handleGenerateProof = useCallback(async () => {
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
    // mDL: the document-type bottom sheet is the entry point and the
    // confirmation step. Open it first; its onSelect sets the provider ref
    // and re-invokes this function (ref non-null -> proceeds past this guard).
    if (isMdl && chosenMdlProviderRef.current === null) {
      setMdlSheetVisible(true);
      return;
    }
    // Wallet flow is fully driven by useCircuitWalletGate (single source of
    // truth implementing the documented K-map). Anything other than `address`
    // means the gate already opened a picker / dismissed; the auto-retry
    // effect below will re-invoke handleGenerateProof when account changes.
    let gatedAddress: string | null = null;
    if (!isOidc && !isMdl) {
      const gateResult = await walletGate.runGate(
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
    proofStartedAt.current = Date.now();

    const displayName = getCircuitDisplayName(canonical);
    const configName: CircuitName = canonical;

    // Read settings directly from store (avoids stale closure from useSettings)
    const currentSettings = await settingsStore.get();

    if (currentSettings.autoSaveProofs) {
      try {
        const item = await proofHistoryStore.add({
          circuitId,
          circuitName: displayName,
          proofHash: '',
          offChainStatus: 'pending',
          onChainStatus: 'pending',
          overallStatus: 'started',
          timestamp: new Date().toISOString(),
          network: 'Sepolia',
          walletAddress: account ?? '',
          verifierAddress: getVerifierAddressSync(configName),
          source: proofRequest ? 'deeplink' : 'manual',
          dappName: proofRequest?.dappName,
          requestId: proofRequest?.requestId,
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

    try {
      if (isMdl) {
        // Korea Mobile ID (web2 OmniOne CX flow). Inputs come from either:
        //   (a) the deep-link `proofRequest.inputs` (when a dApp drives it),
        //   (b) the MdlKrInputScreen result on `route.params.mdlKrInputs`
        //       (when the user taps a card and picks the predicate input),
        // in that order. No silent defaults for region or age threshold —
        // missing values throw rather than auto-passing the wrong proof.
        const deep = proofRequest?.inputs as {
          scope?: string;
          targetRegion?: string;
          ageThreshold?: number;
          currentYear?: number;
          discloseFlags?: number;
        } | undefined;
        const scopeStr = deep?.scope || 'proofport:default';
        const mInputs = route.params?.mdlKrInputs;

        if (mdlVariant === 'ownership') {
          const discloseFlags =
            deep?.discloseFlags ?? mInputs?.discloseFlags ?? 0;
          await mdlHook.generateProofWithSteps(
            {
              variant: 'ownership',
              provider: chosenMdlProviderRef.current ?? mInputs?.provider ?? 'comdl_v1.5',
              scopeString: scopeStr,
              discloseFlags,
              expectedName:  mInputs?.expectedName,
              expectedBirth: mInputs?.expectedBirth,
              expectedSex:   mInputs?.expectedSex,
              expectedTelno: mInputs?.expectedTelno,
            },
            addLog,
          );
        } else if (mdlVariant === 'age') {
          const ageThreshold = deep?.ageThreshold ?? mInputs?.ageThreshold;
          if (ageThreshold === undefined) {
            throw new Error(
              'age_threshold is required — open the Korea mDL input screen first',
            );
          }
          const currentYear =
            deep?.currentYear ?? mInputs?.currentYear ?? new Date().getFullYear();
          await mdlHook.generateProofWithSteps(
            {
              variant: 'age',
              provider: chosenMdlProviderRef.current ?? mInputs?.provider ?? 'comdl_v1.5',
              scopeString: scopeStr,
              ageThreshold,
              currentYear,
            },
            addLog,
          );
        } else if (mdlVariant === 'region') {
          const targetRegion = deep?.targetRegion ?? mInputs?.targetRegion;
          if (!targetRegion) {
            throw new Error(
              'target_region is required — open the Korea mDL input screen first',
            );
          }
          await mdlHook.generateProofWithSteps(
            {
              variant: 'region',
              provider: chosenMdlProviderRef.current ?? mInputs?.provider ?? 'comdl_v1.5',
              scopeString: scopeStr,
              targetRegion,
            },
            addLog,
          );
        }
        return;
      }
      if (isOidc) {
        // OIDC: on-device proof generation — no attestation lookup needed
        const deep = proofRequest?.inputs as {scope?: string; domain?: string; provider?: string} | undefined;
        const scopeStr = deep?.scope || route.params?.domainInput?.scope || 'proofport:default';
        const domainStr = deep?.domain || route.params?.domainInput?.domain || '';
        const providerStr = deep?.provider || route.params?.domainInput?.provider;

        // Domain is optional — auto-extracted from JWT email if not provided
        if (!domainStr) {
          addLog('[OIDC] No domain provided — will auto-extract from JWT email');
        }

        // Trigger OIDC Sign-In based on provider
        const providerName = providerStr === 'microsoft' ? 'Microsoft' : 'Google';
        const authHook = providerStr === 'microsoft' ? microsoftAuth : googleAuth;
        addLog(`[OIDC] Starting ${providerName} Sign-In...`);

        if (!authHook.isReady) {
          const msg = `${providerName} Sign-In is not ready. Please try again.`;
          addLog(`[Error] ${msg}`);
          setErrorMessage(msg);
          markHistoryFailed();
          return;
        }

        let jwtToken: string | null = null;
        try {
          jwtToken = await authHook.promptSignIn();
        } catch (authError: unknown) {
          const errMsg = authError instanceof Error ? authError.message : String(authError);
          const msg = `${providerName} Sign-In error: ${errMsg}`;
          addLog(`[Error] ${msg}`);
          setErrorMessage(msg);
          markHistoryFailed();
          if (proofRequest) {
            sendError(proofRequest, msg).catch(console.error);
            setActiveProofRequest(null);
          }
          return;
        }
        if (!jwtToken) {
          const msg = `${providerName} Sign-In was cancelled`;
          addLog(`[Error] ${msg}`);
          setErrorMessage(msg);
          markHistoryFailed();
          if (proofRequest) {
            sendError(proofRequest, msg).catch(console.error);
            setActiveProofRequest(null);
          }
          return;
        }

        addLog(`[OIDC] ${providerName} Sign-In successful — JWT obtained`);

        await oidcHook.generateProofWithSteps(
          {jwtToken, scopeString: scopeStr, domain: domainStr, provider: providerStr},
          addLog,
        );
        // Hook errors are caught internally — detected via useEffect on proofSteps
        return;
      }

      // The gate already resolved the wallet for this circuit.
      const walletAddress = gatedAddress as string;

      const selector = isCountry ? SELECTOR_ATTEST_COUNTRY : SELECTOR_ATTEST_ACCOUNT;
      addLog(isGiwa
        ? '=== Searching for GIWA Attestation ==='
        : isCountry
        ? '=== Searching for Coinbase Country Attestation ==='
        : '=== Searching for Coinbase Attestation ===');

      const txResult = isGiwa
        ? await findGiwaAttestationTransaction(walletAddress, addLog)
        : await findAttestationTransaction(walletAddress, addLog, selector);
      if (!txResult) {
        await walletGate.recordLookupFailure(configName, walletAddress);
        const msg = isGiwa
          ? `No GIWA attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`
          : isCountry
          ? `No country attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`
          : `No attestation for ${walletAddress.slice(0, 10)}… — pick another wallet.`;
        setErrorMessage(msg);
        addLog(msg);
        markHistoryFailed();
        return;
      }

      // Binding already committed by the wallet gate at connect time;
      // attestation success is just observed, not bound.
      addLog('Attestation found!');
      addLog(`TX length: ${txResult.rawTransaction.length} chars`);

      const provider = await getProvider();
      if (!provider) {
        setErrorMessage('No wallet provider available');
        addLog('No wallet provider available');
        markHistoryFailed();
        return;
      }

      const ethereum = {
        request: async (args: {method: string; params?: unknown[]}) =>
          provider.send(args.method, args.params || []),
      };

      if (isCountry) {
        const manual = route.params?.countryInputs;
        const deep = proofRequest?.inputs as CoinbaseCountryInputs | undefined;
        const scopeStr = deep?.scope || 'proofport:default';
        const countryList = manual?.countryList || deep?.countryList;
        const isIncluded = manual?.isIncluded ?? deep?.isIncluded;

        if (!countryList || countryList.length === 0 || typeof isIncluded !== 'boolean') {
          const msg = 'Missing required inputs: countryList and isIncluded';
          addLog(`[Error] ${msg}`);
          setErrorMessage(msg);
          markHistoryFailed();
          if (proofRequest) {
            sendError(proofRequest, msg).catch(console.error);
            setActiveProofRequest(null);
          }
          return;
        }

        await countryHook.generateProofWithSteps(
          {userAddress: walletAddress, rawTransaction: txResult.rawTransaction, signerIndex: 0, countryList, countryListLength: countryList.length, isIncluded, scopeString: scopeStr},
          ethereum, addLog,
        );
      } else if (isGiwa) {
        const deep = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeStr = deep?.scope || 'proofport:giwa-poc';

        await giwaHook.generateProofWithSteps(
          {userAddress: walletAddress, rawTransaction: txResult.rawTransaction, signerIndex: 0, scopeString: scopeStr},
          ethereum, addLog,
        );
      } else {
        const deep = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeStr = deep?.scope || 'proofport:default';

        await kycHook.generateProofWithSteps(
          {userAddress: walletAddress, rawTransaction: txResult.rawTransaction, signerIndex: 0, scopeString: scopeStr},
          ethereum, addLog,
        );
      }
      // Hook errors are caught internally — detected via useEffect on proofSteps
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(msg);
      addLog(`Error: ${msg}`);
      markHistoryFailed();
    } finally {
      setIsSearching(false);
    }
  }, [walletGate, addLog, clearLogs, getProvider, kycHook.generateProofWithSteps, countryHook.generateProofWithSteps, oidcHook.generateProofWithSteps, giwaHook.generateProofWithSteps, mdlHook.generateProofWithSteps, isCountry, isOidc, isGiwa, isMdl, proofRequest, route.params, sendError, circuitId, canonical, markHistoryFailed]);

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

  // mDL document-type sheet selection -> stash provider + start proof.
  const handleMdlProviderSelect = useCallback(
    (provider: MdlProvider) => {
      chosenMdlProviderRef.current = provider;
      setMdlSheetVisible(false);
      handleGenerateProof();
    },
    [handleGenerateProof],
  );

  // mDL deep link / OpenStoa login: on arrival, kick off the flow. The guard
  // in handleGenerateProof opens the document-type sheet; selection drives the
  // proof. No wallet/account needed (mDL is on-device), unlike the effect below.
  useEffect(() => {
    if (isMdl && proofRequest && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] mDL from: ${proofRequest.dappName || 'Unknown'}`);
      handleGenerateProof();
    }
  }, [isMdl, proofRequest, handleGenerateProof, addLog]);

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
              * heading as its final else — so `mdl_kr_age`, which is what a
              * deep link actually carries, ran the age proof under the
              * OWNERSHIP heading, and any id the ladder did not name was
              * announced as Coinbase KYC while proving something else.
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

        {settings?.developerMode && settings.showLiveLogs !== false && (
          <View style={styles.logsWrap}>
            <LiveLogsPanel logs={logs} />
          </View>
        )}

        {errorMessage && (
          <Card style={{marginTop: 12, marginBottom: 20, backgroundColor: themeColors.error.background, borderColor: themeColors.error[500]}}>
            <Text style={{color: themeColors.error[400], fontSize: 14, textAlign: 'center'}}>{errorMessage}</Text>
          </Card>
        )}

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
      <MobileIdTypeSheet
        visible={mdlSheetVisible}
        onSelect={handleMdlProviderSelect}
        onCancel={() => setMdlSheetVisible(false)}
      />
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
