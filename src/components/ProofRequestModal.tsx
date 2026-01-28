/**
 * Modal component for displaying incoming proof requests from dapps
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import type {
  ProofRequest,
  AgeVerifierInputs,
  CoinbaseKycInputs,
} from '../utils/deeplink';

interface ProofRequestModalProps {
  visible: boolean;
  request: ProofRequest | null;
  onAccept: () => void;
  onReject: () => void;
}

const CIRCUIT_INFO = {
  age_verifier: {
    name: 'Age Verification',
    icon: '🎂',
    description: 'Prove your age without revealing your birth year',
  },
  coinbase_attestation: {
    name: 'Coinbase KYC',
    icon: '🏦',
    description: 'Prove Coinbase identity verification',
  },
};

export const ProofRequestModal: React.FC<ProofRequestModalProps> = ({
  visible,
  request,
  onAccept,
  onReject,
}) => {
  if (!request) return null;

  const circuitInfo = CIRCUIT_INFO[request.circuit];
  const isAgeVerifier = request.circuit === 'age_verifier';
  const inputs = request.inputs as AgeVerifierInputs | CoinbaseKycInputs;

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return 'No expiry';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const getDappHost = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onReject}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerIcon}>{circuitInfo.icon}</Text>
            <Text style={styles.headerTitle}>Proof Request</Text>
          </View>

          <ScrollView style={styles.content}>
            {/* Dapp Info */}
            <View style={styles.dappSection}>
              {request.dappIcon && (
                <Image
                  source={{uri: request.dappIcon}}
                  style={styles.dappIcon}
                />
              )}
              <View style={styles.dappInfo}>
                <Text style={styles.dappName}>
                  {request.dappName || 'Unknown Dapp'}
                </Text>
                <Text style={styles.dappUrl}>
                  {getDappHost(request.callbackUrl)}
                </Text>
              </View>
            </View>

            {/* Request Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{circuitInfo.name}</Text>
              <Text style={styles.sectionDescription}>
                {circuitInfo.description}
              </Text>
            </View>

            {/* Message */}
            {request.message && (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{request.message}</Text>
              </View>
            )}

            {/* Input Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Request Details</Text>

              {isAgeVerifier ? (
                <View style={styles.inputsList}>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Birth Year</Text>
                    <Text style={styles.inputValue}>
                      {(inputs as AgeVerifierInputs).birthYear}
                      <Text style={styles.privateTag}> (private)</Text>
                    </Text>
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Current Year</Text>
                    <Text style={styles.inputValue}>
                      {(inputs as AgeVerifierInputs).currentYear}
                    </Text>
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Minimum Age</Text>
                    <Text style={styles.inputValue}>
                      {(inputs as AgeVerifierInputs).minAge}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.inputsList}>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Wallet Address</Text>
                    <Text style={styles.inputValue} numberOfLines={1}>
                      {(inputs as CoinbaseKycInputs).userAddress
                        ? `${(inputs as CoinbaseKycInputs).userAddress!.slice(0, 10)}...${(inputs as CoinbaseKycInputs).userAddress!.slice(-8)}`
                        : 'Will connect wallet'}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Expiry Info */}
            <View style={styles.expiryInfo}>
              <Text style={styles.expiryLabel}>Request ID: </Text>
              <Text style={styles.expiryValue}>{request.requestId}</Text>
            </View>
            {request.expiresAt && (
              <View style={styles.expiryInfo}>
                <Text style={styles.expiryLabel}>Expires at: </Text>
                <Text style={styles.expiryValue}>
                  {formatTime(request.expiresAt)}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={onReject}>
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={onAccept}>
              <Text style={styles.acceptButtonText}>Generate Proof</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  content: {
    padding: 20,
  },
  dappSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  dappIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
  },
  dappInfo: {
    flex: 1,
  },
  dappName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  dappUrl: {
    fontSize: 14,
    color: '#94a3b8',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  messageBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  messageText: {
    fontSize: 14,
    color: '#a5b4fc',
    lineHeight: 20,
  },
  inputsList: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 4,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  inputLabel: {
    fontSize: 14,
    color: '#94a3b8',
  },
  inputValue: {
    fontSize: 14,
    color: '#f1f5f9',
    fontWeight: '500',
  },
  privateTag: {
    fontSize: 12,
    color: '#22c55e',
    fontStyle: 'italic',
  },
  expiryInfo: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  expiryLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  expiryValue: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#334155',
  },
  rejectButtonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: '#6366f1',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProofRequestModal;
