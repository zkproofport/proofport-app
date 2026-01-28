import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';

interface ActionButtonsProps {
  isLoading: boolean;
  hasVk: boolean;
  hasProof: boolean;
  onGenerateVK: () => void;
  onGenerateProof: () => void;
  onVerifyProof: () => void;
  onVerifyProofOnChain?: () => void;
  onRunAll: () => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  isLoading,
  hasVk,
  hasProof,
  onGenerateVK,
  onGenerateProof,
  onVerifyProof,
  onVerifyProofOnChain,
  onRunAll,
}) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, isLoading && styles.disabled]}
        onPress={onGenerateVK}
        disabled={isLoading}>
        <Text style={styles.buttonText}>1. Generate VK</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, (!hasVk || isLoading) && styles.disabled]}
        onPress={onGenerateProof}
        disabled={!hasVk || isLoading}>
        <Text style={styles.buttonText}>2. Generate Proof</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, (!hasProof || isLoading) && styles.disabled]}
        onPress={onVerifyProof}
        disabled={!hasProof || isLoading}>
        <Text style={styles.buttonText}>3. Verify Proof (Off-chain)</Text>
      </TouchableOpacity>

      {onVerifyProofOnChain && (
        <TouchableOpacity
          style={[styles.onChainButton, (!hasProof || isLoading) && styles.disabled]}
          onPress={onVerifyProofOnChain}
          disabled={!hasProof || isLoading}>
          <Text style={styles.onChainButtonText}>4. Verify On-Chain (Sepolia)</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, isLoading && styles.disabled]}
        onPress={onRunAll}
        disabled={isLoading}>
        <Text style={styles.primaryButtonText}>Run All Steps</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    gap: 12,
  },
  button: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  onChainButton: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#34C759',
  },
  onChainButtonText: {
    color: '#34C759',
    fontSize: 16,
    fontWeight: '600',
  },
});
