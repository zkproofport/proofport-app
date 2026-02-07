import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Button,
  Card,
  StepIndicator,
  type StepData,
} from '../../components/ui';
import {useCoinbaseKyc, useCoinbaseCountry, usePrivyWallet, useLogs, useDeepLink} from '../../hooks';
import {findAttestationTransaction, SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY, computeScope, computeNullifier} from '../../utils';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {proofHistoryStore} from '../../stores';
import {getVerifierAddressSync, getNetworkConfig, type CircuitName} from '../../config';
import type {CoinbaseKycInputs, CoinbaseCountryInputs} from '../../utils/deeplink';
import {ethers} from 'ethers';
import {getActiveProofRequest, setActiveProofRequest} from '../../stores/activeProofRequestStore';

type ProofGenerationRouteProp = RouteProp<ProofStackParamList, 'ProofGeneration'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofGeneration'>;

interface UserFacingStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  icon: string;
}

const mapHookStepsToUserSteps = (
  hookSteps: Array<{id: string; label: string; status: string}>,
  isWalletConnected: boolean,
  isSearching: boolean,
): StepData[] => {
  const userSteps: UserFacingStep[] = [
    {
      id: 'wallet',
      label: 'Wallet connected',
      status: isWalletConnected ? 'complete' : 'pending',
      icon: 'wallet',
    },
    {
      id: 'attestation',
      label: 'Fetching attestation',
      status: isSearching ? 'active' : 'pending',
      icon: 'search',
    },
    {
      id: 'transaction',
      label: 'Fetching raw transaction',
      status: 'pending',
      icon: 'download',
    },
    {
      id: 'signer',
      label: 'Verifying Coinbase signer',
      status: 'pending',
      icon: 'shield',
    },
    {
      id: 'signing',
      label: 'Signing dApp challenge',
      status: 'pending',
      icon: 'edit-3',
    },
    {
      id: 'proof',
      label: 'Generating ZK proof',
      status: 'pending',
      icon: 'cpu',
    },
  ];

  const stepMapping: Record<string, string> = {
    validate: 'attestation',
    vk: 'transaction',
    inputs: 'transaction',
    signal: 'signer',
    pubkey: 'signer',
    country: 'signer',
    sign: 'signing',
    storage: 'proof',
    proof: 'proof',
    parse: 'proof',
    cleanup: 'proof',
  };

  hookSteps.forEach(hookStep => {
    const userStepId = stepMapping[hookStep.id];
    if (userStepId) {
      const userStep = userSteps.find(s => s.id === userStepId);
      if (userStep) {
        if (hookStep.status === 'in_progress') {
          userStep.status = 'active';
        } else if (hookStep.status === 'completed') {
          if (userStep.status !== 'active') {
            userStep.status = 'complete';
          }
        } else if (hookStep.status === 'error') {
          userStep.status = 'error';
        }
      }
    }
  });

  const activeIdx = userSteps.findIndex(s => s.status === 'active');
  if (activeIdx > 0) {
    for (let i = 0; i < activeIdx; i++) {
      if (userSteps[i].status === 'pending') {
        userSteps[i].status = 'complete';
      }
    }
  }

  return userSteps.map(step => ({
    id: step.id,
    label: step.label,
    status: step.status,
    icon: step.icon,
  }));
};

