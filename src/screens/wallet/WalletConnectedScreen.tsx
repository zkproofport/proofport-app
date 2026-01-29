import React, {useState} from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Icon, Badge, Card} from '../../components/ui';
import {colors} from '../../theme';

interface WalletConnectedScreenProps {
  walletIcon: string;
  walletName: string;
  address: string;
  network: string;
  brandColor: string;
  isActive: boolean;
  onDisconnect: () => void;
}

export const WalletConnectedScreen: React.FC<WalletConnectedScreenProps> = ({
  walletIcon,
  walletName,
  address,
  network,
  brandColor,
  isActive,
  onDisconnect,
}) => {
  const [addressCopied, setAddressCopied] = useState(false);

  const truncatedAddress =
    address.length > 18
      ? `${address.slice(0, 10)}...${address.slice(-8)}`
      : address;

  const handleCopyAddress = () => {
    Clipboard.setString(address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}>
      <View style={styles.headerSection}>
        <View style={[styles.iconCircle, {backgroundColor: `${brandColor}33`}]}>
          <Icon name={walletIcon} size="xl" color={brandColor} />
        </View>
        <Text style={styles.walletName}>{walletName}</Text>
        {isActive && (
          <Badge variant="success" text="Active" />
        )}
      </View>

      <Card style={styles.detailsCard}>
        <Text style={styles.cardTitle}>Wallet Details</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Address</Text>
          <TouchableOpacity
            onPress={handleCopyAddress}
            style={styles.copyableValue}
            activeOpacity={0.7}>
            <Text style={styles.addressValue}>
              {addressCopied ? 'Copied!' : truncatedAddress}
            </Text>
            <Icon name="copy" size="sm" color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Network</Text>
          <View style={styles.networkBadge}>
            <View style={styles.networkDot} />
            <Text style={styles.networkText}>{network}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Status</Text>
          <Badge
            variant={isActive ? 'success' : 'neutral'}
            text={isActive ? 'Active' : 'Inactive'}
          />
        </View>
      </Card>

      <TouchableOpacity
        onPress={onDisconnect}
        style={styles.disconnectRow}
        activeOpacity={0.7}>
        <Icon name="x" size="xs" color="#EF4444" />
        <Text style={styles.disconnectText}>Disconnect</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  walletName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
  },
  detailsCard: {
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 12,
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
  copyableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.primary,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.info[500],
    marginRight: 6,
  },
  networkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.info[400],
  },
  disconnectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  disconnectText: {
    fontSize: 14,
    color: '#EF4444',
    fontWeight: '500',
  },
});
