import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TouchableOpacity} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {HistoryStackParamList} from '../../navigation/types';
import {ProofHistoryCard} from '../../components/ui/organisms/ProofHistoryCard';
import {useProofHistory} from '../../hooks/useProofHistory';
import type {ProofHistoryItem} from '../../stores';
import {Icon} from '../../components/ui';

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

const formatDate = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const groupProofsByMonth = (proofs: ProofHistoryItem[]) => {
  const groups: {[key: string]: ProofHistoryItem[]} = {};

  proofs.forEach(proof => {
    const date = new Date(proof.timestamp);
    const monthYear = date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    if (!groups[monthYear]) {
      groups[monthYear] = [];
    }
    groups[monthYear].push(proof);
  });

  return groups;
};

const ProofHistoryScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<HistoryStackParamList>>();
  const {items: proofs, loading, error, removeItem, clearAll, refresh} = useProofHistory();

  // Refresh history when screen gains focus (e.g., coming back from detail or proof completion)
  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh])
  );

  const groupedProofs = groupProofsByMonth(proofs);
  const totalProofs = proofs.length;
  const offChainVerifiedCount = proofs.filter(p => p.offChainStatus === 'verified').length;
  const onChainVerifiedCount = proofs.filter(p => p.onChainStatus === 'verified').length;
  const generatedCount = proofs.filter(p => p.overallStatus === 'generated').length;

  const handleDeleteItem = (id: string, circuitName: string) => {
    Alert.alert(
      'Delete Proof',
      `Are you sure you want to delete "${circuitName}" proof record?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeItem(id).catch(console.error),
        },
      ],
    );
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All History',
      'Are you sure you want to delete all proof records? This cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => clearAll().catch(console.error),
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.emptyStateText}>Loading proof history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>Error</Text>
          <Text style={styles.emptyStateText}>{error.message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (proofs.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>🛡</Text>
          <Text style={styles.emptyStateTitle}>No Proofs Yet</Text>
          <Text style={styles.emptyStateText}>
            Your generated proofs will appear here
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {Object.entries(groupedProofs).map(([monthYear, monthProofs]) => (
          <View key={monthYear} style={styles.section}>
            <Text style={styles.sectionTitle}>{monthYear}</Text>
            {monthProofs.map(proof => (
              <ProofHistoryCard
                key={proof.id}
                circuitIcon={getCircuitIcon(proof.circuitId)}
                circuitName={proof.circuitName}
                offChainStatus={proof.offChainStatus}
                onChainStatus={proof.onChainStatus}
                date={formatDate(proof.timestamp)}
                network={proof.network}
                proofHash={proof.proofHash}
                dappName={proof.dappName}
                onPress={() => navigation.navigate('HistoryDetail', { proofId: proof.id })}
                onDelete={() => handleDeleteItem(proof.id, proof.circuitName)}
              />
            ))}
          </View>
        ))}

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Proofs</Text>
            <Text style={styles.summaryValue}>{totalProofs}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Off-Chain Verified</Text>
            <Text style={styles.summaryValue}>{offChainVerifiedCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>On-Chain Verified</Text>
            <Text style={styles.summaryValue}>{onChainVerifiedCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Generated</Text>
            <Text style={styles.summaryValue}>{generatedCount}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.clearAllButton}
          onPress={handleClearAll}
          activeOpacity={0.7}>
          <Text style={styles.clearAllText}>Clear All History</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1419',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  summary: {
    backgroundColor: '#1A2332',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  clearAllButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  clearAllText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ProofHistoryScreen;
