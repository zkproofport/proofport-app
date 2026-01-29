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
import {colors, typography, spacing, borderRadius} from '../../theme';

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: 'activity',
    color: colors.wallets.metamask,
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: 'circle',
    color: colors.wallets.coinbase,
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
    color: colors.wallets.walletconnect,
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContainer}>
              <View style={styles.dragHandle} />

              <View style={styles.header}>
                <Text style={styles.title}>Connect Wallet</Text>
                <Text style={styles.subtitle}>Select a wallet to connect:</Text>
              </View>

              <View style={styles.walletOptions}>
                {WALLET_OPTIONS.map(wallet => (
                  <TouchableOpacity
                    key={wallet.id}
                    style={styles.walletOption}
                    onPress={() => {
                      onSelectWallet(wallet.id);
                      onClose();
                    }}
                    activeOpacity={0.7}>
                    <View
                      style={[
                        styles.walletIconContainer,
                        {backgroundColor: `${wallet.color}15`},
                      ]}>
                      <Icon
                        name={wallet.icon as any}
                        size="lg"
                        color={wallet.color}
                      />
                    </View>
                    <Text style={styles.walletOptionName}>{wallet.name}</Text>
                    <Icon
                      name="chevron-right"
                      size="md"
                      color={colors.text.tertiary}
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
  modalContainer: {
    backgroundColor: colors.background.secondary,
    borderTopLeftRadius: borderRadius['2xl'],
    borderTopRightRadius: borderRadius['2xl'],
    paddingTop: spacing[2],
    paddingBottom: spacing[8],
    paddingHorizontal: spacing[4],
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border.primary,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing[4],
  },
  header: {
    marginBottom: spacing[6],
  },
  title: {
    ...typography.heading.h2,
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  subtitle: {
    ...typography.body.medium,
    color: colors.text.secondary,
  },
  walletOptions: {
    gap: spacing[2],
  },
  walletOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.tertiary,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  walletIconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[3],
  },
  walletOptionName: {
    ...typography.body.medium,
    color: colors.text.primary,
    fontWeight: '600',
    flex: 1,
  },
});
