import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useRoute, useNavigation, useFocusEffect, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Icon, Badge, Card} from '../../components/ui';
import {colors} from '../../theme';
import type {HistoryStackParamList} from '../../navigation/types';
import {proofHistoryStore, type ProofHistoryItem} from '../../stores';

type DetailRouteProp = RouteProp<HistoryStackParamList, 'HistoryDetail'>;
type DetailNavigationProp = NativeStackNavigationProp<
  HistoryStackParamList,
  'HistoryDetail'
>;

const CIRCUIT_DISPLAY_NAMES: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'age-verifier': 'Age Verifier',
  'location-proof': 'Location Proof',
};

const getCircuitIcon = (circuitId: string): string => {
  switch (circuitId) {
    case 'coinbase-kyc':
      return 'shield';
    case 'age-verifier':
      return 'calendar';
    default:
      return 'shield';
  }
};

const HistoryDetailScreen: React.FC = () => {
  const route = useRoute<DetailRouteProp>();
  const navigation = useNavigation<DetailNavigationProp>();
  const {proofId} = route.params;

  const [proofItem, setProofItem] = useState<ProofHistoryItem | null>(null);
  const [offChainStatus, setOffChainStatus] = useState<
    'pending' | 'loading' | 'verified' | 'failed' | 'generated'
  >('pending');
  const [onChainStatus, setOnChainStatus] = useState<
    'pending' | 'loading' | 'verified' | 'failed' | 'generated'
  >('pending');

  // Reload proof status on focus (status can change from ProofComplete screen)
  useFocusEffect(
    React.useCallback(() => {
      const loadProof = async () => {
        const items = await proofHistoryStore.getAll();
        const item = items.find(i => i.id === proofId);
        if (item) {
          setProofItem(item);
          setOffChainStatus(item.offChainStatus);
          setOnChainStatus(item.onChainStatus);
        }
      };
      loadProof();
    }, [proofId])
  );

  const bothGenerated = offChainStatus === 'generated' && onChainStatus === 'generated';

  if (!proofItem) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={colors.info[400]} />
          <Text style={styles.emptyText}>Loading proof details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const circuitName =
    CIRCUIT_DISPLAY_NAMES[proofItem.circuitId] || proofItem.circuitId;
  const circuitIcon = getCircuitIcon(proofItem.circuitId);
  const formattedDate = new Date(proofItem.timestamp).toLocaleString();
  const truncatedWallet =
    proofItem.walletAddress.length > 18
      ? `${proofItem.walletAddress.slice(0, 10)}...${proofItem.walletAddress.slice(-8)}`
      : proofItem.walletAddress;
  const truncatedVerifier = proofItem.verifierAddress && proofItem.verifierAddress.length > 18
    ? `${proofItem.verifierAddress.slice(0, 10)}...${proofItem.verifierAddress.slice(-8)}`
    : proofItem.verifierAddress || '';

  const handleCopyProofHash = () => {
    Clipboard.setString(proofItem.proofHash);
    Alert.alert('Copied', 'Proof hash copied to clipboard');
  };

  const handleCopyWallet = () => {
    Clipboard.setString(proofItem.walletAddress);
    Alert.alert('Copied', 'Wallet address copied to clipboard');
  };

  const handleCopyVerifier = () => {
    if (proofItem.verifierAddress) {
      Clipboard.setString(proofItem.verifierAddress);
      Alert.alert('Copied', 'Verifier address copied to clipboard');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Proof',
      `Are you sure you want to delete this ${circuitName} proof record?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await proofHistoryStore.remove(proofId);
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerSection}>
          <View style={styles.iconCircle}>
            <Icon name={circuitIcon} size="xl" color={colors.info[400]} />
          </View>
          <Text style={styles.circuitName}>{circuitName}</Text>
          <Text style={styles.timestamp}>{formattedDate}</Text>
        </View>

        {proofItem.source === 'deeplink' && (proofItem.dappName || proofItem.requestId) && (
          <Card style={styles.statusCard}>
            <Text style={styles.cardTitle}>dApp Request</Text>
            {proofItem.dappName && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>dApp</Text>
                <Text style={styles.dappValue}>{proofItem.dappName}</Text>
              </View>
            )}
            {proofItem.dappName && proofItem.requestId && <View style={styles.divider} />}
            {proofItem.requestId && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Request ID</Text>
                <Text style={[styles.hashValue, {fontSize: 13}]}>
                  {proofItem.requestId.length > 20
                    ? `${proofItem.requestId.slice(0, 12)}...${proofItem.requestId.slice(-8)}`
                    : proofItem.requestId}
                </Text>
              </View>
            )}
          </Card>
        )}

        {bothGenerated ? (
          <Card style={styles.statusCard}>
            <Text style={styles.cardTitle}>Proof Status</Text>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status</Text>
              <Badge variant="info" text="Generated" />
            </View>
          </Card>
        ) : (
          <Card style={styles.statusCard}>
            <Text style={styles.cardTitle}>Verification Status</Text>

            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Off-Chain Verification</Text>
              <View style={styles.statusRight}>
                {offChainStatus === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.info[400]} />
                ) : (
                  <Badge
                    variant={
                      offChainStatus === 'verified' ? 'success' :
                      offChainStatus === 'failed' ? 'error' :
                      offChainStatus === 'generated' ? 'info' : 'warning'
                    }
                    text={
                      offChainStatus === 'verified' ? 'Verified' :
                      offChainStatus === 'failed' ? 'Failed' :
                      offChainStatus === 'generated' ? 'Generated' : 'Pending'
                    }
                  />
                )}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>On-Chain Verification</Text>
              <View style={styles.statusRight}>
                {onChainStatus === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.info[400]} />
                ) : (
                  <Badge
                    variant={
                      onChainStatus === 'verified' ? 'success' :
                      onChainStatus === 'failed' ? 'error' :
                      onChainStatus === 'generated' ? 'info' : 'warning'
                    }
                    text={
                      onChainStatus === 'verified' ? 'Verified' :
                      onChainStatus === 'failed' ? 'Failed' :
                      onChainStatus === 'generated' ? 'Generated' : 'Pending'
                    }
                  />
                )}
              </View>
            </View>
          </Card>
        )}

        <Card style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Network</Text>
            <View style={styles.chainBadge}>
              <View style={styles.chainDot} />
              <Text style={styles.chainText}>{proofItem.network}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {proofItem.verifierAddress && (
            <>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Verifier Contract</Text>
                <TouchableOpacity
                  onPress={handleCopyVerifier}
                  style={styles.copyableValue}
                  activeOpacity={0.7}>
                  <Text style={styles.verifierValue}>{truncatedVerifier}</Text>
                  <Icon name="copy" size="sm" color={colors.text.secondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.divider} />
            </>
          )}

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Proof Hash</Text>
            <TouchableOpacity
              onPress={handleCopyProofHash}
              style={styles.copyableValue}
              activeOpacity={0.7}>
              <Text style={styles.hashValue}>
                {proofItem.proofHash.length > 20
                  ? `${proofItem.proofHash.slice(0, 12)}...${proofItem.proofHash.slice(-8)}`
                  : proofItem.proofHash}
              </Text>
              <Icon name="copy" size="sm" color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Wallet Address</Text>
            <TouchableOpacity
              onPress={handleCopyWallet}
              style={styles.copyableValue}
              activeOpacity={0.7}>
              <Text style={styles.walletValue}>{truncatedWallet}</Text>
              <Icon name="copy" size="sm" color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
        </Card>

        <TouchableOpacity
          onPress={handleDelete}
          style={styles.deleteRow}
          activeOpacity={0.7}>
          <Icon name="trash-2" size="xs" color="#EF4444" />
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
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
    paddingTop: 24,
    paddingBottom: 32,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 15,
    color: colors.text.secondary,
    marginTop: 16,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  circuitName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  statusCard: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  statusLabel: {
    fontSize: 15,
    color: colors.text.secondary,
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.primary,
  },
  detailsCard: {
    marginBottom: 24,
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
  copyableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hashValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.info[400],
    fontFamily: 'monospace',
  },
  walletValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
    fontFamily: 'monospace',
  },
  verifierValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.info[400],
    fontFamily: 'monospace',
  },
  dappValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.info[400],
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  deleteText: {
    fontSize: 14,
    color: '#EF4444',
    fontWeight: '500',
  },
});

export default HistoryDetailScreen;
