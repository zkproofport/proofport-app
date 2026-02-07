import React from 'react';
import {View, Text, StyleSheet, ScrollView} from 'react-native';
import {Icon} from '../../components/ui/atoms/Icon';
import {Button} from '../../components/ui/molecules/Button';
import {useThemeColors} from '../../context';
import {typography, spacing} from '../../theme';

interface WalletNoConnectionScreenProps {
  onConnectPress: () => void;
}

export const WalletNoConnectionScreen: React.FC<
  WalletNoConnectionScreenProps
> = ({onConnectPress}) => {
  const { colors: themeColors } = useThemeColors();
  return (
    <ScrollView
      style={{flex: 1, backgroundColor: themeColors.background.primary}}
      contentContainerStyle={styles.contentContainer}>
      <View style={styles.emptyStateContainer}>
        <View style={{width: 80, height: 80, borderRadius: 40, backgroundColor: themeColors.background.secondary, justifyContent: 'center', alignItems: 'center', marginBottom: spacing[6]}}>
          <Icon name="link" size="xl" color={themeColors.text.secondary} />
        </View>

        <Text style={{...typography.heading.h1, color: themeColors.text.primary, marginBottom: spacing[3], textAlign: 'center'}}>No Wallet Connected</Text>
        <Text style={{...typography.body.medium, color: themeColors.text.secondary, textAlign: 'center', marginBottom: spacing[8], paddingHorizontal: spacing[4]}}>
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
  connectButton: {
    width: '100%',
    maxWidth: 300,
  },
});
