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
import {useCoinbaseKyc, useCoinbaseCountry, useOidcDomain, useGiwaKyc, useGoogleAuth, useMicrosoftAuth, usePrivyWallet, useLogs, useDeepLink, useSettings} from '../../hooks';
import {useCircuitWalletGate} from '../../hooks/useCircuitWalletGate';
import {findAttestationTransaction, findGiwaAttestationTransaction, SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY, computeScope, computeNullifier} from '../../utils';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {proofHistoryStore, settingsStore} from '../../stores';
import {getVerifierAddressSync, getNetworkConfig, getNetworkConfigForCircuit, type CircuitName} from '../../config';
// Wallet-cache logic now lives in useCircuitWalletGate.
import type {CoinbaseKycInputs, CoinbaseCountryInputs} from '../../utils/deeplink';
import {ethers} from 'ethers';
import {getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';

type ProofGenerationRouteProp = RouteProp<ProofStackParamList, 'ProofGeneration'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofGeneration'>;

const CIRCUIT_DISPLAY: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'coinbase-country': 'Coinbase Country',
  'oidc_domain_attestation': 'OIDC Domain',
  'giwa-kyc': 'GIWA KYC (Experimental)',
  'giwa_attestation': 'GIWA KYC (Experimental)',
};

const CIRCUIT_CONFIG: Record<string, string> = {
  'coinbase-kyc': 'coinbase_attestation',
  'coinbase-country': 'coinbase_country_attestation',
  'oidc_domain_attestation': 'oidc_domain_attestation',
  'giwa-kyc': 'giwa_attestation',
  'giwa_attestation': 'giwa_attestation',
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
    {id: 'signer', label: 'Verifying Coinbase signer', status: 'pending', icon: 'shield'},
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

  const circuitId = route.params?.circuitId || 'coinbase-kyc';
  const isCountry = circuitId === 'coinbase-country';
  const isOidc = circuitId === 'oidc_domain_attestation';
  const isGiwa = circuitId === 'giwa-kyc' || circuitId === 'giwa_attestation';
  const oidcProvider = (proofRequest?.inputs as {provider?: string} | undefined)?.provider || route.params?.domainInput?.provider;

  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const oidcHook = useOidcDomain();
  const giwaHook = useGiwaKyc();
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const hook = isOidc ? oidcHook : isGiwa ? giwaHook : (isCountry ? countryHook : kycHook);

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
  }

  const {account, isReady: isPrivyReady, isWalletConnected, connect: connectWallet, disconnect: disconnectWallet, getProvider} = usePrivyWallet(addLog);
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
  const userSteps = isOidc ? oidcUserSteps : toUserSteps(hook.proofSteps, isWalletConnected, isSearching);

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

    const generatedAt = Date.now();
    const resolved = (CIRCUIT_CONFIG[circuitId] || circuitId) as CircuitName;

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
  }, [hook.parsedProof, navigation, circuitId, proofRequest, sendProof, account, isOidc, markHistoryFailed]);

  const handleGenerateProof = useCallback(async () => {
    // Wallet flow is fully driven by useCircuitWalletGate (single source of
    // truth implementing the documented K-map). Anything other than `address`
    // means the gate already opened a picker / dismissed; the auto-retry
    // effect below will re-invoke handleGenerateProof when account changes.
    let gatedAddress: string | null = null;
    if (!isOidc) {
      const resolved = (CIRCUIT_CONFIG[circuitId] || circuitId) as CircuitName;
      const gateResult = await walletGate.runGate(
        resolved,
        CIRCUIT_DISPLAY[circuitId] || resolved,
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

    const displayName = CIRCUIT_DISPLAY[circuitId] || circuitId;
    const configName = (CIRCUIT_CONFIG[circuitId] || circuitId) as CircuitName;

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
        await walletGate.recordLookupFailure(configName);
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

      // Attestation lookup succeeded → bind this wallet to this circuit.
      await walletGate.recordSuccess(configName, walletAddress);

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
  }, [walletGate, addLog, clearLogs, getProvider, kycHook.generateProofWithSteps, countryHook.generateProofWithSteps, oidcHook.generateProofWithSteps, giwaHook.generateProofWithSteps, isCountry, isOidc, isGiwa, proofRequest, route.params, sendError, circuitId, markHistoryFailed]);

  // After the wallet gate opens a picker / reconnect prompt, it sets its
  // internal post-picker flag. When `account` then flips to a new wallet,
  // we auto-retry handleGenerateProof. The gate's runGate() sees P=1 and
  // skips the confirmation alert.
  useEffect(() => {
    const prev = previousAccountRef.current;
    if (walletGate.isPostPicker && account && account !== prev) {
      previousAccountRef.current = account;
      addLog(`[Wallet] Wallet connected: ${account}. Retrying proof generation…`);
      setErrorMessage(null);
      const t = setTimeout(() => handleGenerateProof(), 300);
      return () => clearTimeout(t);
    }
    if (!walletGate.isPostPicker) previousAccountRef.current = account;
  }, [account, walletGate.isPostPicker, addLog, handleGenerateProof]);

  // Auto-start for deep link requests
  useEffect(() => {
    if (proofRequest && isWalletConnected && account && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] From: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] ID: ${proofRequest.requestId}`);
      addLog(`[DeepLink] Auto-starting...`);
      const t = setTimeout(() => handleGenerateProof(), 500);
      return () => clearTimeout(t);
    }
  }, [proofRequest, isWalletConnected, account, handleGenerateProof, addLog]);

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
    if (proofRequest && !isWalletConnected && isPrivyReady && !hasAutoStarted.current) {
      addLog(`[DeepLink] From: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Connect wallet to continue`);
    }
  }, [proofRequest, isWalletConnected, isPrivyReady, addLog]);

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
    if (!isOidc && !isWalletConnected && !walletGate.isPostPicker)
      return {title: t('host.proof.generation.connectWallet'), onPress: connectWallet, disabled: !isPrivyReady, loading: false};
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
            {isOidc
              ? t('host.proof.generation.oidcTitle')
              : isCountry
              ? t('host.proof.generation.coinbaseCountryTitle')
              : isGiwa
              ? t('host.proof.generation.giwaKycTitle')
              : t('host.proof.generation.coinbaseKycTitle')}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {isOidc
              ? t('host.proof.generation.oidcDescription')
              : isCountry
              ? t('host.proof.generation.coinbaseCountryDescription')
              : isGiwa
              ? t('host.proof.generation.giwaKycDescription')
              : t('host.proof.generation.coinbaseKycDescription')}
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