export const ProofGenerationScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const route = useRoute<ProofGenerationRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  // Prefer module-level store (set by App.tsx before navigation) over route params
  const proofRequest = getActiveProofRequest() ?? route.params?.proofRequest;

  const hasAutoStarted = useRef(false);
  const proofStartedAt = useRef<number | null>(null);
  const historyIdRef = useRef<string | null>(null);

  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {addLog, clearLogs} = useLogs();

  const circuitId = route.params?.circuitId || 'coinbase-kyc';
  const isCountryCircuit = circuitId === 'coinbase-country';

  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();

  const {
    status,
    isLoading,
    parsedProof,
    proofSteps,
    signalHash,
  } = isCountryCircuit ? countryHook : kycHook;

  const {
    account,
    isReady: isPrivyReady,
    isWalletConnected,
    connect: connectWallet,
    getProvider,
  } = usePrivyWallet(addLog);

  const {sendProof, sendError} = useDeepLink();

  const userSteps = mapHookStepsToUserSteps(proofSteps, isWalletConnected, isSearching);

  const handleGenerateProof = useCallback(async () => {
    if (!account) {
      addLog('Please connect wallet first');
      return;
    }

    clearLogs();
    setIsSearching(true);
    setErrorMessage(null);
    proofStartedAt.current = Date.now();

    const CIRCUIT_DISPLAY_NAMES: Record<string, string> = {
      'coinbase-kyc': 'Coinbase KYC',
      'coinbase-country': 'Coinbase Country',
    };
    const CIRCUIT_CONFIG_NAMES: Record<string, string> = {
      'coinbase-kyc': 'coinbase_attestation',
      'coinbase-country': 'coinbase_country_attestation',
    };
    const circuitName = CIRCUIT_DISPLAY_NAMES[circuitId] || circuitId;
    const configCircuitName = (CIRCUIT_CONFIG_NAMES[circuitId] || circuitId) as CircuitName;

    const historyItem = await proofHistoryStore.add({
      circuitId,
      circuitName,
      proofHash: '',
      offChainStatus: 'pending',
      onChainStatus: 'pending',
      overallStatus: 'started',
      timestamp: new Date().toISOString(),
      network: 'Sepolia',
      walletAddress: account || '',
      verifierAddress: getVerifierAddressSync(configCircuitName),
      source: proofRequest ? 'deeplink' : 'manual',
      dappName: proofRequest?.dappName,
      requestId: proofRequest?.requestId,
    });
    historyIdRef.current = historyItem.id;
    addLog(`[History] Proof record created: ${historyItem.id}`);

    try {
      const expectedSelector = isCountryCircuit ? SELECTOR_ATTEST_COUNTRY : SELECTOR_ATTEST_ACCOUNT;
      addLog(isCountryCircuit
        ? '=== Searching for Coinbase Country Attestation ==='
        : '=== Searching for Coinbase Attestation ===');
      const result = await findAttestationTransaction(account, addLog, expectedSelector);

      if (!result) {
        setErrorMessage(isCountryCircuit
          ? `No country attestation found for this wallet (${account})`
          : `No valid attestation found for this wallet (${account})`);
        addLog('No matching attestation found for this wallet');
        return;
      }

      addLog('Attestation transaction found!');
      addLog(`TX length: ${result.rawTransaction.length} characters`);

      const provider = await getProvider();
      if (!provider) {
        setErrorMessage('No wallet provider available');
        addLog('No wallet provider available');
        return;
      }

      const ethereumProvider = {
        request: async (args: {method: string; params?: unknown[]}) => {
          return provider.send(args.method, args.params || []);
        },
      };

      if (isCountryCircuit) {
        const manualInputs = route.params?.countryInputs;
        const deepLinkInputs = proofRequest?.inputs as CoinbaseCountryInputs | undefined;
        const scopeString = deepLinkInputs?.scope || 'proofport:default';

        // Resolve countryList and isIncluded — no fallback defaults
        const countryList = manualInputs?.countryList || deepLinkInputs?.countryList;
        const isIncluded = manualInputs?.isIncluded ?? deepLinkInputs?.isIncluded;

        if (!countryList || countryList.length === 0 || typeof isIncluded !== 'boolean') {
          const errMsg = 'Missing required inputs: countryList and isIncluded are required for country attestation';
          addLog(`[Error] ${errMsg}`);
          setErrorMessage(errMsg);
          if (proofRequest) {
            sendError(proofRequest, errMsg).catch(console.error);
            setActiveProofRequest(null);
          }
          return;
        }

        await countryHook.generateProofWithSteps(
          {
            userAddress: account,
            rawTransaction: result.rawTransaction,
            signerIndex: 0,
            countryList,
            countryListLength: countryList.length,
            isIncluded,
            scopeString,
          },
          ethereumProvider,
          addLog,
        );
      } else {
        const deepLinkInputs = proofRequest?.inputs as CoinbaseKycInputs | undefined;
        const scopeString = deepLinkInputs?.scope || 'proofport:default';

        await kycHook.generateProofWithSteps(
          {
            userAddress: account,
            rawTransaction: result.rawTransaction,
            signerIndex: 0,
            scopeString,
          },
          ethereumProvider,
          addLog,
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage(errMsg);
      addLog(`Error: ${errMsg}`);
      if (historyIdRef.current) {
        proofHistoryStore.update(historyIdRef.current, {
          overallStatus: 'failed',
        }).catch(console.error);
      }
    } finally {
      setIsSearching(false);
    }
  }, [account, addLog, clearLogs, getProvider, kycHook.generateProofWithSteps, countryHook.generateProofWithSteps, isCountryCircuit, proofRequest, route.params?.circuitId, sendError]);

  useEffect(() => {
    if (parsedProof && proofStartedAt.current) {
      const generatedAt = Date.now();
      const configNames: Record<string, string> = {
        'coinbase-kyc': 'coinbase_attestation',
        'coinbase-country': 'coinbase_country_attestation',
      };
      const resolvedCircuit = (configNames[circuitId] || circuitId) as CircuitName;

      if (historyIdRef.current) {
        proofHistoryStore.update(historyIdRef.current, {
          proofHash: parsedProof.proofHex,
          offChainStatus: 'generated',
          onChainStatus: 'generated',
          overallStatus: 'generated',
        }).catch(console.error);
      }

      if (proofRequest) {
        const deepLinkInputs = proofRequest.inputs as CoinbaseKycInputs | undefined;
        const scopeString = deepLinkInputs?.scope || 'proofport:default';

        const scopeBytes = computeScope(scopeString);
        const nullifierBytes = signalHash
          ? computeNullifier(account || '', signalHash, scopeBytes)
          : new Uint8Array(32);
        const nullifierHex = ethers.utils.hexlify(nullifierBytes);

        sendProof(proofRequest, {
          proof: parsedProof.proofHex,
          publicInputs: parsedProof.publicInputsHex,
          numPublicInputs: parsedProof.numPublicInputs,
          nullifier: nullifierHex,
          verificationType: 'off-chain',
          verificationResult: false,
          startedAt: proofStartedAt.current,
          completedAt: generatedAt,
          verifierAddress: getVerifierAddressSync(resolvedCircuit),
          chainId: getNetworkConfig().chainId,
        }).then(() => {
          setActiveProofRequest(null);
        }).catch(console.error);
      }

      navigation.navigate('ProofComplete', {
        proofHex: parsedProof.proofHex,
        publicInputsHex: parsedProof.publicInputsHex,
        numPublicInputs: parsedProof.numPublicInputs,
        circuitId,
        timestamp: generatedAt.toString(),
        verification: {
          offChain: null,
          onChain: null,
          verifierContract: getVerifierAddressSync(resolvedCircuit),
          chainName: getNetworkConfig().name,
          explorerUrl: getNetworkConfig().explorerUrl,
        },
        walletAddress: account || undefined,
        historyId: historyIdRef.current || undefined,
      });
    }
  }, [parsedProof, navigation, route.params?.circuitId, proofRequest, sendProof, account]);

  useEffect(() => {
    if (proofRequest && isWalletConnected && account && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] Request from: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Request ID: ${proofRequest.requestId}`);
      addLog(`[DeepLink] Auto-starting proof generation...`);

      const timer = setTimeout(() => {
        handleGenerateProof();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [proofRequest, isWalletConnected, account, handleGenerateProof, addLog]);

  useEffect(() => {
    if (proofRequest && !isWalletConnected && isPrivyReady && !hasAutoStarted.current) {
      addLog(`[DeepLink] Request from: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Wallet not connected, please connect to continue`);
    }
  }, [proofRequest, isWalletConnected, isPrivyReady, addLog]);

  const isProcessing = isLoading || isSearching;
  const hasAnyStepStarted = proofSteps.some(s => s.status !== 'pending');

  const getButtonState = () => {
    if (!isWalletConnected) {
      return {
        title: 'Connect Wallet',
        onPress: connectWallet,
        disabled: !isPrivyReady,
        loading: false,
      };
    }
    if (isSearching) {
      return {
        title: 'Searching Attestation...',
        onPress: () => {},
        disabled: true,
        loading: true,
      };
    }
    if (isLoading) {
      return {
        title: 'Generating Proof...',
        onPress: () => {},
        disabled: true,
        loading: true,
      };
    }
    if (errorMessage) {
      return {
        title: 'Retry',
        onPress: handleGenerateProof,
        disabled: false,
        loading: false,
      };
    }
    return {
      title: 'Generate ZK Proof',
      onPress: handleGenerateProof,
      disabled: false,
      loading: false,
    };
  };

  const buttonState = getButtonState();

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <Card style={styles.heroCard}>
          <Text style={{fontSize: 11, fontWeight: '700', color: themeColors.info[400], letterSpacing: 1.5, marginBottom: 8}}>PROOF PORTAL</Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, marginBottom: 12}}>
            {isCountryCircuit ? 'Coinbase Country Verification' : 'Coinbase KYC Verification'}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {isCountryCircuit
              ? 'Generate a zero-knowledge proof of your country verification through Coinbase without revealing personal details.'
              : 'Generate a zero-knowledge proof of your Coinbase identity verification without revealing any personal information.'}
          </Text>
        </Card>

        {(hasAnyStepStarted || isProcessing) && (
          <Card style={styles.stepsCard}>
            <StepIndicator steps={userSteps} />
          </Card>
        )}

        {errorMessage && (
          <Card style={{marginBottom: 20, backgroundColor: themeColors.error.background, borderColor: themeColors.error[500]}}>
            <Text style={{color: themeColors.error[400], fontSize: 14, textAlign: 'center'}}>{errorMessage}</Text>
          </Card>
        )}

        <View style={styles.buttonContainer}>
          <Button
            title={buttonState.title}
            onPress={buttonState.onPress}
            disabled={buttonState.disabled}
            loading={buttonState.loading}
            size="large"
          />
        </View>

        {isProcessing && (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={themeColors.info[500]} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  heroCard: {
    marginBottom: 20,
    padding: 24,
  },
  stepsCard: {
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  loaderContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
});
