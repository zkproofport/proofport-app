import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Button,
  Card,
  StepIndicator,
  LiveLogsPanel,
  type StepData,
} from '../../components/ui';
import {useCoinbaseKyc, useCoinbaseCountry, usePrivyWallet, useLogs, useDeepLink, useSettings} from '../../hooks';
import {findAttestationTransaction, SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY, computeScope, computeNullifier} from '../../utils';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {proofHistoryStore, settingsStore} from '../../stores';
import {getVerifierAddressSync, getNetworkConfig, type CircuitName} from '../../config';
import type {CoinbaseKycInputs, CoinbaseCountryInputs} from '../../utils/deeplink';
import {ethers} from 'ethers';
import {getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';

type ProofGenerationRouteProp = RouteProp<ProofStackParamList, 'ProofGeneration'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofGeneration'>;

const CIRCUIT_DISPLAY: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'coinbase-country': 'Coinbase Country',
};

const CIRCUIT_CONFIG: Record<string, string> = {
  'coinbase-kyc': 'coinbase_attestation',
  'coinbase-country': 'coinbase_country_attestation',
};

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

  const activeIdx = steps.findIndex(s => s.status === 'active');
  if (activeIdx > 0) {
    for (let i = 0; i < activeIdx; i++) {
      if (steps[i].status === 'pending') steps[i].status = 'complete';
    }
  }

  return steps;
};

