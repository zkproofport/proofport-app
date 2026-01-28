import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import {InputForm, LogViewer, StepProgress} from '../components';
import {useLogs, useAgeVerifier, useDeepLink} from '../hooks';
import type {AgeVerifierInputs, RootStackParamList, DeepLinkAgeVerifierInputs} from '../types';

type AgeVerifierRouteProp = RouteProp<RootStackParamList, 'AgeVerifier'>;

export const AgeVerifierScreen: React.FC = () => {
  const route = useRoute<AgeVerifierRouteProp>();
  const navigation = useNavigation();
  const proofRequest = route.params?.proofRequest;
  const {sendProof, sendError} = useDeepLink();

  // Track if we've already processed this request to avoid duplicate sends
  const processedRequestId = useRef<string | null>(null);
  const hasAutoStarted = useRef(false);
  const proofStartedAt = useRef<number | null>(null);

  // Input state - initialize from proofRequest if available
  const getInitialInputs = (): AgeVerifierInputs => {
    if (proofRequest?.inputs) {
      const deepLinkInputs = proofRequest.inputs as DeepLinkAgeVerifierInputs;
      return {
        birthYear: deepLinkInputs.birthYear?.toString() || '2000',
        currentYear: deepLinkInputs.currentYear?.toString() || new Date().getFullYear().toString(),
        minAge: deepLinkInputs.minAge?.toString() || '18',
      };
    }
    return {
      birthYear: '2000',
      currentYear: new Date().getFullYear().toString(),
      minAge: '18',
    };
  };

  const [inputs, setInputs] = useState<AgeVerifierInputs>(getInitialInputs);

  // Custom hooks
  const {logs, addLog, clearLogs, logScrollRef} = useLogs();
  const {
    status,
    isLoading,
    parsedProof,
    proofSteps,
    generateProofWithSteps,
    verifyProofOffChain,
    verifyProofOnChain,
  } = useAgeVerifier();

  // Input change handler
  const handleInputChange = useCallback(
    (field: keyof AgeVerifierInputs, value: string) => {
      setInputs(prev => ({...prev, [field]: value}));
    },
    [],
  );

  // Action handlers
  const handleGenerateProof = useCallback(() => {
    clearLogs();
    proofStartedAt.current = Date.now();
    generateProofWithSteps(inputs, addLog);
  }, [generateProofWithSteps, inputs, addLog, clearLogs]);

  const handleVerifyOffChain = useCallback(() => {
    verifyProofOffChain(addLog);
  }, [verifyProofOffChain, addLog]);

  // On-chain verification with callback for deep link requests
  const handleVerifyOnChain = useCallback(async () => {
    const isValid = await verifyProofOnChain(addLog);
    const completedAt = Date.now();

    // Send callback only after successful on-chain verification (for deep link requests)
    if (
      proofRequest &&
      parsedProof &&
      processedRequestId.current !== proofRequest.requestId
    ) {
      processedRequestId.current = proofRequest.requestId;

      addLog(`[DeepLink] On-chain verification ${isValid ? 'successful' : 'failed'}, sending callback...`);

      try {
        const success = await sendProof(proofRequest, {
          proof: parsedProof.proofHex,
          publicInputs: parsedProof.publicInputsHex,
          numPublicInputs: parsedProof.numPublicInputs,
          verificationType: 'on-chain',
          verificationResult: isValid,
          startedAt: proofStartedAt.current || completedAt,
          completedAt,
        });

        if (success) {
          addLog('[DeepLink] Callback sent successfully!');
          Alert.alert(
            isValid ? 'Verification Complete' : 'Verification Failed',
            isValid
              ? `Proof verified on-chain and sent to ${proofRequest.dappName || 'the requesting app'}.`
              : `Proof verification failed. Result sent to ${proofRequest.dappName || 'the requesting app'}.`,
            [{text: 'OK', onPress: () => navigation.goBack()}],
          );
        } else {
          addLog('[DeepLink] Failed to send callback');
          Alert.alert('Error', 'Failed to send proof to the requesting app.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLog(`[DeepLink] Error sending callback: ${errorMessage}`);
      }
    }
  }, [verifyProofOnChain, addLog, proofRequest, parsedProof, sendProof, navigation]);

  // Auto-start proof generation when coming from deep link
  useEffect(() => {
    if (proofRequest && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      addLog(`[DeepLink] Request from: ${proofRequest.dappName || 'Unknown'}`);
      addLog(`[DeepLink] Request ID: ${proofRequest.requestId}`);
      addLog(`[DeepLink] Auto-starting proof generation...`);

      // Small delay to ensure UI is ready
      const timer = setTimeout(() => {
        handleGenerateProof();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [proofRequest, handleGenerateProof, addLog]);

  function getStatusColor(): string {
    if (status.includes('Error') || status.includes('invalid')) return '#FF3B30';
    if (status.includes('verified')) return '#34C759';
    if (status === 'Ready') return '#8E8E93';
    return '#007AFF';
  }

  const hasProof = !!parsedProof;
  const hasAnyStepStarted = proofSteps.some(s => s.status !== 'pending');

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}>
        <ScrollView style={styles.scrollView}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Age Verifier</Text>
            <Text style={styles.subtitle}>
              Prove you meet the minimum age requirement without revealing your birth year
            </Text>
            <View style={[styles.statusBadge, {backgroundColor: getStatusColor()}]}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          </View>

          {/* Input Form */}
          <InputForm inputs={inputs} onInputChange={handleInputChange} />

          {/* Main Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Actions</Text>

            {/* Button 1: Generate Proof */}
            <TouchableOpacity
              style={[styles.button, styles.generateButton, isLoading && styles.disabledButton]}
              onPress={handleGenerateProof}
              disabled={isLoading}>
              <Text style={styles.buttonText}>
                {isLoading && !hasProof ? 'Generating...' : '1. Generate Proof'}
              </Text>
            </TouchableOpacity>

            {/* Step Progress (shown when generating) */}
            {hasAnyStepStarted && (
              <View style={styles.stepProgressContainer}>
                <StepProgress steps={proofSteps} />
              </View>
            )}

            {/* Button 2: Off-chain Verification */}
            <TouchableOpacity
              style={[
                styles.button,
                styles.verifyButton,
                (!hasProof || isLoading) && styles.disabledButton,
              ]}
              onPress={handleVerifyOffChain}
              disabled={!hasProof || isLoading}>
              <Text style={[styles.buttonText, (!hasProof || isLoading) && styles.disabledText]}>
                2. Verify Off-Chain
              </Text>
            </TouchableOpacity>

            {/* Button 3: On-chain Verification */}
            <TouchableOpacity
              style={[
                styles.button,
                styles.onChainButton,
                (!hasProof || isLoading) && styles.disabledButton,
              ]}
              onPress={handleVerifyOnChain}
              disabled={!hasProof || isLoading}>
              <Text style={[styles.onChainButtonText, (!hasProof || isLoading) && styles.disabledText]}>
                3. Verify On-Chain (Sepolia)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Clear Logs */}
          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={clearLogs}
            disabled={isLoading}>
            <Text style={styles.clearButtonText}>Clear Logs</Text>
          </TouchableOpacity>

          {isLoading && (
            <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
          )}

          <LogViewer logs={logs} scrollRef={logScrollRef} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  generateButton: {
    backgroundColor: '#007AFF',
  },
  verifyButton: {
    backgroundColor: '#5856D6',
  },
  onChainButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#34C759',
  },
  clearButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginHorizontal: 16,
    marginBottom: 16,
  },
  disabledButton: {
    backgroundColor: '#E5E5E5',
    borderColor: '#E5E5E5',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  onChainButtonText: {
    color: '#34C759',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledText: {
    color: '#999',
  },
  stepProgressContainer: {
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    marginBottom: 12,
    marginTop: -4,
  },
  loader: {
    marginVertical: 10,
  },
});
