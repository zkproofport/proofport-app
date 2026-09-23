import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTranslation} from 'react-i18next';
import {useProofUiColors} from '../../theme/proofUi';

export function WalletScreenLayout({children}: {children: React.ReactNode}) {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  return <SafeAreaView edges={['top', 'left', 'right']}
    style={[styles.screen, {backgroundColor: colors.background}]}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={[styles.brand, {color: colors.secondary}]}>ZKProofport</Text>
        <Text style={[styles.title, {color: colors.text}]}>{t('host.wallet.home.title')}</Text>
        <Text style={[styles.subtitle, {color: colors.secondary}]}>{t('host.wallet.home.subtitle')}</Text>
      </View>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 44, gap: 24},
  header: {gap: 8},
  brand: {fontSize: 17, fontWeight: '600', marginBottom: 12},
  title: {fontSize: 27, lineHeight: 35, fontWeight: '700'},
  subtitle: {fontSize: 14, lineHeight: 21},
});
