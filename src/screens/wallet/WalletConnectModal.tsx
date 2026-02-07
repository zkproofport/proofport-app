import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import {Icon} from '../../components/ui/atoms/Icon';
import {useThemeColors} from '../../context';
import {typography, spacing, borderRadius} from '../../theme';

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const getWalletOptions = (themeColors: any): WalletOption[] => [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: 'activity',
    color: themeColors.wallets.metamask,
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: 'circle',
    color: themeColors.wallets.coinbase,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    icon: 'cloud',
    color: '#FF6B6B',
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: 'link-2',
    color: themeColors.wallets.walletconnect,
  },
];

interface WalletConnectModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectWallet: (walletId: string) => void;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({
  visible,
  onClose,
  onSelectWallet,
}) => {
  const { colors: themeColors } = useThemeColors();
  const WALLET_OPTIONS = getWalletOptions(themeColors);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={{backgroundColor: themeColors.background.secondary, borderTopLeftRadius: borderRadius['2xl'], borderTopRightRadius: borderRadius['2xl'], paddingTop: spacing[2], paddingBottom: spacing[8], paddingHorizontal: spacing[4]}}>
              <View style={{width: 40, height: 4, backgroundColor: themeColors.border.primary, borderRadius: 2, alignSelf: 'center', marginBottom: spacing[4]}} />

              <View style={styles.header}>
                <Text style={{...typography.heading.h2, color: themeColors.text.primary, marginBottom: spacing[2]}}>Connect Wallet</Text>
                <Text style={{...typography.body.medium, color: themeColors.text.secondary}}>Select a wallet to connect:</Text>
              </View>

              <View style={styles.walletOptions}>
                {WALLET_OPTIONS.map(wallet => (
                  <TouchableOpacity
                    key={wallet.id}
                    style={{flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.background.tertiary, borderRadius: borderRadius.lg, padding: spacing[4], borderWidth: 1, borderColor: themeColors.border.primary}}
                    onPress={() => {
                      onSelectWallet(wallet.id);
                      onClose();
                    }}
                    activeOpacity={0.7}>
                    <View
                      style={{width: 48, height: 48, borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center', marginRight: spacing[3], backgroundColor: `${wallet.color}15`}}>
                      <Icon
                        name={wallet.icon as any}
                        size="lg"
                        color={wallet.color}
                      />
                    </View>
                    <Text style={{...typography.body.medium, color: themeColors.text.primary, fontWeight: '600', flex: 1}}>{wallet.name}</Text>
                    <Icon
                      name="chevron-right"
                      size="md"
                      color={themeColors.text.tertiary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  header: {
    marginBottom: spacing[6],
  },
  walletOptions: {
    gap: spacing[2],
  },
});
