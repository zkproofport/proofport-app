import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';
import {useThemeColors} from '../../../context';

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
  const {colors: themeColors} = useThemeColors();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: themeColors.background.secondary,
          borderColor: themeColors.border.primary,
          borderWidth: 1,
          borderRadius: 16,
        },
      ]}>
      <View style={styles.content}>
        <View
          style={[styles.iconContainer, {backgroundColor: `${brandColor}15`}]}>
          <Icon name={walletIcon as any} size="lg" color={brandColor} />
        </View>
        <View style={styles.info}>
          <View style={styles.headerRow}>
            <Text style={[styles.walletName, {color: themeColors.text.primary}]}>{walletName}</Text>
            {isActive && <Badge variant="success" text="Active" />}
          </View>
          <Text style={[styles.address, {color: themeColors.text.secondary}]}>{truncateAddress(address)}</Text>
          <Text style={[styles.network, {color: themeColors.text.tertiary}]}>{network}</Text>
        </View>
      </View>
      {onDisconnect && (
        <TouchableOpacity
          onPress={onDisconnect}
          style={styles.disconnectButton}
          activeOpacity={0.7}>
          <Text style={[styles.disconnectText, {color: themeColors.error[500]}]}>Disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
  },
  address: {
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  network: {
    fontSize: 12,
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
  },
});
