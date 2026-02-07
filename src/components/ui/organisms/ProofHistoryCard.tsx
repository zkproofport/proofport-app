import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';
import {useThemeColors} from '../../../context';

type ProofStatus = 'verified' | 'pending' | 'failed' | 'generated';

interface ProofHistoryCardProps {
  circuitIcon: string;
  circuitName: string;
  offChainStatus: ProofStatus;
  onChainStatus: ProofStatus;
  date: string;
  network: string;
  proofHash: string;
  dappName?: string;
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
    case 'generated':
      return <Badge variant="info" text="Generated" />;
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
  dappName,
  onPress,
  onDelete,
}) => {
  const {colors: themeColors} = useThemeColors();

  const cardStyle = {
    backgroundColor: themeColors.background.secondary,
    borderColor: themeColors.border.primary,
    borderWidth: 1,
    borderRadius: 16,
  };

  const content = (
    <View style={[styles.container, cardStyle]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconContainer}>
            <Icon name={circuitIcon as any} size="md" color={themeColors.info[500]} />
          </View>
          <View style={styles.nameContainer}>
            <Text style={[styles.circuitName, {color: themeColors.text.primary}]}>{circuitName}</Text>
            {dappName && <Text style={[styles.dappName, {color: themeColors.text.tertiary}]}>via {dappName}</Text>}
          </View>
        </View>
        <View style={styles.headerRight}>
          {onPress && <Icon name="chevron-right" size="sm" color={themeColors.text.tertiary} />}
        </View>
      </View>
      <View style={[styles.divider, {backgroundColor: themeColors.border.primary}]} />
      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, {color: themeColors.text.tertiary}]}>Off-Chain</Text>
          {getStatusBadge(offChainStatus)}
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, {color: themeColors.text.tertiary}]}>On-Chain</Text>
          {getStatusBadge(onChainStatus)}
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, {color: themeColors.text.tertiary}]}>Date</Text>
          <Text style={[styles.detailValue, {color: themeColors.text.secondary}]}>{date}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, {color: themeColors.text.tertiary}]}>Network</Text>
          <Text style={[styles.detailValue, {color: themeColors.text.secondary}]}>{network}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, {color: themeColors.text.tertiary}]}>Proof Hash</Text>
          <Text style={[styles.detailValue, styles.hash, {color: themeColors.text.secondary}]}>
            {truncateHash(proofHash)}
          </Text>
        </View>
      </View>
      {onDelete && (
        <>
          <View style={[styles.divider, {backgroundColor: themeColors.border.primary}]} />
          <TouchableOpacity
            onPress={onDelete}
            style={styles.deleteRow}
            activeOpacity={0.7}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Icon name="trash-2" size="xs" color={themeColors.error[500]} />
            <Text style={[styles.deleteText, {color: themeColors.error[500]}]}>Delete</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.touchWrapper}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.touchWrapper}>{content}</View>;
};

const styles = StyleSheet.create({
  touchWrapper: {
    marginBottom: 12,
  },
  container: {
    padding: 16,
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
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameContainer: {
    flex: 1,
  },
  circuitName: {
    fontSize: 15,
    fontWeight: '600',
  },
  dappName: {
    fontSize: 11,
    marginTop: 2,
  },
  divider: {
    height: 1,
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
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
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
    fontWeight: '500',
  },
});
