import React, {useState} from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Icon, Badge, Card} from '../../components/ui';
import {useThemeColors} from '../../context';

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
  const { colors: themeColors } = useThemeColors();
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
      style={{flex: 1, backgroundColor: themeColors.background.primary}}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}>
      <View style={styles.headerSection}>
        <View style={[styles.iconCircle, {backgroundColor: `${brandColor}33`}]}>
          <Icon name={walletIcon} size="xl" color={brandColor} />
        </View>
        <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, marginBottom: 8}}>{walletName}</Text>
        {isActive && (
          <Badge variant="success" text="Active" />
        )}
      </View>

      <Card style={styles.detailsCard}>
        <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>Wallet Details</Text>

        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
          <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Address</Text>
          <TouchableOpacity
            onPress={handleCopyAddress}
            style={styles.copyableValue}
            activeOpacity={0.7}>
            <Text style={{fontSize: 14, fontWeight: '500', color: themeColors.text.primary, fontFamily: 'monospace'}}>
              {addressCopied ? 'Copied!' : truncatedAddress}
            </Text>
            <Icon name="copy" size="sm" color={themeColors.text.secondary} />
          </TouchableOpacity>
        </View>

        <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
          <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Network</Text>
          <View style={styles.networkBadge}>
            <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: themeColors.info[500], marginRight: 6}} />
            <Text style={{fontSize: 13, fontWeight: '600', color: themeColors.info[400]}}>{network}</Text>
          </View>
        </View>

        <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
          <Text style={{fontSize: 15, color: themeColors.text.secondary}}>Status</Text>
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
  detailsCard: {
    marginBottom: 24,
  },
  copyableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
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
