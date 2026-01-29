import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {Icon} from '../../components/ui/atoms/Icon';
import {Button} from '../../components/ui/molecules/Button';
import {colors, typography, spacing} from '../../theme';

interface WalletNoConnectionScreenProps {
  onConnectPress: () => void;
}

export const WalletNoConnectionScreen: React.FC<
  WalletNoConnectionScreenProps
> = ({onConnectPress}) => {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}>
      <View style={styles.emptyStateContainer}>
        <View style={styles.iconCircle}>
          <Icon name="link" size="xl" color={colors.text.secondary} />
        </View>

        <Text style={styles.title}>No Wallet Connected</Text>
        <Text style={styles.description}>
          Connect your wallet to generate zero-knowledge proofs
        </Text>

        <Button
          title="Connect Wallet"
          variant="primary"
          size="large"
          onPress={onConnectPress}
          style={styles.connectButton}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  contentContainer: {
    flexGrow: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing[10],
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[6],
  },
  title: {
    ...typography.heading.h1,
    color: colors.text.primary,
    marginBottom: spacing[3],
    textAlign: 'center',
  },
  description: {
    ...typography.body.medium,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing[8],
    paddingHorizontal: spacing[4],
  },
  connectButton: {
    width: '100%',
    maxWidth: 300,
  },
});
