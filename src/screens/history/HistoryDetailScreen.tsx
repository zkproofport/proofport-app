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
import {useThemeColors} from '../../context';
import type {HistoryStackParamList} from '../../navigation/types';
import {proofHistoryStore, type ProofHistoryItem} from '../../stores';

type DetailRouteProp = RouteProp<HistoryStackParamList, 'HistoryDetail'>;
type DetailNavigationProp = NativeStackNavigationProp<
  HistoryStackParamList,
  'HistoryDetail'
>;

import {getCircuitIcon, getCircuitDisplayName} from '../../utils';

const HistoryDetailScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
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
      <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={themeColors.info[400]} />
          <Text style={{fontSize: 15, color: themeColors.text.secondary, marginTop: 16}}>Loading proof details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const circuitName =
    getCircuitDisplayName(proofItem.circuitId);
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
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerSection}>
          <View style={{width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(99, 102, 241, 0.18)', justifyContent: 'center', alignItems: 'center', marginBottom: 16}}>
            <Icon name={circuitIcon} size="xl" color={themeColors.info[400]} />
          </View>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, marginBottom: 8}}>{circuitName}</Text>
          <Text style={{fontSize: 14, color: themeColors.text.secondary}}>{formattedDate}</Text>
        </View>

        {proofItem.source === 'deeplink' && (proofItem.dappName || proofItem.requestId) && (
          <Card style={styles.statusCard}>
            <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>dApp Request</Text>
            {proofItem.dappName && (
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
                <Text style={{fontSize: 15, color: themeColors.text.secondary}}>dApp</Text>
                <Text style={{fontSize: 15, fontWeight: '600', color: themeColors.info[400]}}>{proofItem.dappName}</Text>
              </View>
            )}
            {proofItem.dappName && proofItem.requestId && <View style={{height: 1, backgroundColor: themeColors.border.primary}} />}
            {proofItem.requestId && (
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
                <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Request ID</Text>
                <Text style={{fontSize: 13, fontWeight: '500', color: themeColors.info[400], fontFamily: 'monospace'}}>
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
            <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>Proof Status</Text>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
              <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Status</Text>
              <Badge variant="info" text="Generated" />
            </View>
          </Card>
        ) : (
          <Card style={styles.statusCard}>
            <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>Verification Status</Text>

            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
              <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Off-Chain Verification</Text>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                {offChainStatus === 'loading' ? (
                  <ActivityIndicator size="small" color={themeColors.info[400]} />
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

            <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
              <Text style={{fontSize: 15, color: themeColors.text.secondary}}>On-Chain Verification</Text>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                {onChainStatus === 'loading' ? (
                  <ActivityIndicator size="small" color={themeColors.info[400]} />
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
          <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>Details</Text>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Network</Text>
            <View style={styles.chainBadge}>
              <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: themeColors.info[500], marginRight: 6}} />
              <Text style={{fontSize: 13, fontWeight: '600', color: themeColors.info[400]}}>{proofItem.network}</Text>
            </View>
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          {proofItem.verifierAddress && (
            <>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
                <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Verifier Contract</Text>
                <TouchableOpacity
                  onPress={handleCopyVerifier}
                  style={styles.copyableValue}
                  activeOpacity={0.7}>
                  <Text style={{fontSize: 14, fontWeight: '500', color: themeColors.info[400], fontFamily: 'monospace'}}>{truncatedVerifier}</Text>
                  <Icon name="copy" size="sm" color={themeColors.text.secondary} />
                </TouchableOpacity>
              </View>

              <View style={{height: 1, backgroundColor: themeColors.border.primary}} />
            </>
          )}

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Proof Hash</Text>
            <TouchableOpacity
              onPress={handleCopyProofHash}
              style={styles.copyableValue}
              activeOpacity={0.7}>
              <Text style={{fontSize: 14, fontWeight: '500', color: themeColors.info[400], fontFamily: 'monospace'}}>
                {proofItem.proofHash.length > 20
                  ? `${proofItem.proofHash.slice(0, 12)}...${proofItem.proofHash.slice(-8)}`
                  : proofItem.proofHash}
              </Text>
              <Icon name="copy" size="sm" color={themeColors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Wallet Address</Text>
            <TouchableOpacity
              onPress={handleCopyWallet}
              style={styles.copyableValue}
              activeOpacity={0.7}>
              <Text style={{fontSize: 14, fontWeight: '500', color: themeColors.text.primary, fontFamily: 'monospace'}}>{truncatedWallet}</Text>
              <Icon name="copy" size="sm" color={themeColors.text.secondary} />
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
  headerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  statusCard: {
    marginBottom: 16,
  },
  detailsCard: {
    marginBottom: 24,
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  copyableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
