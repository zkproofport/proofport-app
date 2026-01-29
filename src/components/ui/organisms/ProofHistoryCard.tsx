import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';

type ProofStatus = 'verified' | 'pending' | 'failed';

interface ProofHistoryCardProps {
  circuitIcon: string;
  circuitName: string;
  offChainStatus: ProofStatus;
  onChainStatus: ProofStatus;
  date: string;
  network: string;
  proofHash: string;
  onPress?: () => void;
  onDelete?: () => void;
}

const truncateHash = (hash: string): string => {
  if (hash.length <= 13) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

const getStatusBadge = (status: ProofStatus) => {
  switch (status) {
    case 'verified':
      return <Badge variant="success" text="Verified" />;
    case 'pending':
      return <Badge variant="warning" text="Pending" />;
    case 'failed':
      return <Badge variant="error" text="Failed" />;
  }
};

export const ProofHistoryCard: React.FC<ProofHistoryCardProps> = ({
  circuitIcon,
  circuitName,
  offChainStatus,
  onChainStatus,
  date,
  network,
  proofHash,
  onPress,
  onDelete,
}) => {
  const Container = onPress ? TouchableOpacity : View;
  const containerProps = onPress
    ? {onPress, activeOpacity: 0.7}
    : {};

  return (
    <Container style={styles.container} {...containerProps}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconContainer}>
            <Icon name={circuitIcon as any} size="md" color="#3B82F6" />
          </View>
          <Text style={styles.circuitName}>{circuitName}</Text>
        </View>
        <View style={styles.headerRight}>
          {onPress && <Icon name="chevron-right" size="sm" color="#6B7280" />}
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Off-Chain</Text>
          {getStatusBadge(offChainStatus)}
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>On-Chain</Text>
          {getStatusBadge(onChainStatus)}
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Date</Text>
          <Text style={styles.detailValue}>{date}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Network</Text>
          <Text style={styles.detailValue}>{network}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Proof Hash</Text>
          <Text style={[styles.detailValue, styles.hash]}>
            {truncateHash(proofHash)}
          </Text>
        </View>
      </View>
      {onDelete && (
        <>
          <View style={styles.divider} />
          <TouchableOpacity
            onPress={onDelete}
            style={styles.deleteRow}
            activeOpacity={0.7}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Icon name="trash-2" size="xs" color="#EF4444" />
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </>
      )}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A2332',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2D3748',
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  circuitName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#2D3748',
    marginBottom: 12,
  },
  details: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  hash: {
    fontFamily: 'monospace',
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    gap: 6,
  },
  deleteText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
});
