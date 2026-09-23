import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';
import {CircuitWalletsCard} from './CircuitWalletsCard';
import {WalletScreenLayout} from './WalletScreenLayout';

export function WalletNoConnectionScreen() {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  return <WalletScreenLayout>
    <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
      <View style={[styles.icon, {backgroundColor: colors.inset}]}>
        <ProofUiIcon name="wallet" size={26} color={colors.blue} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, {color: colors.text}]}>{t('host.wallet.noWalletConnected')}</Text>
        <Text style={[styles.description, {color: colors.secondary}]}>{t('host.wallet.noWalletDescription')}</Text>
      </View>
    </View>
    <CircuitWalletsCard />
  </WalletScreenLayout>;
}

const styles = StyleSheet.create({
  card: {flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, borderWidth: 1, padding: 18},
  icon: {width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  body: {flex: 1},
  title: {fontSize: 16, lineHeight: 23, fontWeight: '600', marginBottom: 5},
  description: {fontSize: 13, lineHeight: 20},
});