export const ProofGenerationScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const route = useRoute<ProofGenerationRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const proofRequest = getActiveProofRequest() ?? route.params?.proofRequest;

  const hasAutoStarted = useRef(false);
  const proofStartedAt = useRef<number | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const failedMarkedRef = useRef(false);

  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {logs, addLog, clearLogs} = useLogs();
  const {settings} = useSettings();

  const circuitId = route.params?.circuitId || 'coinbase-kyc';
  const isCountry = circuitId === 'coinbase-country';

  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const hook = isCountry ? countryHook : kycHook;

  const {account, isReady: isPrivyReady, isWalletConnected, connect: connectWallet, getProvider} = usePrivyWallet(addLog);
  const {sendProof, sendError} = useDeepLink();

  const userSteps = toUserSteps(hook.proofSteps, isWalletConnected, isSearching);

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
      const inputs = proofRequest.inputs as CoinbaseKycInputs | undefined;
      const scope = inputs?.scope || 'proofport:default';
      const scopeBytes = computeScope(scope);
      const nullifierBytes = hook.signalHash
        ? computeNullifier(account || '', hook.signalHash, scopeBytes)
        : new Uint8Array(32);

      sendProof(proofRequest, {
        proof: hook.parsedProof.proofHex,
        publicInputs: hook.parsedProof.publicInputsHex,
        numPublicInputs: hook.parsedProof.numPublicInputs,
        nullifier: ethers.utils.hexlify(nullifierBytes),
        verificationType: 'off-chain',
        verificationResult: false,
        startedAt: proofStartedAt.current,
        completedAt: generatedAt,
        verifierAddress: getVerifierAddressSync(resolved),
        chainId: getNetworkConfig().chainId,
      }).then(() => setActiveProofRequest(null)).catch(console.error);
    }

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
        chainName: getNetworkConfig().name,
        explorerUrl: getNetworkConfig().explorerUrl,
      },
      walletAddress: account || undefined,
      historyId: historyIdRef.current || undefined,
    });
  }, [hook.parsedProof, navigation, circuitId, proofRequest, sendProof, account, hook.signalHash, markHistoryFailed]);

  const handleGenerateProof = useCallback(async () => {
    if (!account) {
      addLog('Please connect wallet first');
      return;
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
          walletAddress: account,
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
      const selector = isCountry ? SELECTOR_ATTEST_COUNTRY : SELECTOR_ATTEST_ACCOUNT;
      addLog(isCountry
        ? '=== Searching for Coinbase Country Attestation ==='
        : '=== Searching for Coinbase Attestation ===');

      const txResult = await findAttestationTransaction(account, addLog, selector);
      if (!txResult) {
        const msg = isCountry
          ? `No country attestation found for wallet ${account}`
          : `No attestation found for wallet ${account}`;
        setErrorMessage(msg);
        addLog(msg);
        markHistoryFailed();
        return;
      }

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
          {userAddress: account, rawTransaction: txResult.rawTransaction, signerIndex: 0, countryList, countryListLength: countryList.length, isIncluded, scopeString: scopeStr},
          ethereum, addLog,
        );
      } else {
        const deep = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeStr = deep?.scope || 'proofport:default';

        await kycHook.generateProofWithSteps(
          {userAddress: account, rawTransaction: txResult.rawTransaction, signerIndex: 0, scopeString: scopeStr},
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
  }, [account, addLog, clearLogs, getProvider, kycHook.generateProofWithSteps, countryHook.generateProofWithSteps, isCountry, proofRequest, route.params, sendError, circuitId, markHistoryFailed]);

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

  useEffect(() => {
    if (proofRequest && !isWalletConnected && isPrivyReady && !hasAutoStarted.current) {
      addLog(`[DeepLink] From: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Connect wallet to continue`);
    }
  }, [proofRequest, isWalletConnected, isPrivyReady, addLog]);

  const isProcessing = hook.isLoading || isSearching;
  const hasStepsStarted = hook.proofSteps.some(s => s.status !== 'pending');

  const getButtonState = () => {
    if (!isWalletConnected)
      return {title: 'Connect Wallet', onPress: connectWallet, disabled: !isPrivyReady, loading: false};
    if (isSearching)
      return {title: 'Searching Attestation...', onPress: () => {}, disabled: true, loading: true};
    if (hook.isLoading)
      return {title: 'Generating Proof...', onPress: () => {}, disabled: true, loading: true};
    if (errorMessage)
      return {title: 'Retry', onPress: handleGenerateProof, disabled: false, loading: false};
    return {
      title: 'Generate ZK Proof',
      onPress: settings?.confirmBeforeGenerate
        ? () => Alert.alert('Generate ZK Proof', 'This will generate a zero-knowledge proof. Proceed?', [
            {text: 'Cancel', style: 'cancel'},
            {text: 'Generate', onPress: handleGenerateProof},
          ])
        : handleGenerateProof,
      disabled: false,
      loading: false,
    };
  };

  const btn = getButtonState();

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.hero}>
          <Text style={{fontSize: 11, fontWeight: '700', color: themeColors.info[400], letterSpacing: 1.5, marginBottom: 8}}>
            PROOF PORTAL
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, marginBottom: 12}}>
            {isCountry ? 'Coinbase Country Verification' : 'Coinbase KYC Verification'}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {isCountry
              ? 'Generate a zero-knowledge proof of your country verification through Coinbase without revealing personal details.'
              : 'Generate a zero-knowledge proof of your Coinbase identity verification without revealing any personal information.'}
          </Text>
        </Card>

        {(hasStepsStarted || isProcessing) && (
          <Card style={styles.steps}>
            <StepIndicator steps={userSteps} />
          </Card>
        )}

        {settings?.developerMode && settings.showLiveLogs !== false && <LiveLogsPanel logs={logs} />}

        {errorMessage && (
          <Card style={{marginTop: 12, marginBottom: 20, backgroundColor: themeColors.error.background, borderColor: themeColors.error[500]}}>
            <Text style={{color: themeColors.error[400], fontSize: 14, textAlign: 'center'}}>{errorMessage}</Text>
          </Card>
        )}

        <View style={styles.btnWrap}>
          <Button title={btn.title} onPress={btn.onPress} disabled={btn.disabled} loading={btn.loading} size="large" />
        </View>

        {isProcessing && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={themeColors.info[500]} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scroll: {flex: 1},
  content: {paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32},
  hero: {marginBottom: 20, padding: 24},
  steps: {marginBottom: 20, paddingHorizontal: 16, paddingVertical: 8},
  btnWrap: {marginBottom: 20},
  loader: {alignItems: 'center', marginBottom: 20},
});
