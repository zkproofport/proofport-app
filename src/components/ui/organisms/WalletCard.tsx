import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';

interface WalletCardProps {
  walletIcon: string;
  walletName: string;
  address: string;
  network: string;
  brandColor?: string;
  isActive?: boolean;
  onDisconnect?: () => void;
}

const truncateAddress = (address: string): string => {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const WalletCard: React.FC<WalletCardProps> = ({
  walletIcon,
  walletName,
  address,
  network,
  brandColor = '#3B82F6',
  isActive = false,
  onDisconnect,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View
          style={[styles.iconContainer, {backgroundColor: `${brandColor}15`}]}>
          <Icon name={walletIcon as any} size="lg" color={brandColor} />
        </View>
        <View style={styles.info}>
          <View style={styles.headerRow}>
            <Text style={styles.walletName}>{walletName}</Text>
            {isActive && <Badge variant="success" text="Active" />}
          </View>
          <Text style={styles.address}>{truncateAddress(address)}</Text>
          <Text style={styles.network}>{network}</Text>
        </View>
      </View>
      {onDisconnect && (
        <TouchableOpacity
          onPress={onDisconnect}
          style={styles.disconnectButton}
          activeOpacity={0.7}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A2332',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2D3748',
    padding: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  walletName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  address: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#9CA3AF',
    marginBottom: 2,
  },
  network: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  disconnectButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
  },
});
