import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Icon, Badge, Button, Card} from '../../components/ui';
import {colors} from '../../theme';
import type {ProofStackParamList} from '../../navigation/types';
import {useCoinbaseKyc, useCoinbaseCountry, useLogs} from '../../hooks';
import {proofHistoryStore} from '../../stores';
import {getVerifierAddressSync, getNetworkConfig} from '../../config';

type ProofCompleteRouteProp = RouteProp<ProofStackParamList, 'ProofComplete'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofComplete'>;

const CIRCUIT_DISPLAY_NAMES: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'coinbase-country': 'Coinbase Country',
  'location-proof': 'Location Proof',
};

export const ProofCompleteScreen: React.FC = () => {
  const route = useRoute<ProofCompleteRouteProp>();
  const navigation = useNavigation<NavigationProp>();

  const params = route.params || {} as any;
  const proofHex = params.proofHex || '0x0000000000000000';
  const circuitId = params.circuitId || 'coinbase-kyc';
  const timestamp = params.timestamp || Date.now().toString();
  const verification = params.verification || {
    offChain: null,
    onChain: null,
    verifierContract: getVerifierAddressSync('coinbase_attestation'),
    chainName: getNetworkConfig().name,
    explorerUrl: getNetworkConfig().explorerUrl,
  };
  const walletAddress = params.walletAddress;
  const historyIdFromParams = params.historyId || null;

  const shortProofHash = proofHex.length > 18
    ? `${proofHex.slice(0, 10)}...${proofHex.slice(-8)}`
    : proofHex;
  const formattedDate = new Date(parseInt(timestamp)).toLocaleString();
  const circuitName = CIRCUIT_DISPLAY_NAMES[circuitId] || circuitId;

  const [offChainStatus, setOffChainStatus] = useState<'generated' | 'loading' | 'verified' | 'failed'>('generated');
  const [onChainStatus, setOnChainStatus] = useState<'generated' | 'loading' | 'verified' | 'failed'>('generated');

  const isCountryCircuit = circuitId === 'coinbase-country';
  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const {verifyProofOffChain, verifyProofOnChain, resetProofCache} = isCountryCircuit ? countryHook : kycHook;
  const {logs, addLog} = useLogs();

  const handleCopyProof = () => {
    Clipboard.setString(proofHex);
    Alert.alert('Copied', 'Proof hash copied to clipboard');
  };

  const handleVerifyOffChain = async () => {
    setOffChainStatus('loading');
    console.log('[History] Updating off-chain status with ID:', historyIdFromParams);
    try {
      const result = await verifyProofOffChain(addLog);
      const newStatus = result ? 'verified' : 'failed';
      setOffChainStatus(newStatus);
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          offChainStatus: result ? 'verified' : 'failed',
          overallStatus: result ? 'verified' : 'verified_failed',
        }).catch(console.error);
      }
    } catch {
      setOffChainStatus('failed');
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          offChainStatus: 'failed',
          overallStatus: 'verified_failed',
        }).catch(console.error);
      }
    }
  };

  const handleVerifyOnChain = async () => {
    setOnChainStatus('loading');
    console.log('[History] Updating on-chain status with ID:', historyIdFromParams);
    try {
      const result = await verifyProofOnChain(addLog);
      const newStatus = result ? 'verified' : 'failed';
      setOnChainStatus(newStatus);
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          onChainStatus: result ? 'verified' : 'failed',
          overallStatus: result ? 'verified' : 'verified_failed',
        }).catch(console.error);
      }
    } catch {
      setOnChainStatus('failed');
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          onChainStatus: 'failed',
          overallStatus: 'verified_failed',
        }).catch(console.error);
      }
    }
  };

  const handleViewEASScan = () => {
    const addr = walletAddress || '';
    const url = `https://base.easscan.org/address/${addr}`;
    Linking.openURL(url);
  };

  const handleGenerateAnother = () => {
    resetProofCache();
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.successSection}>
          <View style={styles.checkmarkCircle}>
            <Icon name="check" size="xl" color={colors.success[400]} />
          </View>
          <Text style={styles.successTitle}>Proof Generated!</Text>
          <Text style={styles.successSubtitle}>
            Your zero-knowledge proof has been successfully created
          </Text>
        </View>

        <Card style={styles.proofHashCard}>
          <View style={styles.proofHashHeader}>
            <Text style={styles.proofHashLabel}>Proof Hash</Text>
            <TouchableOpacity
              onPress={handleCopyProof}
              style={styles.copyButton}
              activeOpacity={0.7}>
              <Icon name="copy" size="sm" color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.proofHashValue}>{shortProofHash}</Text>
        </Card>

        <Card style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>Proof Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Off-Chain</Text>
            {offChainStatus === 'generated' ? (
              <TouchableOpacity onPress={handleVerifyOffChain} style={styles.verifyButton}>
                <Text style={styles.verifyButtonText}>Verify</Text>
              </TouchableOpacity>
            ) : offChainStatus === 'loading' ? (
              <ActivityIndicator size="small" color={colors.info[400]} />
            ) : (
              <Badge
                variant={offChainStatus === 'verified' ? 'success' : 'error'}
                text={offChainStatus === 'verified' ? 'Verified' : 'Failed'}
              />
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>On-Chain</Text>
            {onChainStatus === 'generated' ? (
              <TouchableOpacity onPress={handleVerifyOnChain} style={styles.verifyButton}>
                <Text style={styles.verifyButtonText}>Verify</Text>
              </TouchableOpacity>
            ) : onChainStatus === 'loading' ? (
              <ActivityIndicator size="small" color={colors.info[400]} />
            ) : (
              <Badge
                variant={onChainStatus === 'verified' ? 'success' : 'error'}
                text={onChainStatus === 'verified' ? 'Verified' : 'Failed'}
              />
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Verification Chain</Text>
            <View style={styles.detailValueRow}>
              <View style={styles.chainBadge}>
                <View style={styles.chainDot} />
                <Text style={styles.chainText}>{verification.chainName}</Text>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Circuit</Text>
            <Text style={styles.detailValue}>{circuitName}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Generated</Text>
            <Text style={styles.detailValue}>{formattedDate}</Text>
          </View>
        </Card>

        <View style={styles.buttonsContainer}>
          <Button
            title="View on EAS Scan"
            onPress={handleViewEASScan}
            variant="secondary"
            size="large"
          />
          <View style={styles.buttonSpacer} />
          <Button
            title="Generate Another Proof"
            onPress={handleGenerateAnother}
            variant="ghost"
            size="large"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 32,
  },
  successSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  checkmarkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success.background,
    borderWidth: 3,
    borderColor: colors.success[500],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  proofHashCard: {
    marginBottom: 16,
  },
  proofHashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  proofHashLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  copyButton: {
    padding: 4,
  },
  proofHashValue: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.info[400],
    fontFamily: 'monospace',
  },
  detailsCard: {
    marginBottom: 24,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailLabel: {
    fontSize: 15,
    color: colors.text.secondary,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text.primary,
  },
  detailValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  chainDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.info[500],
    marginRight: 6,
  },
  chainText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.info[400],
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.primary,
  },
  buttonsContainer: {
    marginTop: 8,
  },
  buttonSpacer: {
    height: 12,
  },
  verifyButton: {
    backgroundColor: colors.info[500],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
